/** Host-only auth bootstrap. It deliberately does not import legacy-store codecs. */
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge/host'
import { calculateSignature, generateKeyPair } from '@oxidezap/whatsapp-rust-bridge/host'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { HostAuthenticationState, HostKeyPair } from '../host-types.ts'
import { base64Encode, concatBytes, randomBytes, readU16BE, utf8Decode } from '../Runtime/bytes.ts'
import { jidEncode } from '../WABinary/jid-utils.ts'

const pair = (): HostKeyPair => {
	const value = generateKeyPair()
	return { private: new Uint8Array(value.privKey), public: new Uint8Array(value.pubKey.subarray(1)) }
}
const signed = (identity: HostKeyPair) => {
	const keyPair = pair()
	const publicKey = keyPair.public.length === 33 ? keyPair.public : concatBytes([new Uint8Array([5]), keyPair.public])
	return { keyPair, keyId: 1, signature: new Uint8Array(calculateSignature(identity.private, publicKey)) }
}

export const initHostAuthCreds = (): HostAuthenticationState['creds'] => {
	const identity = pair()
	return {
		noiseKey: pair(),
		pairingEphemeralKeyPair: pair(),
		signedIdentityKey: identity,
		signedPreKey: signed(identity),
		registrationId: readU16BE(randomBytes(2)) & 0x3fff,
		advSecretKey: base64Encode(randomBytes(32)),
		processedHistoryMessages: [],
		nextPreKeyId: 1,
		firstUnuploadedPreKeyId: 1,
		accountSyncCounter: 0,
		accountSettings: { unarchiveChats: false },
		registered: false,
		pairingCode: undefined,
		lastPropHash: undefined,
		routingInfo: undefined,
		additionalData: undefined
	} as unknown as HostAuthenticationState['creds']
}

const PERSISTED_JID_DOMAINS = new Set([
	'c.us',
	'g.us',
	'broadcast',
	's.whatsapp.net',
	'call',
	'lid',
	'newsletter',
	'bot',
	'hosted',
	'hosted.lid'
])

const parsePersistedJid = (
	record: Record<string, unknown>,
	field: 'pn' | 'lid'
): { user: string; server: string; device?: number } | undefined => {
	const value = record[field]
	if (value == null) return undefined
	if (typeof value !== 'object') throw new Error(`persisted auth record contains an invalid ${field} JID`)
	const candidate = value as Record<string, unknown>
	if (
		typeof candidate.user !== 'string' ||
		candidate.user.length === 0 ||
		typeof candidate.server !== 'string' ||
		!PERSISTED_JID_DOMAINS.has(candidate.server) ||
		(candidate.device !== undefined &&
			(typeof candidate.device !== 'number' || !Number.isSafeInteger(candidate.device) || candidate.device < 0))
	) {
		throw new Error(`persisted auth record contains an invalid ${field} JID`)
	}
	return {
		user: candidate.user,
		server: candidate.server,
		...(candidate.device === undefined ? {} : { device: candidate.device as number })
	}
}

export const hydrateHostAuthCreds = async (
	store: JsStoreCallbacks,
	creds: HostAuthenticationState['creds']
): Promise<void> => {
	const [payload, accountPayload] = await Promise.all([store.get('device', 'device'), store.get('device', 'account')])
	if (!payload) {
		if (accountPayload) creds.account = proto.ADVSignedDeviceIdentity.decode(accountPayload)
		return
	}
	let record: Record<string, unknown>
	try {
		record = JSON.parse(utf8Decode(payload)) as Record<string, unknown>
	} catch (error) {
		throw new Error("failed to hydrate persisted auth record 'device'", { cause: error })
	}
	// Validate both identities before mutating the caller's credential mirror.
	const pn = parsePersistedJid(record, 'pn')
	const lid = parsePersistedJid(record, 'lid')
	const mutable = creds as { -readonly [K in keyof typeof creds]: (typeof creds)[K] }
	const asBytes = (value: unknown): Uint8Array | undefined =>
		Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
			? new Uint8Array(value)
			: undefined
	const keyPair = (value: unknown): HostKeyPair | undefined => {
		const bytes = asBytes(value)
		if (!bytes || bytes.length !== 64 || bytes.every(byte => byte === 0)) return undefined
		return { private: bytes.slice(0, 32), public: bytes.slice(32, 64) }
	}
	const safeUnsigned = (value: unknown): value is number =>
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
	const registration = record.registration_id
	if ('registration_id' in record && !safeUnsigned(registration)) throw new Error('invalid persisted registration id')
	if (safeUnsigned(registration)) mutable.registrationId = registration
	const noiseBytes = asBytes(record.noise_key)
	if ('noise_key' in record && (!noiseBytes || noiseBytes.length !== 64)) {
		throw new Error('persisted auth record contains an invalid noise key')
	}
	const noiseKey = keyPair(record.noise_key)
	const identityKey = keyPair(record.identity_key)
	const signedPreKey = keyPair(record.signed_pre_key)
	const hasSigningRecord = ['identity_key', 'signed_pre_key', 'signed_pre_key_id', 'signed_pre_key_signature'].some(
		field => field in record
	)
	const signature = asBytes(record.signed_pre_key_signature)
	const keyId = record.signed_pre_key_id
	if (
		hasSigningRecord &&
		(!identityKey || !signedPreKey || !signature || signature.length !== 64 || !safeUnsigned(keyId))
	) {
		throw new Error('persisted auth record contains an incomplete signing bundle')
	}
	if (noiseKey) mutable.noiseKey = noiseKey
	if (hasSigningRecord) {
		mutable.signedIdentityKey = identityKey!
		mutable.signedPreKey = { keyPair: signedPreKey!, keyId: keyId as number, signature: signature! }
	}
	const advSecret = asBytes(record.adv_secret_key)
	if ('adv_secret_key' in record && (!advSecret || advSecret.length !== 32)) {
		throw new Error('persisted auth record contains an invalid adv secret')
	}
	if (advSecret) mutable.advSecretKey = base64Encode(advSecret)
	if ('next_pre_key_id' in record && !safeUnsigned(record.next_pre_key_id))
		throw new Error('invalid persisted pre-key counter')
	if (safeUnsigned(record.next_pre_key_id)) {
		mutable.nextPreKeyId = record.next_pre_key_id
		mutable.firstUnuploadedPreKeyId = record.next_pre_key_id
	}
	if (typeof record.props_hash === 'string') mutable.lastPropHash = record.props_hash
	if (pn) {
		const id = jidEncode(pn.user, pn.server as never, pn.device)
		mutable.me = {
			id,
			name: typeof record.push_name === 'string' ? record.push_name : undefined,
			...(lid ? { lid: jidEncode(lid.user, lid.server as never, lid.device) } : {})
		} as never
	} else if (typeof record.push_name === 'string') {
		mutable.me = { id: '', name: record.push_name } as never
	}
	if (mutable.me?.id) mutable.registered = true
	if (typeof record.platform === 'string') (mutable as never as { platform?: string }).platform = record.platform
	const routingInfo = record.edge_routing_info
	const routingBytes = asBytes(routingInfo)
	if ('edge_routing_info' in record && routingInfo !== null && !routingBytes) {
		throw new Error('persisted auth record contains invalid routing info')
	}
	if (routingInfo === null) mutable.routingInfo = undefined
	else if (routingBytes) mutable.routingInfo = routingBytes as unknown as typeof mutable.routingInfo
	if (accountPayload) creds.account = proto.ADVSignedDeviceIdentity.decode(accountPayload)
}

/** Build host auth from the caller-owned native byte store. Rust remains the Signal authority. */
export const createAuthenticationState = async (store: JsStoreCallbacks): Promise<HostAuthenticationState> => {
	const creds = initHostAuthCreds()
	await hydrateHostAuthCreds(store, creds)
	return { creds: creds as unknown as HostAuthenticationState['creds'], store }
}
