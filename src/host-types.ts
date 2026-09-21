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

export type HostEventEmitter = {
	on(event: string, listener: (...args: unknown[]) => void): HostEventEmitter
	off(event: string, listener: (...args: unknown[]) => void): HostEventEmitter
	emit(event: string, ...args: unknown[]): boolean
}

/** Host-facing operations retain callable types without importing Node Baileys declarations. */
export type HostWASocket = {
	ev: HostEventEmitter
	end: (error?: unknown) => Promise<void> | void
	sendMessage: (...args: unknown[]) => Promise<unknown>
	logout: (...args: unknown[]) => Promise<void>
	query: (...args: unknown[]) => Promise<unknown>
	sendNode: (...args: unknown[]) => Promise<unknown>
	relayMessage: (...args: unknown[]) => Promise<unknown>
	downloadMediaMessage: (...args: unknown[]) => Promise<unknown>
	profilePictureUrl: (...args: unknown[]) => Promise<unknown>
	sendPresenceUpdate: (...args: unknown[]) => Promise<unknown>
	waUploadToServer: (...args: unknown[]) => Promise<unknown>
	groupCreate: (...args: unknown[]) => Promise<unknown>
	groupParticipantsUpdate: (...args: unknown[]) => Promise<unknown>
	groupMetadata: (...args: unknown[]) => Promise<unknown>
	fetchBlocklist: (...args: unknown[]) => Promise<unknown>
	updateBlockStatus: (...args: unknown[]) => Promise<unknown>
	updateProfileName: (...args: unknown[]) => Promise<unknown>
	updateProfileStatus: (...args: unknown[]) => Promise<unknown>
	updateProfilePicture: (...args: unknown[]) => Promise<unknown>
	removeProfilePicture: (...args: unknown[]) => Promise<unknown>
	fetchMessageHistory: (...args: unknown[]) => Promise<unknown>
	readMessages: (...args: unknown[]) => Promise<unknown>
	sendReceipt: (...args: unknown[]) => Promise<unknown>
	sendReceipts: (...args: unknown[]) => Promise<unknown>
	requestPlaceholderResend: (...args: unknown[]) => Promise<unknown>
	updateDefaultDisappearingMode: (...args: unknown[]) => Promise<unknown>
	rejectCall: (...args: unknown[]) => Promise<unknown>
	fetchReachoutTimelock: (...args: unknown[]) => Promise<unknown>
	setAutoReconnect: (...args: unknown[]) => unknown
	waitForMessage: (...args: unknown[]) => Promise<unknown>
	assertSessions: (...args: unknown[]) => Promise<unknown>
	getUSyncDevices: (...args: unknown[]) => Promise<unknown>
}
