import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge/host'
import type { ILogger } from './Utils/logger.ts'

export type HostKeyPair = { public: Uint8Array; private: Uint8Array }
export type HostSignedKeyPair = { keyPair: HostKeyPair; signature: Uint8Array; keyId: number; timestampS?: number }

export type HostAuthenticationCreds = {
	signedIdentityKey: HostKeyPair
	signedPreKey: HostSignedKeyPair
	noiseKey: HostKeyPair
	pairingEphemeralKeyPair: HostKeyPair
	registrationId: number
	advSecretKey: string
	me?: { id: string; lid?: string; name?: string }
	registered: boolean
	platform?: string
	firstUnuploadedPreKeyId: number
	nextPreKeyId: number
	accountSyncCounter: number
	accountSettings: { unarchiveChats: boolean }
	pairingCode?: string
	lastPropHash?: string
	routingInfo?: Uint8Array
	[key: string]: unknown
}

/** Host auth is store-owned; legacy SignalKeyStore is intentionally absent. */
export type HostAuthenticationState = {
	creds: HostAuthenticationCreds
	store: JsStoreCallbacks
}

export type HostSocketConfig = {
	auth: HostAuthenticationState
	logger?: ILogger
	[key: string]: unknown
}

/** Minimal host-facing socket contract; protocol-specific methods remain runtime-discovered. */
export type HostWASocket = {
	ev: unknown
	end: (error?: unknown) => Promise<void> | void
	[key: string]: unknown
}
