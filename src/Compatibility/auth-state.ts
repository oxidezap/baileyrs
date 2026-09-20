/**
 * Host-neutral credential seeding + store hydration for `auth: { store }`.
 *
 * `createAuthenticationState(store)` builds the public auth view the socket
 * consumes — `initAuthCreds()` for the credential mirror, the native store
 * projection for the key facade — and hydrates the mirror from the device
 * the engine persisted, so a restarted session reports `registered: true`
 * instead of a fresh placeholder. Key generation goes through the bridge
 * (`/host` entrypoint, already initialized by the caller), never
 * `node:crypto`; byte helpers come from `Runtime/bytes.ts`, never Buffer.
 */

import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge/host'
import { calculateSignature, generateKeyPair } from '@oxidezap/whatsapp-rust-bridge/host'
import type { AuthenticationCreds, AuthenticationState, KeyPair } from '../Types/index.ts'
import { concatBytes } from '../Runtime/bytes.ts'
import { createDeviceProjection } from './legacy-store/device.ts'
import { base64Encode, randomBytes, readU16BE } from '../Runtime/bytes.ts'

const DEVICE_STORE = 'device'
const DEVICE_RECORDS = ['device', 'account'] as const

const newKeyPair = (): KeyPair => {
	const pair = generateKeyPair()
	return {
		private: new Uint8Array(pair.privKey),
		public: new Uint8Array(pair.pubKey.subarray(1))
	}
}

/** Signal version-byte prefix, matching `Defaults.KEY_BUNDLE_TYPE` without importing Node's Buffer. */
const KEY_BUNDLE_PREFIX = new Uint8Array([5])

const generateSignalPubKey = (pubKey: Uint8Array): Uint8Array =>
	pubKey.length === 33 ? pubKey : concatBytes([KEY_BUNDLE_PREFIX, pubKey])

const newSignedKeyPair = (identityKeyPair: KeyPair, keyId: number) => {
	const keyPair = newKeyPair()
	return {
		keyPair,
		signature: new Uint8Array(calculateSignature(identityKeyPair.private, generateSignalPubKey(keyPair.public))),
		keyId
	}
}

/**
 * Seed a fresh `auth.creds` mirror with valid key material.
 *
 * Stays a mirror: effective crypto state lives in the engine. Values match
 * `Utils/generics.ts:initAuthCreds` field for field (registration id is 14
 * bits, `advSecretKey` is 32 random bytes as base64) without touching
 * `node:crypto` or `Buffer`.
 */
export const initHostAuthCreds = (): AuthenticationCreds => {
	const signedIdentityKey = newKeyPair()
	const registration = readU16BE(randomBytes(2)) & 0x3fff
	return {
		noiseKey: newKeyPair(),
		pairingEphemeralKeyPair: newKeyPair(),
		signedIdentityKey,
		signedPreKey: newSignedKeyPair(signedIdentityKey, 1),
		registrationId: registration,
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

const hydrateFromStore = async (store: JsStoreCallbacks, creds: AuthenticationCreds): Promise<void> => {
	const projection = createDeviceProjection(creds)
	for (const record of DEVICE_RECORDS) {
		const payload = await store.get(DEVICE_STORE, record)
		if (!payload) continue
		try {
			projection.prepare(record, payload)()
		} catch {
			/* a record we cannot read leaves that part of the mirror at its default */
		}
	}
}

/**
 * Build `{ creds, keys, store }` from a caller-owned byte store — the only
 * auth shape the host entrypoint accepts. Pass the result straight to
 * `makeWASocket({ auth })`: no filesystem, no legacy `{ creds, keys }`
 * wrap, no `Buffer`.
 */
export const createAuthenticationState = async (
	store: JsStoreCallbacks,
	keys?: AuthenticationState['keys']
): Promise<AuthenticationState> => {
	const creds = initHostAuthCreds()
	await hydrateFromStore(store, creds)
	const { projectNativeStore } = await import('./legacy-store/native-projection.ts')
	return {
		creds,
		keys: keys ?? projectNativeStore(store, creds),
		store: store as AuthenticationState['store']
	}
}
