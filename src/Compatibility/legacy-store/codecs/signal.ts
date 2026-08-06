import { Buffer } from 'node:buffer'
import {
	decodeSenderKeyRecordComponents,
	encodeSenderKeyRecordComponents,
	importLegacySessionRecordV1,
	projectLegacySessionRecordV1,
	type LegacySessionMessageKeyV1 as CoreLegacySessionMessageKeyV1,
	type LegacySessionRecordV1 as CoreLegacySessionRecordV1,
	type LegacySessionV1 as CoreLegacySessionV1,
	type SenderKeyRecordComponents
} from '@oxidezap/whatsapp-rust-bridge'
import { JsonByteEncoding, LegacySession, NativeStore, TimeValue } from '../constants.ts'
import { EMPTY_BYTES } from '../common.ts'
import { NATIVE_ONLY_PROJECTION, type LegacyCodec } from '../types.ts'
import { serializeSignalPublicKey } from '../validation.ts'
import { BufferJSON } from '../../../Utils/generics.ts'

export type SignalRecordDefaults = {
	localIdentityPublic: Uint8Array
	localRegistrationId: number
}

const toBase64 = (value: Uint8Array): string => Buffer.from(value).toString(JsonByteEncoding.BASE64)

function fromBase64(value: string | undefined, label: string): Buffer {
	if (typeof value !== 'string') throw new TypeError(`${label} must be base64 text`)
	const decoded = Buffer.from(value, JsonByteEncoding.BASE64)
	const normalizedInput = value.replace(/=+$/, '')
	const normalizedOutput = decoded.toString(JsonByteEncoding.BASE64).replace(/=+$/, '')
	if (normalizedInput !== normalizedOutput) throw new TypeError(`${label} is not valid base64`)
	return decoded
}

const requiredBytes = (value: Uint8Array | Buffer | undefined, label: string): Uint8Array => {
	if (!(value instanceof Uint8Array) || value.length === 0) throw new TypeError(`${label} must be binary data`)
	return new Uint8Array(value)
}

const optionalBuffer = (value: Uint8Array | undefined): Buffer => Buffer.from(value ?? EMPTY_BYTES)

const integer = (value: number | undefined, label: string): number => {
	if (!Number.isInteger(value) || value! < 0 || value! > 0xffff_ffff) {
		throw new TypeError(`${label} must be an unsigned 32-bit integer`)
	}
	return value!
}

// ---- Sender-key record ----

interface LegacySenderKeyState {
	senderKeyId?: number
	senderChainKey?: { iteration?: number; seed?: Uint8Array | Buffer }
	senderSigningKey?: { public?: Uint8Array | Buffer; private?: Uint8Array | Buffer }
	senderMessageKeys?: Array<{ iteration?: number; seed?: Uint8Array | Buffer }>
}

/**
 * The two shapes order their states in opposite directions: the core keeps the
 * current state at the front and prunes from the back, while the legacy record
 * is read back-to-front — `getSenderKeyState()` takes the last entry and
 * `addSenderKeyState` drops the first one on overflow. Both conversions below
 * therefore reverse. Carrying an order through unchanged writes the record
 * upside down: the old implementation would send under a stale key and evict
 * the freshest state instead of the oldest.
 */
function senderKeyToLegacy(nativeBytes: Uint8Array): Buffer {
	const record = decodeSenderKeyRecordComponents(nativeBytes)
	const states: LegacySenderKeyState[] = record.states.toReversed().map(state => ({
		senderKeyId: state.keyId,
		senderChainKey: {
			iteration: state.chainKey.iteration,
			seed: Buffer.from(state.chainKey.seed)
		},
		senderSigningKey: {
			public: Buffer.from(state.signingKey.public),
			private: optionalBuffer(state.signingKey.private)
		},
		senderMessageKeys: state.messageKeys.map(messageKey => ({
			iteration: messageKey.iteration,
			seed: Buffer.from(messageKey.seed)
		}))
	}))
	return Buffer.from(JSON.stringify(states, BufferJSON.replacer), JsonByteEncoding.UTF8)
}

function senderKeyFromLegacy(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value)) {
		throw new TypeError('legacy sender-key record must be binary JSON')
	}
	const parsed = JSON.parse(Buffer.from(value).toString(JsonByteEncoding.UTF8), BufferJSON.reviver) as unknown
	if (!Array.isArray(parsed)) throw new TypeError('legacy sender-key record must contain an array')

	// Indexed against the stored order so a validation error names the state the
	// caller can find in the record; reversed afterwards. See `senderKeyToLegacy`.
	const record: SenderKeyRecordComponents = {
		states: (parsed as LegacySenderKeyState[]).map((state, stateIndex) => ({
			keyId: integer(state.senderKeyId, `sender-key state ${stateIndex} id`),
			chainKey: {
				iteration: integer(state.senderChainKey?.iteration, `sender-key state ${stateIndex} iteration`),
				seed: requiredBytes(state.senderChainKey?.seed, `sender-key state ${stateIndex} chain seed`)
			},
			signingKey: {
				public: requiredBytes(state.senderSigningKey?.public, `sender-key state ${stateIndex} signing public key`),
				private: state.senderSigningKey?.private?.length ? new Uint8Array(state.senderSigningKey.private) : undefined
			},
			messageKeys: (state.senderMessageKeys ?? []).map((messageKey, keyIndex) => ({
				iteration: integer(messageKey.iteration, `sender-key state ${stateIndex} message key ${keyIndex} iteration`),
				seed: requiredBytes(messageKey.seed, `sender-key state ${stateIndex} message key ${keyIndex} seed`)
			}))
		}))
	}
	record.states.reverse()
	return encodeSenderKeyRecordComponents(record)
}

// ---- Pairwise session record ----

interface LegacyChainEntry {
	chainKey: { counter: number; key?: string }
	chainType: number
	messageKeys: Record<string, string>
}

interface LegacySessionEntry {
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
	_chains: Record<string, LegacyChainEntry>
	pendingPreKey?: { preKeyId?: number; signedKeyId?: number; baseKey: string }
}

interface LegacySessionJsonRecord {
	_sessions: Record<string, LegacySessionEntry>
	version: typeof LegacySession.VERSION
	/**
	 * Pre-v1 records carry the id here rather than on each entry; libsignal's
	 * own deserialize copies it down as a migration. Reading such a record
	 * without that fallback imports every session under registration id 0.
	 */
	registrationId?: number
}

const messageKeyIndex = (value: string): number => {
	if (!/^\d+$/.test(value)) throw new TypeError('legacy skipped-message index must be an unsigned integer')
	const index = Number(value)
	if (!Number.isSafeInteger(index) || index > 0xffff_ffff) {
		throw new TypeError('legacy skipped-message index must fit an unsigned 32-bit integer')
	}
	return index
}

function messageKeysFromLegacy(messageKeys: Record<string, string> | undefined): CoreLegacySessionMessageKeyV1[] {
	return Object.entries(messageKeys ?? {}).map(([index, seed]) => ({
		index: messageKeyIndex(index),
		seed: fromBase64(seed, 'legacy skipped-message key')
	}))
}

function messageKeysToLegacy(messageKeys: CoreLegacySessionMessageKeyV1[]): Record<string, string> {
	return Object.fromEntries(messageKeys.map(messageKey => [messageKey.index, toBase64(messageKey.seed)]))
}

function legacyEntryToCore(entry: LegacySessionEntry, recordRegistrationId?: number): CoreLegacySessionV1 {
	const ratchet = entry.currentRatchet
	if (!entry._chains || typeof entry._chains !== 'object') {
		throw new TypeError('legacy session is missing its chain catalog')
	}

	return {
		registrationId: entry.registrationId ?? recordRegistrationId ?? TimeValue.UNKNOWN_SECONDS,
		ratchet: {
			keyPair: {
				public: fromBase64(ratchet.ephemeralKeyPair.pubKey, 'sender ratchet public key'),
				private: fromBase64(ratchet.ephemeralKeyPair.privKey, 'sender ratchet private key')
			},
			lastRemoteEphemeralKey: fromBase64(ratchet.lastRemoteEphemeralKey, 'last remote ephemeral key'),
			previousCounter: ratchet.previousCounter,
			rootKey: fromBase64(ratchet.rootKey, 'session root key')
		},
		index: {
			baseKey: fromBase64(entry.indexInfo.baseKey, 'session base key'),
			baseKeyRole: entry.indexInfo.baseKeyType,
			closedTimestamp: entry.indexInfo.closed,
			usedAtMs: entry.indexInfo.used,
			createdAtMs: entry.indexInfo.created,
			remoteIdentityKey: fromBase64(entry.indexInfo.remoteIdentityKey, 'remote identity key')
		},
		chains: Object.entries(entry._chains).map(([ratchetKey, chain]) => ({
			ratchetKey: fromBase64(ratchetKey, 'chain ratchet key'),
			role: chain.chainType,
			chainKey: {
				counter: chain.chainKey.counter,
				key: chain.chainKey.key === undefined ? undefined : fromBase64(chain.chainKey.key, 'legacy chain key')
			},
			messageKeys: messageKeysFromLegacy(chain.messageKeys)
		})),
		pendingPreKey: entry.pendingPreKey
			? {
					preKeyId: entry.pendingPreKey.preKeyId,
					signedPreKeyId: entry.pendingPreKey.signedKeyId!,
					baseKey: fromBase64(entry.pendingPreKey.baseKey, 'pending pre-key base key')
				}
			: undefined
	}
}

function sessionFromLegacy(value: unknown, defaults: SignalRecordDefaults | undefined): Uint8Array {
	if (value === null || typeof value !== 'object') throw new TypeError('legacy session record must be an object')
	const record = value as LegacySessionJsonRecord
	if (record.version !== LegacySession.VERSION || !record._sessions) {
		throw new TypeError('legacy session record has an unsupported shape or version')
	}
	if (!defaults) throw new TypeError('session import requires local Signal credentials')
	const decoded: CoreLegacySessionRecordV1 = {
		sessions: Object.entries(record._sessions).map(([indexKey, entry]) => ({
			indexKey: fromBase64(indexKey, 'legacy session index key'),
			session: legacyEntryToCore(entry, record.registrationId)
		}))
	}
	return importLegacySessionRecordV1(decoded, {
		identityKey: serializeSignalPublicKey(defaults.localIdentityPublic, 'local identity key'),
		registrationId: defaults.localRegistrationId
	})
}

function coreEntryToLegacy(session: CoreLegacySessionV1): LegacySessionEntry {
	const chains: Record<string, LegacyChainEntry> = {}
	for (const chain of session.chains) {
		chains[toBase64(chain.ratchetKey)] = {
			chainKey: {
				counter: chain.chainKey.counter,
				key: chain.chainKey.key ? toBase64(chain.chainKey.key) : undefined
			},
			chainType: chain.role,
			messageKeys: messageKeysToLegacy(chain.messageKeys)
		}
	}
	return {
		registrationId: session.registrationId,
		currentRatchet: {
			ephemeralKeyPair: {
				pubKey: toBase64(session.ratchet.keyPair.public),
				privKey: toBase64(session.ratchet.keyPair.private)
			},
			lastRemoteEphemeralKey: toBase64(session.ratchet.lastRemoteEphemeralKey),
			previousCounter: session.ratchet.previousCounter,
			rootKey: toBase64(session.ratchet.rootKey)
		},
		indexInfo: {
			baseKey: toBase64(session.index.baseKey),
			baseKeyType: session.index.baseKeyRole,
			closed: session.index.closedTimestamp,
			used: session.index.usedAtMs,
			created: session.index.createdAtMs,
			remoteIdentityKey: toBase64(session.index.remoteIdentityKey)
		},
		_chains: chains,
		pendingPreKey: session.pendingPreKey
			? {
					preKeyId: session.pendingPreKey.preKeyId,
					signedKeyId: session.pendingPreKey.signedPreKeyId,
					baseKey: toBase64(session.pendingPreKey.baseKey)
				}
			: undefined
	}
}

function sessionToLegacy(nativeBytes: Uint8Array): LegacySessionJsonRecord | typeof NATIVE_ONLY_PROJECTION {
	const projection = projectLegacySessionRecordV1(nativeBytes)
	if (projection.status === 'unrepresentable') return NATIVE_ONLY_PROJECTION
	const sessions: Record<string, LegacySessionEntry> = {}
	for (const indexed of projection.record.sessions) {
		sessions[toBase64(indexed.indexKey)] = coreEntryToLegacy(indexed.session)
	}
	return { _sessions: sessions, version: LegacySession.VERSION }
}

export function createSignalCodecs(
	defaults?: SignalRecordDefaults
): Record<typeof NativeStore.SESSION | typeof NativeStore.SENDER_KEY, LegacyCodec> {
	return {
		[NativeStore.SESSION]: {
			fromLegacy: (_key, value) => sessionFromLegacy(value, defaults),
			toLegacy: (_key, value) => sessionToLegacy(value)
		},
		[NativeStore.SENDER_KEY]: {
			fromLegacy: (_key, value) => senderKeyFromLegacy(value),
			toLegacy: (_key, value) => senderKeyToLegacy(value)
		}
	}
}
