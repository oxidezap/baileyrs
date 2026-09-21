/** Host-only auth bootstrap. It deliberately does not import legacy-store codecs. */
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge/host'
import { calculateSignature, generateKeyPair } from '@oxidezap/whatsapp-rust-bridge/host'
import type { AuthenticationCreds, AuthenticationState, KeyPair } from '../Types/index.ts'
import { base64Encode, concatBytes, randomBytes, readU16BE, utf8Decode } from '../Runtime/bytes.ts'

const pair = (): KeyPair => {
	const value = generateKeyPair()
	return { private: new Uint8Array(value.privKey), public: new Uint8Array(value.pubKey.subarray(1)) }
}
const signed = (identity: KeyPair) => {
	const keyPair = pair()
	const publicKey = keyPair.public.length === 33 ? keyPair.public : concatBytes([new Uint8Array([5]), keyPair.public])
	return { keyPair, keyId: 1, signature: new Uint8Array(calculateSignature(identity.private, publicKey)) }
}

export const initHostAuthCreds = (): AuthenticationCreds => {
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
	}
}

const hydrate = async (store: JsStoreCallbacks, creds: AuthenticationCreds): Promise<void> => {
	const payload = await store.get('device', 'device')
	if (!payload) return
	let record: Record<string, unknown>
	try {
		record = JSON.parse(utf8Decode(payload)) as Record<string, unknown>
	} catch (error) {
		throw new Error("failed to hydrate persisted auth record 'device'", { cause: error })
	}
	const mutable = creds as { -readonly [K in keyof AuthenticationCreds]: AuthenticationCreds[K] }
	const registration = record.registration_id
	if (typeof registration === 'number') mutable.registrationId = registration
	if (typeof record.push_name === 'string')
		mutable.me = { id: String((record.pn as { user?: string } | undefined)?.user ?? ''), name: record.push_name }
	if (mutable.me?.id) mutable.registered = true
}

/** Build host auth from the caller-owned native byte store. Rust remains the Signal authority. */
export const createAuthenticationState = async (store: JsStoreCallbacks): Promise<AuthenticationState> => {
	const creds = initHostAuthCreds()
	await hydrate(store, creds)
	const keys = {
		get: async () => {
			throw new Error('legacy SignalKeyStore is not available on the host surface')
		},
		set: async () => {
			throw new Error('legacy SignalKeyStore is not available on the host surface')
		}
	} as unknown as AuthenticationState['keys']
	return { creds, keys, store: store as AuthenticationState['store'] }
}
