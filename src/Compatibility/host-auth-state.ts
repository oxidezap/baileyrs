/** Host-only auth bootstrap. It deliberately does not import legacy-store codecs. */
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge/host'
import { calculateSignature, generateKeyPair } from '@oxidezap/whatsapp-rust-bridge/host'
import type { AuthenticationCreds, KeyPair } from '../Types/index.ts'
import type { HostAuthenticationState } from '../host-types.ts'
import { base64Encode, concatBytes, randomBytes, readU16BE, utf8Decode } from '../Runtime/bytes.ts'
import { jidEncode } from '../WABinary/jid-utils.ts'

const pair = (): KeyPair => {
	const value = generateKeyPair()
	return { private: new Uint8Array(value.privKey), public: new Uint8Array(value.pubKey.subarray(1)) }
}
const signed = (identity: KeyPair) => {
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
	const pn = record.pn as { user?: string; server?: string; device?: number } | undefined
	const lid = record.lid as { user?: string; server?: string; device?: number } | undefined
	if (pn?.user && pn.server) {
		const id = jidEncode(pn.user, pn.server as never, pn.device)
		mutable.me = {
			id,
			name: typeof record.push_name === 'string' ? record.push_name : undefined,
			...(lid?.user && lid.server ? { lid: jidEncode(lid.user, lid.server as never, lid.device) } : {})
		} as never
	} else if (typeof record.push_name === 'string') {
		mutable.me = { id: '', name: record.push_name } as never
	}
	if (mutable.me?.id) mutable.registered = true
	if (typeof record.platform === 'string') (mutable as never as { platform?: string }).platform = record.platform
	if (Array.isArray(record.edge_routing_info))
		mutable.routingInfo = new Uint8Array(record.edge_routing_info as number[]) as unknown as typeof mutable.routingInfo
}

/** Build host auth from the caller-owned native byte store. Rust remains the Signal authority. */
export const createAuthenticationState = async (store: JsStoreCallbacks): Promise<HostAuthenticationState> => {
	const creds = initHostAuthCreds()
	await hydrate(store, creds as unknown as AuthenticationCreds)
	return { creds: creds as unknown as HostAuthenticationState['creds'], store }
}
