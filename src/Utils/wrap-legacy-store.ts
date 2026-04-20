/**
 * Wraps any upstream Baileys AuthenticationState as bridge-compatible
 * JsStoreCallbacks. Users keep their existing custom stores (MySQL,
 * MongoDB, Redis, etc.) — zero migration needed.
 *
 * ```typescript
 * const { state, saveCreds } = await useMongoAuthState(db)
 * const sock = makeWASocket({
 *   auth: { store: await wrapLegacyStore(state, saveCreds) }
 * })
 * ```
 */

import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JsStoreCallbacks } from 'whatsapp-rust-bridge'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import type { AuthenticationCreds, AuthenticationState, LTHashState, SignalDataTypeMap } from '../Types/index.ts'

// Runtime WAProto exports ADVSignedDeviceIdentity but d.ts uses AdvSignedDeviceIdentity
type ProtoCodec = {
	encode(obj: unknown): { finish(): Uint8Array }
	decode(buf: Uint8Array): Record<string, unknown>
}
const protoLookup = proto as unknown as Record<string, ProtoCodec>
const ADVSignedDeviceIdentity: ProtoCodec = protoLookup.ADVSignedDeviceIdentity! ?? protoLookup.AdvSignedDeviceIdentity!

type WarnFn = (msg: string, err?: unknown) => void

function warn(msg: string, err?: unknown) {
	if (_warnFn) _warnFn(msg, err)
	else console.warn(`[wrapLegacyStore] ${msg}`, err ?? '')
}

let _warnFn: WarnFn | undefined

// ---- Config ----

export interface WrappedLegacyStore extends JsStoreCallbacks {
	flush(): Promise<void>
	dispose(): void
}

// ---- Store routing ----

// Bridge store name → upstream store type name for keys.get/set.
// ALL data goes through the user-provided keys interface — no separate files.
const STORE_MAP: Record<string, string> = {
	// Signal protocol (binary passthrough with write-through cache)
	identity: 'identity-key',
	session: 'session',
	sender_key: 'sender-key',
	// Upstream Baileys types (with format converters)
	prekey: 'pre-key',
	sync_key: 'app-state-sync-key',
	sync_version: 'app-state-sync-version',
	tc_token: 'tctoken',
	device_list: 'device-list',
	// Bridge-only (stored as raw Buffers with their own type prefix)
	lid_mapping: 'lid-mapping',
	signed_prekey: 'bridge-signed-prekey',
	sender_key_devices: 'bridge-sender-key-devices',
	base_key: 'bridge-base-key',
	sent_message: 'bridge-sent-message',
	mutation_mac: 'bridge-mutation-mac',
	meta: 'bridge-meta'
}

// Stores where bridge data is passthrough binary (no conversion).
// All Signal-protocol records (`identity`, `session`, `sender_key`) now
// route through converters because every one of them either:
//   • has a different key shape between bridge and upstream, OR
//   • has a different value-byte encoding (proto / JSON / 32-vs-33-byte
//     prefix), OR
//   • both.
// Keeping the empty set as an extension point — future bridge stores that
// are byte-compatible with upstream can land here without a converter.
const BINARY_STORES = new Set<string>()

// Bridge-only stores — raw binary persisted through keys interface.
// `lid_mapping` is intentionally excluded — it has a converter so the
// `pn:`/`lid:` prefixed bridge keys translate to upstream's bare-userpart
// `{pnUser}` + `{lidUser}_reverse` shape, letting both libraries share
// the same on-disk LID↔PN mapping table.
const BRIDGE_ONLY_STORES = new Set([
	'signed_prekey',
	'sender_key_devices',
	'base_key',
	'sent_message',
	'mutation_mac',
	'meta'
])

// ---- Bridge Jid type (matches Rust Jid serde derive) ----

interface BridgeJid {
	user: string
	server: string
	device?: number
	agent?: number
	integrator?: number
}

/** Reconstruct a JID string from the bridge's serialized Jid object.
 *  Format: "user:device@server" (device omitted when 0). */
function bridgeJidToString(j: BridgeJid | null | undefined): string | null {
	if (!j?.user || !j?.server) return null
	const device = j.device ?? 0
	return `${j.user}${device > 0 ? ':' + device : ''}@${j.server}`
}

/** Typed subset of the bridge Device JSON we read back in updateCredsFromDevice. */
interface BridgeDeviceJson {
	pn?: BridgeJid | null
	lid?: BridgeJid | null
	registration_id?: number
	push_name?: string
	next_pre_key_id?: number
	props_hash?: string | null
	platform?: string
	adv_secret_key?: number[]
	// Key material persisted by the bridge as `[priv(32)…pub(32)]` arrays.
	// Read back so subsequent calls to `credsToDeviceJson` reconstruct a
	// valid device payload instead of zeroed key slots.
	noise_key?: number[]
	identity_key?: number[]
	signed_pre_key?: number[]
	signed_pre_key_id?: number
	signed_pre_key_signature?: number[]
}

// ---- Helpers ----

const toJson = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
const fromJson = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as unknown
const toBuf = (v: unknown): Uint8Array | null =>
	v instanceof Uint8Array ? v : Buffer.isBuffer(v) ? new Uint8Array(v) : null

/** Convert Buffer/Uint8Array to a plain number[] for JSON serialization.
 *  Matches Rust's serde_json Vec<u8> format: [byte, byte, ...] */
const bufToNumArray = (v: Uint8Array | Buffer): number[] => Array.from(Buffer.from(v))

/** Bridge uses hex-encoded key IDs for sync_key; upstream uses base64. Convert hex→base64. */
const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64')

// ---- Converters per store type ----
// Each returns [toBridge, fromBridge] functions.
// Missing entries → fallback to raw bytes.

type Converter = {
	/** Baileys typed value → bridge Uint8Array */
	toBridge(key: string, value: unknown): Uint8Array | null
	/** Bridge Uint8Array → Baileys typed value */
	fromBridge(key: string, value: Uint8Array): unknown
}

const converters: Record<string, Converter> = {
	prekey: {
		toBridge(key, value) {
			if (value instanceof Uint8Array || Buffer.isBuffer(value)) return toBuf(value)
			const kp = value as { public: Uint8Array; private: Uint8Array }
			return kp.private && kp.public
				? encodePreKeyRecord(parseInt(key) || 0, Buffer.from(kp.public), Buffer.from(kp.private))
				: null
		},
		fromBridge(_key, value) {
			return decodePreKeyRecord(value) ?? Buffer.from(value)
		}
	},

	sync_key: {
		toBridge(_key, value) {
			if (value instanceof Uint8Array || Buffer.isBuffer(value)) return toBuf(value)
			// Rust AppStateSyncKey: key_data=Vec<u8>, fingerprint=Vec<u8> (protobuf-encoded),
			// timestamp=i64. serde_json serializes Vec<u8> as array of numbers.
			const msg = value as proto.Message.IAppStateSyncKeyData
			const fingerprintBytes = msg.fingerprint
				? proto.Message.AppStateSyncKeyFingerprint.encode(
						proto.Message.AppStateSyncKeyFingerprint.create(msg.fingerprint)
					).finish()
				: null
			return toJson({
				key_data: msg.keyData ? bufToNumArray(Buffer.from(msg.keyData)) : [],
				fingerprint: fingerprintBytes ? bufToNumArray(fingerprintBytes) : [],
				timestamp: Number(msg.timestamp ?? 0)
			})
		},
		fromBridge(_key, value) {
			try {
				const j = fromJson(value) as { key_data?: number[]; fingerprint?: number[]; timestamp?: number }
				const keyData = Array.isArray(j.key_data) ? Buffer.from(j.key_data) : undefined
				const fingerprint =
					Array.isArray(j.fingerprint) && j.fingerprint.length > 0
						? proto.Message.AppStateSyncKeyFingerprint.decode(Buffer.from(j.fingerprint))
						: undefined
				return proto.Message.AppStateSyncKeyData.fromObject({
					keyData,
					fingerprint,
					timestamp: j.timestamp ?? 0
				})
			} catch {
				return Buffer.from(value)
			}
		}
	},

	sync_version: {
		toBridge(_key, value) {
			if (value instanceof Uint8Array || Buffer.isBuffer(value)) return toBuf(value)
			// Rust HashState: version=u64, hash=[u8;128] (BigArray → number array),
			// index_value_map=HashMap<String, Vec<u8>> (snake_case, plain byte arrays).
			// Upstream LTHashState: hash=Buffer, indexValueMap={[k]: {valueMac: Buffer}} (camelCase, wrapped).
			const v = value as LTHashState
			const indexValueMap: Record<string, number[]> = {}
			if (v.indexValueMap) {
				for (const [k, entry] of Object.entries(v.indexValueMap)) {
					indexValueMap[k] = bufToNumArray(Buffer.from(entry.valueMac))
				}
			}

			return toJson({
				version: v.version ?? 0,
				hash: v.hash ? bufToNumArray(Buffer.from(v.hash)) : (Array(128) as number[]).fill(0),
				index_value_map: indexValueMap
			})
		},
		fromBridge(_key, value) {
			try {
				const j = fromJson(value) as { version?: number; hash?: number[]; index_value_map?: Record<string, number[]> }
				const indexValueMap: LTHashState['indexValueMap'] = {}
				if (j.index_value_map) {
					for (const [k, v] of Object.entries(j.index_value_map)) {
						indexValueMap[k] = { valueMac: Buffer.from(v) }
					}
				}

				return {
					version: j.version ?? 0,
					hash: Buffer.from(j.hash ?? []),
					indexValueMap
				} satisfies LTHashState
			} catch {
				return Buffer.from(value)
			}
		}
	},

	tc_token: {
		toBridge(_key, value) {
			const tc = value as { token: Buffer; timestamp?: string }
			return toJson({
				token: tc.token ? Buffer.from(tc.token).toString('base64') : '',
				token_timestamp: tc.timestamp ? parseInt(tc.timestamp) : 0
			})
		},
		fromBridge(_key, value) {
			try {
				const j = fromJson(value) as { token?: string; token_timestamp?: number }
				return {
					token: j.token ? Buffer.from(j.token, 'base64') : Buffer.alloc(0),
					timestamp: j.token_timestamp?.toString()
				}
			} catch {
				return { token: Buffer.from(value) }
			}
		}
	},

	device_list: {
		toBridge(key, value) {
			const list = value as string[]
			return toJson({
				user: key,
				devices: list.map(id => ({ device_id: parseInt(id) || 0 })),
				timestamp: Math.floor(Date.now() / 1000)
			})
		},
		fromBridge(_key, value) {
			try {
				const r = fromJson(value) as { devices?: Array<{ device_id?: number }> }
				const items = r.devices ?? []
				return items.map(d => String(d.device_id ?? 0))
			} catch {
				return []
			}
		}
	},

	// identity: bridge holds 32-byte raw DJB pubkey, upstream holds 33 bytes
	// (0x05 || 32-byte) — the curve25519-XEdDSA wire form.
	identity: {
		toBridge(_key, value) {
			const buf = toBuf(value)
			if (!buf) return null
			return buf.length === 33 && buf[0] === 0x05 ? new Uint8Array(buf.slice(1)) : buf
		},
		fromBridge(_key, value) {
			const v = Buffer.isBuffer(value) ? value : Buffer.from(value)
			return v.length === 32 ? Buffer.concat([Buffer.from([0x05]), v]) : Buffer.from(v)
		}
	},

	// lid_mapping: bridge uses prefixed keys (`lid:{X}` JSON entry,
	// `pn:{X}` raw LID bytes); upstream uses bare keys (`{pnUser}` string LID,
	// `{lidUser}_reverse` string PN). No upstream timestamps; we synthesise.
	lid_mapping: {
		toBridge(key, value) {
			try {
				const asString = typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString('utf-8')
				if (!asString) return null
				if (key.startsWith('pn:')) return new TextEncoder().encode(asString)
				if (key.startsWith('lid:')) {
					const now = Math.floor(Date.now() / 1000)
					return toJson({
						lid: key.slice(4),
						phone_number: asString,
						created_at: now,
						updated_at: now,
						learning_source: 'wrap-legacy-store'
					})
				}
				warn(`lid_mapping.toBridge: unknown key prefix in "${key}"`)
				return null
			} catch (e) {
				warn('lid_mapping.toBridge failed:', e)
				return null
			}
		},
		fromBridge(key, value) {
			try {
				if (key.startsWith('pn:')) return Buffer.from(value).toString('utf-8')
				if (key.startsWith('lid:')) {
					const entry = fromJson(value) as { phone_number?: string }
					return entry.phone_number ?? ''
				}
				warn(`lid_mapping.fromBridge: unknown key prefix in "${key}"`)
				return Buffer.from(value)
			} catch (e) {
				warn('lid_mapping.fromBridge failed:', e)
				return Buffer.from(value)
			}
		}
	},

	// session: bridge=protobuf RecordStructure, upstream=JS object
	// `{_sessions: {[b64BaseKey]: SessionEntry}, version: 'v1'}` with byte
	// fields stored as base64 strings inside the entry. messageKeys cache
	// is lossy in the Rust→JS direction (HKDF is one-way) — see
	// `bridgeSessionProtoToUpstreamRecord`.
	session: {
		toBridge(_key, value) {
			try {
				if (value == null) return null // eslint-disable-line eqeqeq
				return upstreamSessionRecordToProto(value)
			} catch (e) {
				warn('session.toBridge encode failed:', e)
				return null
			}
		},
		fromBridge(_key, value) {
			try {
				return bridgeSessionProtoToUpstreamRecord(value)
			} catch (e) {
				warn('session.fromBridge decode failed:', e)
				return Buffer.from(value)
			}
		}
	},

	// sender_key: bridge=protobuf SenderKeyRecordStructure, upstream=
	// `Buffer.from(JSON.stringify(states, BufferJSON.replacer), 'utf-8')`
	// — Buffer fields wrapped as `{type:'Buffer', data:'<base64>'}`.
	sender_key: {
		toBridge(_key, value) {
			try {
				const buf = toBuf(value)
				if (!buf) return null
				return upstreamSenderKeyJsonToProto(buf)
			} catch (e) {
				warn('sender_key.toBridge decode failed:', e)
				return null
			}
		},
		fromBridge(_key, value) {
			try {
				return bridgeSenderKeyProtoToJson(value)
			} catch (e) {
				warn('sender_key.fromBridge encode failed:', e)
				return Buffer.from(value)
			}
		}
	}
}

// ── sender_key value translators ──

interface UpstreamSenderKeyState {
	senderKeyId?: number
	senderChainKey?: { iteration?: number; seed?: Uint8Array | Buffer }
	senderSigningKey?: { public?: Uint8Array | Buffer; private?: Uint8Array | Buffer }
	senderMessageKeys?: Array<{ iteration?: number; seed?: Uint8Array | Buffer }>
}

// BufferJSON-compatible replacer/reviver matching upstream `Utils/generics`.
const bufferJsonReplacer = (_k: string, v: unknown): unknown => {
	if (Buffer.isBuffer(v) || v instanceof Uint8Array || (v as { type?: string })?.type === 'Buffer') {
		const data = (v as { data?: unknown })?.data ?? v
		return { type: 'Buffer', data: Buffer.from(data as Uint8Array).toString('base64') }
	}
	return v
}
const bufferJsonReviver = (_k: string, v: unknown): unknown => {
	const obj = v as { type?: string; data?: unknown } | null
	if (obj && typeof obj === 'object' && obj.type === 'Buffer' && typeof obj.data === 'string') {
		return Buffer.from(obj.data, 'base64')
	}
	return v
}

const sk_toBytes = (v: Uint8Array | Buffer | undefined): Uint8Array =>
	v ? new Uint8Array(Buffer.from(v)) : new Uint8Array()
const sk_toBuffer = (v: Uint8Array | Buffer | undefined): Buffer => Buffer.from(v ?? new Uint8Array())

function bridgeSenderKeyProtoToJson(protoBytes: Uint8Array): Buffer {
	const struct = proto.SenderKeyRecordStructure.decode(Buffer.from(protoBytes)) as unknown as {
		senderKeyStates?: Array<{
			senderKeyId?: number
			senderChainKey?: { iteration?: number; seed?: Uint8Array }
			senderSigningKey?: { public?: Uint8Array; private?: Uint8Array }
			senderMessageKeys?: Array<{ iteration?: number; seed?: Uint8Array }>
		}>
	}
	const states: UpstreamSenderKeyState[] = (struct.senderKeyStates ?? []).map(s => ({
		senderKeyId: s.senderKeyId ?? 0,
		senderChainKey: { iteration: s.senderChainKey?.iteration ?? 0, seed: sk_toBuffer(s.senderChainKey?.seed) },
		senderSigningKey: {
			public: sk_toBuffer(s.senderSigningKey?.public),
			private: sk_toBuffer(s.senderSigningKey?.private)
		},
		senderMessageKeys: (s.senderMessageKeys ?? []).map(mk => ({
			iteration: mk.iteration ?? 0,
			seed: sk_toBuffer(mk.seed)
		}))
	}))
	return Buffer.from(JSON.stringify(states, bufferJsonReplacer), 'utf-8')
}

function upstreamSenderKeyJsonToProto(jsonBuf: Uint8Array): Uint8Array {
	const states = JSON.parse(Buffer.from(jsonBuf).toString('utf-8'), bufferJsonReviver) as UpstreamSenderKeyState[]
	const senderKeyStates = states.map(s => ({
		senderKeyId: s.senderKeyId ?? 0,
		senderChainKey: { iteration: s.senderChainKey?.iteration ?? 0, seed: sk_toBytes(s.senderChainKey?.seed) },
		senderSigningKey: {
			public: sk_toBytes(s.senderSigningKey?.public),
			private: sk_toBytes(s.senderSigningKey?.private)
		},
		senderMessageKeys: (s.senderMessageKeys ?? []).map(mk => ({
			iteration: mk.iteration ?? 0,
			seed: sk_toBytes(mk.seed)
		}))
	}))
	return proto.SenderKeyRecordStructure.encode(proto.SenderKeyRecordStructure.create({ senderKeyStates })).finish()
}

// sender_key key translation: bridge `{group}:{user}[:dev]@{server}.{sig}`
// → upstream `{group}::{signalUser}::{deviceId}`. Group JIDs never contain
// `:`, so the first `:` separates group from sender address.
function bridgeSenderKeyToUpstream(bridgeKey: string): string | null {
	const sep = bridgeKey.indexOf(':')
	if (sep < 0) return null
	const groupJid = bridgeKey.slice(0, sep)
	const addrStr = bridgeKey.slice(sep + 1)
	const dotIdx = addrStr.lastIndexOf('.')
	if (dotIdx < 0) return null
	const jidPart = addrStr.slice(0, dotIdx)
	const atIdx = jidPart.indexOf('@')
	if (atIdx < 0) return null
	const userPart = jidPart.slice(0, atIdx)
	const server = jidPart.slice(atIdx + 1)
	const [user, jidDev] = userPart.includes(':')
		? [userPart.slice(0, userPart.indexOf(':')), parseInt(userPart.slice(userPart.indexOf(':') + 1), 10) || 0]
		: [userPart, 0]
	const domainType = DOMAIN_TYPE_MAP[server]
	if (domainType === undefined) return null
	return `${groupJid}::${domainType !== 0 ? `${user}_${domainType}` : user}::${jidDev}`
}

// ── session value translators ──
//
// Bridge proto `RecordStructure { current_session, previous_sessions[] }`
// ↔ upstream JS `{_sessions: {[b64BaseKey]: SessionEntry}, version: 'v1'}`.
//
// Field map:
//   senderChain.senderRatchetKey ↔ currentRatchet.ephemeralKeyPair.pubKey
//   senderChain.senderRatchetKeyPrivate ↔ currentRatchet.ephemeralKeyPair.privKey
//   senderChain.chainKey ↔ _chains[senderPubB64] (chainType=SENDING)
//   receiverChains[].senderRatchetKey/chainKey ↔ _chains[peerPubB64] (chainType=RECEIVING)
//   tail receiverChain.senderRatchetKey ↔ currentRatchet.lastRemoteEphemeralKey
//   rootKey, previousCounter ↔ currentRatchet.{rootKey, previousCounter}
//   aliceBaseKey ↔ indexInfo.baseKey (always populated, baseKeyType derived)
//   remoteIdentityPublic ↔ indexInfo.remoteIdentityKey
//   remoteRegistrationId ↔ registrationId
//   pendingPreKey.{preKeyId, signedPreKeyId, baseKey} ↔ pendingPreKey.{preKeyId, signedKeyId, baseKey}
//
// Lossiness: messageKeys cache is recoverable JS→Rust via HKDF-SHA256
// (deriveProtoMessageKey) but NOT Rust→JS — Rust stores the post-split
// cipher/mac/iv and HKDF is one-way. Rust→JS drops the cache; the
// protocol asks for a retry on cache miss.

interface UpstreamChainEntry {
	chainKey: { counter: number; key: string }
	chainType: number
	messageKeys: Record<string, string>
}

interface UpstreamSessionEntry {
	registrationId?: number
	currentRatchet: {
		ephemeralKeyPair: { pubKey: string; privKey: string }
		lastRemoteEphemeralKey: string
		previousCounter: number
		rootKey: string
	}
	indexInfo: {
		baseKey: string
		baseKeyType: number
		closed: number
		used: number
		created: number
		remoteIdentityKey: string
	}
	_chains: Record<string, UpstreamChainEntry>
	pendingPreKey?: { preKeyId?: number; signedKeyId?: number; baseKey: string }
}

interface UpstreamSessionRecord {
	_sessions: Record<string, UpstreamSessionEntry>
	version: 'v1'
}

const CHAIN_TYPE_SENDING = 1
const CHAIN_TYPE_RECEIVING = 2
const BASE_KEY_TYPE_OURS = 1
const BASE_KEY_TYPE_THEIRS = 2

const b64 = (b: Uint8Array | undefined | null): string =>
	b ? Buffer.from(b).toString('base64') : Buffer.alloc(0).toString('base64')

const fromB64 = (s: string | undefined | null): Buffer => (s ? Buffer.from(s, 'base64') : Buffer.alloc(0))

interface BridgeChainProto {
	senderRatchetKey?: Uint8Array | null
	senderRatchetKeyPrivate?: Uint8Array | null
	chainKey?: { index?: number; key?: Uint8Array } | null
	messageKeys?: BridgeMessageKeyProto[]
}

interface BridgeMessageKeyProto {
	index: number
	cipherKey: Uint8Array
	macKey: Uint8Array
	iv: Uint8Array
}

/**
 * Derive Rust's per-message split (cipher 32 / mac 32 / iv 16) from JS's
 * 32-byte `messageKey` seed. Both impls compute HKDF-SHA256 with
 * salt=[0u8;32] and info="WhisperMessageKeys" — Rust's `None` salt
 * defaults to a zero-byte HashLen string, so the output is byte-identical.
 * Reverse direction (Rust→JS) is impossible: HKDF is one-way.
 */
function deriveProtoMessageKey(seed: Buffer, counter: number): BridgeMessageKeyProto {
	const prk = createHmac('sha256', Buffer.alloc(32)).update(seed).digest()
	const info = Buffer.from('WhisperMessageKeys')
	const expand = (prev: Buffer, n: number) =>
		createHmac('sha256', prk)
			.update(Buffer.concat([prev, info, Buffer.from([n])]))
			.digest()
	const t1 = expand(Buffer.alloc(0), 0x01)
	const t2 = expand(t1, 0x02)
	const t3 = expand(t2, 0x03)
	return {
		index: counter,
		cipherKey: new Uint8Array(t1),
		macKey: new Uint8Array(t2),
		iv: new Uint8Array(t3.subarray(0, 16))
	}
}

function jsChainMessageKeysToProto(messageKeys: Record<string, string> | undefined): BridgeMessageKeyProto[] {
	if (!messageKeys) return []
	const out: BridgeMessageKeyProto[] = []
	for (const [counterStr, seedB64] of Object.entries(messageKeys)) {
		const counter = parseInt(counterStr, 10)
		if (!Number.isFinite(counter)) continue
		const seed = fromB64(seedB64)
		if (seed.length > 0) out.push(deriveProtoMessageKey(seed, counter))
	}
	return out
}

interface BridgeSessionProto {
	rootKey?: Uint8Array | null
	previousCounter?: number | null
	senderChain?: BridgeChainProto | null
	receiverChains?: BridgeChainProto[]
	pendingPreKey?: { preKeyId?: number | null; signedPreKeyId?: number | null; baseKey?: Uint8Array | null } | null
	remoteIdentityPublic?: Uint8Array | null
	remoteRegistrationId?: number | null
	aliceBaseKey?: Uint8Array | null
}

function sessionStructureToEntry(session: BridgeSessionProto, closedTs: number): UpstreamSessionEntry | null {
	if (!session.senderChain || !session.rootKey) return null

	// aliceBaseKey is set by Rust on BOTH sides (alice=our ephemeral, bob=
	// peer's ephemeral). pendingPreKey is the side discriminator (alice
	// only, cleared on first reply).
	const baseKeyBytes = session.aliceBaseKey ?? session.senderChain.senderRatchetKey
	if (!baseKeyBytes) return null
	const weAreAlice = !!session.pendingPreKey?.baseKey
	const baseKeyType = weAreAlice ? BASE_KEY_TYPE_OURS : BASE_KEY_TYPE_THEIRS

	// lastRemoteEphemeralKey precedence: tail receiverChain → aliceBaseKey
	// (when bob, matches JS init) → empty. NEVER senderRatchetKey: that
	// collides with the SENDER chain in `_chains`, and upstream's
	// `maybeStepRatchet` would `delete previousRatchet.chainKey.key` on
	// the sender chain when the peer ratchets, corrupting outbound encryption.
	const receiverChains = session.receiverChains ?? []
	const lastReceiver = receiverChains[receiverChains.length - 1]
	const lastRemoteEph =
		lastReceiver?.senderRatchetKey && lastReceiver.senderRatchetKey.length > 0
			? lastReceiver.senderRatchetKey
			: !weAreAlice && session.aliceBaseKey && session.aliceBaseKey.length > 0
				? session.aliceBaseKey
				: new Uint8Array()

	const senderRatchetPub = session.senderChain.senderRatchetKey ?? new Uint8Array()
	const senderRatchetPriv = session.senderChain.senderRatchetKeyPrivate ?? new Uint8Array()

	const _chains: Record<string, UpstreamChainEntry> = {}
	if (session.senderChain.chainKey?.key && senderRatchetPub.length > 0) {
		_chains[b64(senderRatchetPub)] = {
			chainKey: { counter: session.senderChain.chainKey.index ?? 0, key: b64(session.senderChain.chainKey.key) },
			chainType: CHAIN_TYPE_SENDING,
			messageKeys: {}
		}
	}
	for (const rc of receiverChains) {
		if (!rc.chainKey?.key || !rc.senderRatchetKey || rc.senderRatchetKey.length === 0) continue
		_chains[b64(rc.senderRatchetKey)] = {
			chainKey: { counter: rc.chainKey.index ?? 0, key: b64(rc.chainKey.key) },
			chainType: CHAIN_TYPE_RECEIVING,
			messageKeys: {}
		}
	}

	const now = Date.now()
	const entry: UpstreamSessionEntry = {
		registrationId: session.remoteRegistrationId ?? 0,
		currentRatchet: {
			ephemeralKeyPair: { pubKey: b64(senderRatchetPub), privKey: b64(senderRatchetPriv) },
			lastRemoteEphemeralKey: b64(lastRemoteEph),
			previousCounter: session.previousCounter ?? 0,
			rootKey: b64(session.rootKey)
		},
		indexInfo: {
			baseKey: b64(baseKeyBytes),
			baseKeyType,
			closed: closedTs,
			used: now,
			created: now,
			remoteIdentityKey: b64(session.remoteIdentityPublic ?? new Uint8Array())
		},
		_chains
	}

	if (session.pendingPreKey?.baseKey) {
		entry.pendingPreKey = {
			preKeyId: session.pendingPreKey.preKeyId ?? undefined,
			signedKeyId: session.pendingPreKey.signedPreKeyId ?? undefined,
			baseKey: b64(session.pendingPreKey.baseKey)
		}
	}

	return entry
}

function bridgeSessionProtoToUpstreamRecord(protoBytes: Uint8Array): UpstreamSessionRecord {
	const record = proto.RecordStructure.decode(Buffer.from(protoBytes)) as unknown as {
		currentSession?: BridgeSessionProto | null
		previousSessions?: BridgeSessionProto[]
	}
	const _sessions: Record<string, UpstreamSessionEntry> = {}

	const current = record.currentSession ? sessionStructureToEntry(record.currentSession, -1) : null
	if (current) _sessions[current.indexInfo.baseKey] = current

	// Synthesize descending close timestamps so removeOldSessions can sort:
	// front of Rust `previous_sessions` is the most recently archived.
	const previous = record.previousSessions ?? []
	for (let i = 0; i < previous.length; i++) {
		const entry = sessionStructureToEntry(previous[i]!, Math.max(1, Date.now() - i))
		if (entry && !_sessions[entry.indexInfo.baseKey]) _sessions[entry.indexInfo.baseKey] = entry
	}

	return { _sessions, version: 'v1' }
}

function entryToSessionStructure(entry: UpstreamSessionEntry): BridgeSessionProto {
	const ratchet = entry.currentRatchet
	const senderRatchetPub = fromB64(ratchet.ephemeralKeyPair.pubKey)
	const senderRatchetPriv = fromB64(ratchet.ephemeralKeyPair.privKey)
	const senderKeyB64 = senderRatchetPub.toString('base64')

	const senderChainEntry = entry._chains[senderKeyB64]
	const senderChain: BridgeChainProto = {
		senderRatchetKey: new Uint8Array(senderRatchetPub),
		senderRatchetKeyPrivate: new Uint8Array(senderRatchetPriv),
		chainKey: senderChainEntry
			? { index: senderChainEntry.chainKey.counter, key: new Uint8Array(fromB64(senderChainEntry.chainKey.key)) }
			: { index: 0, key: new Uint8Array() },
		messageKeys: [] // sender chain is sequential — no skipped cache either side
	}

	const receiverChains: BridgeChainProto[] = []
	for (const [k, ch] of Object.entries(entry._chains)) {
		if (ch.chainType !== CHAIN_TYPE_RECEIVING) continue
		receiverChains.push({
			senderRatchetKey: new Uint8Array(fromB64(k)),
			chainKey: { index: ch.chainKey.counter, key: new Uint8Array(fromB64(ch.chainKey.key)) },
			// JS holds 32-byte HMAC seeds; Rust holds the post-HKDF split.
			// Lossless JS→Rust derivation via deriveProtoMessageKey.
			messageKeys: jsChainMessageKeysToProto(ch.messageKeys)
		})
	}

	// `indexInfo.baseKey` IS the alice_base_key in either direction
	// (alice=our ephemeral, bob=peer's ephemeral). Rust populates it
	// symmetrically; dropping it would break find_matching_previous_session_index.
	const session: BridgeSessionProto = {
		rootKey: new Uint8Array(fromB64(ratchet.rootKey)),
		previousCounter: ratchet.previousCounter,
		senderChain,
		receiverChains,
		remoteIdentityPublic: new Uint8Array(fromB64(entry.indexInfo.remoteIdentityKey)),
		remoteRegistrationId: entry.registrationId ?? 0,
		aliceBaseKey: new Uint8Array(fromB64(entry.indexInfo.baseKey))
	}

	if (entry.pendingPreKey?.baseKey) {
		session.pendingPreKey = {
			preKeyId: entry.pendingPreKey.preKeyId ?? null,
			signedPreKeyId: entry.pendingPreKey.signedKeyId ?? null,
			baseKey: new Uint8Array(fromB64(entry.pendingPreKey.baseKey))
		}
	}

	return session
}

function upstreamSessionRecordToProto(record: unknown): Uint8Array {
	const sessions = (record as UpstreamSessionRecord)?._sessions ?? {}
	let currentSession: BridgeSessionProto | null = null
	const previousSessions: BridgeSessionProto[] = []
	for (const entry of Object.values(sessions)) {
		const ss = entryToSessionStructure(entry)
		if (!currentSession && entry.indexInfo.closed === -1) currentSession = ss
		else previousSessions.push(ss)
	}
	// `BridgeSessionProto` is a structural mirror of `ISessionStructure`
	// from `whatsapp-rust-bridge/proto-types`; the differences are nullable
	// vs optional fields. We cast at the boundary to avoid pulling the full
	// proto class types into our internal shape.
	const recordOut = proto.RecordStructure.create({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		currentSession: (currentSession ?? undefined) as any,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		previousSessions: previousSessions as any
	})
	return proto.RecordStructure.encode(recordOut).finish()
}

// session/identity key translation: bridge `{user}[:dev]@{server}.{sig}`
// → upstream `{signalUser}.{deviceId}` via `bridgeAddrToBaileysAddr`.

// ---- Device/Creds ----

/** Parse a JID string into { user, device, server } */
function parseJid(jid: string | undefined): { user: string; device: number; server: string } | null {
	if (!jid) return null
	const atIdx = jid.indexOf('@')
	if (atIdx < 0) return null
	const server = jid.slice(atIdx + 1)
	const userPart = jid.slice(0, atIdx)
	const colonIdx = userPart.indexOf(':')
	if (colonIdx >= 0) {
		return { user: userPart.slice(0, colonIdx), device: parseInt(userPart.slice(colonIdx + 1)) || 0, server }
	}

	return { user: userPart, device: 0, server }
}

function credsToDeviceJson(creds: AuthenticationCreds): Uint8Array {
	/** Serialize a key pair as [private(32) + public(32)] matching Rust key_pair_serde */
	const kp = (pair: { public: Uint8Array; private: Uint8Array } | undefined): number[] => {
		if (!pair) return (Array(64) as number[]).fill(0)
		return bufToNumArray(Buffer.from(pair.private)).concat(bufToNumArray(Buffer.from(pair.public)))
	}

	// Extract device number from me.id (e.g. "559984726662:7@s.whatsapp.net")
	// or fall back to me.lid (e.g. "236395184570386:10@lid") for the device index
	const pnJid = parseJid(creds.me?.id)
	const lidJid = parseJid(creds.me?.lid)
	// If me.id has no device suffix, use the LID's device number
	const deviceNum = pnJid && pnJid.device > 0 ? pnJid.device : (lidJid?.device ?? 0)

	return toJson({
		pn: pnJid ? { user: pnJid.user, server: 's.whatsapp.net', device: deviceNum, agent: 0, integrator: 0 } : null,
		lid: lidJid ? { user: lidJid.user, server: 'lid', device: lidJid.device, agent: 0, integrator: 0 } : null,
		registration_id: creds.registrationId ?? 0,
		noise_key: kp(creds.noiseKey),
		identity_key: kp(creds.signedIdentityKey),
		signed_pre_key: kp(creds.signedPreKey?.keyPair),
		signed_pre_key_id: creds.signedPreKey?.keyId ?? 1,
		signed_pre_key_signature: creds.signedPreKey?.signature
			? bufToNumArray(Buffer.from(creds.signedPreKey.signature))
			: (Array(64) as number[]).fill(0),
		adv_secret_key: creds.advSecretKey
			? bufToNumArray(Buffer.from(creds.advSecretKey, 'base64'))
			: (Array(32) as number[]).fill(0),
		account: null,
		push_name: creds.me?.name ?? '',
		app_version_primary: 2,
		app_version_secondary: 3000,
		app_version_tertiary: 0,
		app_version_last_fetched_ms: 0,
		edge_routing_info: creds.routingInfo ? bufToNumArray(creds.routingInfo) : null,
		props_hash: creds.lastPropHash ?? null,
		next_pre_key_id: creds.nextPreKeyId ?? 1
	})
}

/**
 * Decode a `[priv(32)…pub(32)]` byte array (the bridge's `kp` shape) back into
 * the upstream Baileys `{public, private}` keypair. Returns `undefined` for
 * absent / all-zero arrays so callers can use `??` to keep prior values.
 */
function numArrayToKeyPair(arr: number[] | undefined): { public: Uint8Array; private: Uint8Array } | undefined {
	if (!Array.isArray(arr) || arr.length < 64) return undefined
	if (arr.every(b => b === 0)) return undefined
	return {
		private: new Uint8Array(arr.slice(0, 32)),
		public: new Uint8Array(arr.slice(32, 64))
	}
}

function updateCredsFromDevice(bytes: Uint8Array, creds: AuthenticationCreds): void {
	try {
		const d = fromJson(bytes) as BridgeDeviceJson

		// Reconstruct pn JID: bridge stores Jid as { user, server, device, agent, integrator }
		// bridgeJidToString produces "user:device@server" (device omitted when 0)
		const pnJid = bridgeJidToString(d.pn)
		if (pnJid) {
			if (!creds.me) creds.me = { id: pnJid }
			else creds.me.id = pnJid
		}

		// Reconstruct LID JID
		const lidJid = bridgeJidToString(d.lid)
		if (lidJid && creds.me) creds.me.lid = lidJid

		if (d.push_name && creds.me) creds.me.name = d.push_name
		if (d.registration_id) creds.registrationId = d.registration_id
		if (d.next_pre_key_id) creds.nextPreKeyId = d.next_pre_key_id
		if (d.props_hash !== undefined) creds.lastPropHash = d.props_hash ?? undefined
		if (d.platform) creds.platform = d.platform

		// adv_secret_key: bridge stores as [u8; 32] (array of 32 numbers),
		// upstream stores as base64 string
		if (Array.isArray(d.adv_secret_key)) {
			const buf = Buffer.from(d.adv_secret_key)
			if (buf.some(b => b !== 0)) {
				creds.advSecretKey = buf.toString('base64')
			}
		}

		// Hydrate the noise / identity / signed pre-key material so the next
		// `credsToDeviceJson(creds)` round-trip emits real bytes instead of
		// zero-filled placeholders. Without this, a paired session looks
		// half-valid on the next process start (`me.id` set, but key slots
		// all zero) and the bridge's noise handshake gets rejected by the
		// server with stream-error precondition-required.
		const noise = numArrayToKeyPair(d.noise_key)
		if (noise) creds.noiseKey = noise

		const identity = numArrayToKeyPair(d.identity_key)
		if (identity) creds.signedIdentityKey = identity

		const signedPreKeyPair = numArrayToKeyPair(d.signed_pre_key)
		if (
			signedPreKeyPair &&
			Array.isArray(d.signed_pre_key_signature) &&
			d.signed_pre_key_signature.length === 64 &&
			d.signed_pre_key_signature.some(b => b !== 0)
		) {
			creds.signedPreKey = {
				keyPair: signedPreKeyPair,
				keyId: d.signed_pre_key_id ?? 1,
				signature: new Uint8Array(d.signed_pre_key_signature)
			}
		}
	} catch (e) {
		warn('updateCredsFromDevice failed:', e)
	}
}

// ---- Protobuf helpers (PreKeyRecordStructure) ----

function encodePreKeyRecord(id: number, pub: Buffer, priv: Buffer): Uint8Array {
	const out: number[] = []
	out.push(0x08)
	encodeVarint(out, id) // field 1: id
	out.push(0x12)
	encodeVarint(out, pub.length) // field 2: public_key
	for (let i = 0; i < pub.length; i++) out.push(pub[i]!)
	out.push(0x1a)
	encodeVarint(out, priv.length) // field 3: private_key
	for (let i = 0; i < priv.length; i++) out.push(priv[i]!)
	return new Uint8Array(out)
}

function decodePreKeyRecord(data: Uint8Array): { public: Buffer; private: Buffer } | null {
	try {
		let pos = 0,
			pub: Buffer | null = null,
			priv: Buffer | null = null
		while (pos < data.length) {
			const [tag, p1] = readVarint(data, pos)
			pos = p1
			const wt = tag & 7,
				fn = tag >> 3
			if (wt === 0) {
				const [, p2] = readVarint(data, pos)
				pos = p2
			} else if (wt === 2) {
				const [len, p2] = readVarint(data, pos)
				pos = p2
				const bytes = Buffer.from(data.slice(pos, pos + len))
				pos += len
				if (fn === 2) pub = bytes
				else if (fn === 3) priv = bytes
			} else break
		}

		return pub && priv ? { public: pub, private: priv } : null
	} catch {
		return null
	}
}

// ---- Protobuf varint helpers ----

function encodeVarint(out: number[], v: number) {
	while (v > 0x7f) {
		out.push((v & 0x7f) | 0x80)
		v >>>= 7
	}

	out.push(v & 0x7f)
}

function readVarint(d: Uint8Array, p: number): [number, number] {
	let r = 0,
		s = 0
	while (p < d.length) {
		const b = d[p]!
		p++
		r |= (b & 0x7f) << s
		if (!(b & 0x80)) return [r, p]
		s += 7
	}

	return [r, p]
}

// ---- Signal address translation ----
// Bridge uses JID-based addresses: "236395184570386@lid.0", "559984726662@c.us.0"
// Baileys uses domain-type addresses: "236395184570386_1.0", "559984726662.0"
// Domain types: s.whatsapp.net/c.us=0, lid=1, hosted=2, hosted.lid=3
const DOMAIN_TYPE_MAP: Record<string, number> = { lid: 1, 'c.us': 0, 's.whatsapp.net': 0, hosted: 2, 'hosted.lid': 3 }

/** Convert bridge signal address to Baileys signal address */
function bridgeAddrToBaileysAddr(bridgeAddr: string): string | null {
	// Format: "user@domain.signalDevice" or "user:jidDevice@domain.signalDevice"
	const dotIdx = bridgeAddr.lastIndexOf('.')
	if (dotIdx < 0) return null
	const signalDevice = bridgeAddr.slice(dotIdx + 1)
	const jidPart = bridgeAddr.slice(0, dotIdx) // "user@domain" or "user:jidDevice@domain"

	const atIdx = jidPart.indexOf('@')
	if (atIdx < 0) return null
	const domain = jidPart.slice(atIdx + 1)
	const userPart = jidPart.slice(0, atIdx) // "user" or "user:jidDevice"

	const domainType = DOMAIN_TYPE_MAP[domain]
	if (domainType === undefined) return null

	// Baileys format: "user_domainType.device" or "user.device" (when domainType=0)
	// For JID device: "user_domainType:jidDevice.device"
	let baileysUser: string
	if (userPart.includes(':')) {
		// Has JID device: "user:jidDevice" → for signal address, device is the JID device
		const [user, jidDevice] = userPart.split(':')
		baileysUser = domainType !== 0 ? `${user}_${domainType}` : user!
		return `${baileysUser}.${jidDevice}`
	} else {
		baileysUser = domainType !== 0 ? `${userPart}_${domainType}` : userPart
		return `${baileysUser}.${signalDevice}`
	}
}

// ---- Account normalization ----
// Upstream Baileys stores account fields as base64 strings (protobuf.js toJSON),
// but the bridge's encodeProto expects Uint8Array for bytes fields.
function normalizeAccountForEncode(account: {
	details?: unknown
	accountSignatureKey?: unknown
	accountSignature?: unknown
	deviceSignature?: unknown
}): Record<string, Uint8Array | undefined> {
	const toBytes = (v: unknown): Uint8Array | undefined => {
		if (v instanceof Uint8Array) return v
		if (Buffer.isBuffer(v)) return new Uint8Array(v)
		if (typeof v === 'string') return Buffer.from(v, 'base64')
		return undefined
	}

	return {
		details: toBytes(account.details),
		accountSignatureKey: toBytes(account.accountSignatureKey),
		accountSignature: toBytes(account.accountSignature),
		deviceSignature: toBytes(account.deviceSignature)
	}
}

// ---- Main ----

export async function wrapLegacyStore(
	state: AuthenticationState,
	saveCreds: () => Promise<void>,
	logger?: { warn: (obj: unknown, msg?: string) => void }
): Promise<WrappedLegacyStore> {
	if (logger) {
		_warnFn = (msg, err) => logger.warn({ err }, msg)
	}

	if (!state.creds || !state.keys) {
		throw new Error('wrapLegacyStore requires an AuthenticationState with creds and keys')
	}

	const creds = state.creds
	const keys = state.keys

	// Typed wrappers around keys.get/set — the bridge uses store names beyond
	// SignalDataTypeMap (e.g., 'bridge-meta', 'lid-mapping'), so we widen the type.
	type KeysStore = {
		get(type: string, ids: string[]): Promise<Record<string, unknown>>
		set(data: Record<string, Record<string, unknown>>): Promise<void> | void
	}
	const store = keys as unknown as KeysStore

	const storeGetOne = async (type: string, id: string): Promise<unknown> => {
		const result = await store.get(type, [id])
		return result[id] ?? null
	}

	const storeSetOne = (type: string, id: string, value: unknown) => store.set({ [type]: { [id]: value } })

	let credsTimer: ReturnType<typeof setTimeout> | null = null
	const debounceSave = () => {
		if (credsTimer) clearTimeout(credsTimer)
		credsTimer = setTimeout(() => {
			credsTimer = null
			saveCreds().catch(() => {})
		}, 100)
	}

	/** Route a store to its handler */
	const resolve = (storeName: string): 'device' | 'signal' | 'bridge-only' | 'converter' | 'unknown' => {
		if (storeName === 'device') return 'device'
		if (BINARY_STORES.has(storeName)) return 'signal'
		if (BRIDGE_ONLY_STORES.has(storeName)) return 'bridge-only'
		if (STORE_MAP[storeName]) return 'converter'
		return 'unknown'
	}

	/** Translate bridge key format to upstream Baileys key format */
	const translateKey = (storeName: string, key: string): string => {
		// Bridge encodes sync_key IDs as hex; upstream stores use base64
		if (storeName === 'sync_key') return hexToBase64(key)
		// Bridge sender_key cache_key uses single-colon separator + signal-
		// device suffix; upstream's `SenderKeyName.serialize()` uses double
		// colons and drops the signal device — see bridgeSenderKeyToUpstream.
		if (storeName === 'sender_key') {
			const translated = bridgeSenderKeyToUpstream(key)
			if (translated == null) {
				// eslint-disable-line eqeqeq -- intentional null+undefined check
				warn(`sender_key key translation failed for "${key}", falling back to passthrough`)
				return key
			}
			return translated
		}
		// Bridge session/identity keys are the protocol address
		// (`user[:dev]@server.sig`); upstream's libsignal looks under
		// `signalUser.deviceId`. `bridgeAddrToBaileysAddr` does the LID/PN
		// → signalUser rewrite + JID-device extraction.
		if (storeName === 'session' || storeName === 'identity') {
			const translated = bridgeAddrToBaileysAddr(key)
			if (translated == null) {
				// eslint-disable-line eqeqeq -- intentional null+undefined check
				warn(`${storeName} key translation failed for "${key}", falling back to passthrough`)
				return key
			}
			return translated
		}
		// Bridge lid_mapping uses prefixed keys (`lid:{X}`, `pn:{X}`) that
		// upstream's `Signal/lid-mapping.js` doesn't recognize. Map them to
		// upstream's bare-userpart shape: `pn:{X}` → `{X}`, `lid:{X}` →
		// `{X}_reverse`.
		if (storeName === 'lid_mapping') {
			if (key.startsWith('pn:')) return key.slice(3)
			if (key.startsWith('lid:')) return `${key.slice(4)}_reverse`
			return key
		}
		return key
	}

	/** Read a binary value from the keys store */
	async function readBinary(type: string, id: string): Promise<Uint8Array | null> {
		try {
			const val = await storeGetOne(type, id)
			return val != null ? toBuf(val as Uint8Array) : null // eslint-disable-line eqeqeq -- intentional null+undefined check
		} catch (e) {
			warn(`GET ${type}/${id} failed:`, e)
			return null
		}
	}

	/** Write a binary value to the keys store */
	async function writeBinary(type: string, id: string, value: Uint8Array): Promise<void> {
		try {
			await storeSetOne(type, id, Buffer.from(value))
		} catch (e) {
			warn(`SET ${type}/${id} failed:`, e)
		}
	}

	/** Delete a value from the keys store */
	async function storeDelete(type: string, id: string): Promise<void> {
		try {
			await storeSetOne(type, id, null)
		} catch (e) {
			warn(`DELETE ${type}/${id} failed:`, e)
		}
	}

	return {
		async get(bridgeStore, key) {
			const route = resolve(bridgeStore)
			const type = STORE_MAP[bridgeStore]!

			if (route === 'device') {
				if (key === 'device') {
					// Fresh/stub creds (baileyrs' `initAuthCreds()` shim, or an
					// upstream flow that hadn't finished its first pair) carry
					// neither a noise key nor a paired `me.id`. Returning a
					// zeroed `credsToDeviceJson` in that state poisons the
					// bridge's noise handshake (server responds 428 Precondition
					// Required). Signaling `null` instead lets the bridge
					// bootstrap its own device identity and write it back
					// through `set('device', 'device', …)` on pair-success.
					if (!creds.noiseKey && !creds.me?.id) return null
					return credsToDeviceJson(creds)
				}
				if (key === 'account') {
					if (!creds.account) return null
					return new Uint8Array(ADVSignedDeviceIdentity.encode(normalizeAccountForEncode(creds.account)).finish())
				}

				return readBinary(type, key)
			}

			if (route === 'signal') {
				// `BINARY_STORES` is empty as of the move-to-converter
				// migration — keeping the branch for future passthrough
				// stores. No identity fallback needed: identity now goes
				// through the converter, which handles both the address
				// rewrite and the 32↔33-byte prefix.
				return readBinary(type, key)
			}

			if (route === 'bridge-only') return readBinary(type, key)

			if (route === 'converter') {
				try {
					const upstreamKey = translateKey(bridgeStore, key)
					const value = await storeGetOne(type, upstreamKey)
					if (value == null) return null // eslint-disable-line eqeqeq -- intentional null+undefined check
					return converters[bridgeStore]?.toBridge(key, value) ?? toBuf(value as Uint8Array)
				} catch (e) {
					warn(`GET ${bridgeStore}/${key} failed:`, e)
					return null
				}
			}

			warn(`GET unknown store: ${bridgeStore}/${key}`)
			return null
		},

		async set(bridgeStore, key, value) {
			const route = resolve(bridgeStore)
			const type = STORE_MAP[bridgeStore]!

			if (route === 'device') {
				if (key === 'device') {
					updateCredsFromDevice(value, creds)
					debounceSave()
					return
				}

				if (key === 'account') {
					try {
						creds.account = ADVSignedDeviceIdentity.decode(value)
						debounceSave()
					} catch (e) {
						warn('failed to decode account update:', e)
					}

					return
				}

				return writeBinary(type, key, value)
			}

			if (route === 'signal') return writeBinary(type, key, value)

			if (route === 'bridge-only') return writeBinary(type, key, value)

			if (route === 'converter') {
				try {
					const upstreamKey = translateKey(bridgeStore, key)
					const typed = converters[bridgeStore]?.fromBridge(key, value) ?? Buffer.from(value)
					await storeSetOne(type, upstreamKey, typed)
				} catch (e) {
					warn(`SET ${bridgeStore}/${key} failed:`, e)
				}

				return
			}

			warn(`SET unknown store: ${bridgeStore}/${key}`)
		},

		async delete(bridgeStore, key) {
			if (bridgeStore === 'device') return
			const route = resolve(bridgeStore)
			const type = STORE_MAP[bridgeStore]

			if (type) {
				const storeKey = route === 'converter' ? translateKey(bridgeStore, key) : key
				await storeDelete(type, storeKey)
			}
		},

		async flush() {
			if (credsTimer) {
				clearTimeout(credsTimer)
				credsTimer = null
				await saveCreds()
			}
		},

		dispose() {
			if (credsTimer) {
				clearTimeout(credsTimer)
				saveCreds().catch(() => {})
			}
		}
	}
}

// ---- Legacy multi-file auth state loader ----
// Reads upstream Baileys' creds.json + per-key .json files (BufferJSON format).
// This is the same format used by @whiskeysockets/baileys useMultiFileAuthState.

/** JSON reviver that restores `{ type: "Buffer", data: "base64" | number[] }` → Buffer */
interface BufferLike {
	type?: string
	buffer?: boolean
	data?: unknown
	value?: unknown
}
const bufferReviver = (_: string, value: unknown) => {
	if (
		value !== null &&
		value !== undefined &&
		typeof value === 'object' &&
		((value as BufferLike).type === 'Buffer' || (value as BufferLike).buffer === true)
	) {
		const data = (value as BufferLike).data ?? (value as BufferLike).value
		return typeof data === 'string'
			? Buffer.from(data, 'base64')
			: Buffer.from((Array.isArray(data) ? data : []) as number[])
	}

	return value
}

/** JSON replacer that serializes Buffer/Uint8Array → `{ type: "Buffer", data: "base64" }` */
const bufferReplacer = (_: string, value: unknown) =>
	value instanceof Uint8Array || Buffer.isBuffer(value)
		? { type: 'Buffer', data: Buffer.from(value).toString('base64') }
		: value

const fixFileName = (file?: string) => file?.replace(/\//g, '__')?.replace(/:/g, '-')

/**
 * Loads an upstream Baileys session (creds.json + key .json files) and returns
 * the standard `{ state, saveCreds }` tuple that `wrapLegacyStore` expects.
 *
 * ```typescript
 * const { state, saveCreds } = await useLegacyMultiFileAuthState('/path/to/baileys_auth_info')
 * const store = await wrapLegacyStore(state, saveCreds)
 * const sock = makeWASocket({ auth: { store } })
 * ```
 */
export async function useLegacyMultiFileAuthState(
	folder: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
	const folderInfo = await stat(folder).catch(() => null)
	if (folderInfo && !folderInfo.isDirectory()) {
		throw new Error(`found something that is not a directory at ${folder}`)
	}

	if (!folderInfo) {
		await mkdir(folder, { recursive: true })
	}

	const readData = async (file: string) => {
		try {
			const data = await readFile(join(folder, fixFileName(file)!), 'utf-8')
			return JSON.parse(data, bufferReviver)
		} catch {
			return null
		}
	}

	const writeData = async (data: unknown, file: string) => {
		await writeFile(join(folder, fixFileName(file)!), JSON.stringify(data, bufferReplacer))
	}

	const removeData = async (file: string) => {
		try {
			await unlink(join(folder, fixFileName(file)!))
		} catch {}
	}

	const creds: AuthenticationCreds = await readData('creds.json')
	if (!creds) {
		throw new Error(`No creds.json found in ${folder}. This loader requires an existing upstream Baileys session.`)
	}

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
					await Promise.all(
						ids.map(async id => {
							let value = await readData(`${type}-${id}.json`)
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value)
							}

							data[id] = value
						})
					)
					return data
				},
				set: async data => {
					const tasks: Promise<void>[] = []
					for (const category in data) {
						for (const id in data[category as keyof SignalDataTypeMap]) {
							const value = data[category as keyof SignalDataTypeMap]![id]
							const file = `${category}-${id}.json`
							tasks.push(value ? writeData(value, file) : removeData(file))
						}
					}

					await Promise.all(tasks)
				}
			}
		},
		saveCreds: () => writeData(creds, 'creds.json')
	}
}
