import type Long from 'long'
import type { Buffer } from 'node:buffer'
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge'
import type { proto } from '../WAProto/runtime.ts'
import type { Contact } from './Contact.ts'
import type { MinimalMessage } from './Message.ts'

export type KeyPair = { public: Uint8Array; private: Uint8Array }
export type SignedKeyPair = {
	keyPair: KeyPair
	signature: Uint8Array
	keyId: number
	timestampS?: number
}

export type ProtocolAddress = {
	name: string // jid
	deviceId: number
}
export type SignalIdentity = {
	identifier: ProtocolAddress
	identifierKey: Uint8Array
}

export type LIDMapping = {
	pn: string
	lid: string
}

export type LTHashState = {
	version: number
	hash: Buffer
	indexValueMap: {
		[indexMacBase64: string]: { valueMac: Uint8Array | Buffer }
	}
}

export type SignalCreds = {
	readonly signedIdentityKey: KeyPair
	readonly signedPreKey: SignedKeyPair
	readonly registrationId: number
}

export type AccountSettings = {
	/** unarchive chats when a new message is received */
	unarchiveChats: boolean
	/** the default mode to start new conversations with */
	// `ephemeralSettingTimestamp` restated for the same reason `WAMessage`
	// restates `messageTimestamp`: the neutral codec types a 64-bit field as a
	// method-less `{ low, high, unsigned }`, and the value this library actually
	// stores here is a long.js Long.
	defaultDisappearingMode?: Pick<proto.IConversation, 'ephemeralExpiration'> & {
		ephemeralSettingTimestamp?: number | Long | null
	}
}

/**
 * Authentication credentials.
 *
 * Only `me`, `registered`, and `platform` are actively used by the socket.
 * All crypto keys and Signal state are managed internally by the Rust bridge.
 * The remaining fields exist for backward compatibility with user code that
 * may reference them.
 */
export type AuthenticationCreds = SignalCreds & {
	/** Paired user identity — set on pair_success, cleared on logout. */
	me?: Contact
	/** Whether the client has completed pairing. */
	registered: boolean
	/** Device platform (e.g. "smbi", "smba"). Set on pair_success. */
	platform?: string

	// ── Legacy fields (managed by Rust, kept for backward compat) ──────
	readonly noiseKey: KeyPair
	readonly pairingEphemeralKeyPair: KeyPair
	advSecretKey: string
	account?: proto.IADVSignedDeviceIdentity
	signalIdentities?: SignalIdentity[]
	myAppStateKeyId?: string
	firstUnuploadedPreKeyId: number
	nextPreKeyId: number
	lastAccountSyncTimestamp?: number
	processedHistoryMessages: MinimalMessage[]
	accountSyncCounter: number
	accountSettings: AccountSettings
	pairingCode: string | undefined
	lastPropHash: string | undefined
	routingInfo: Buffer | undefined
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	additionalData?: any
}

/** @deprecated Signal keys are managed by the Rust bridge. */
export type SignalDataTypeMap = {
	'pre-key': KeyPair
	session: Uint8Array
	'sender-key': Uint8Array
	'sender-key-memory': { [jid: string]: boolean }
	'app-state-sync-key': proto.Message.IAppStateSyncKeyData
	'app-state-sync-version': LTHashState
	'lid-mapping': string
	'device-list': string[]
	tctoken: { token: Buffer; timestamp?: string; senderTimestamp?: number }
	'identity-key': Uint8Array
}

/** @deprecated Signal keys are managed by the Rust bridge. */
export type SignalDataSet = { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] | null } }

type Awaitable<T> = T | Promise<T>

/** @deprecated Signal keys are managed by the Rust bridge. */
export type SignalKeyStore = {
	get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Awaitable<{ [id: string]: SignalDataTypeMap[T] }>
	set(data: SignalDataSet): Awaitable<void>
	/** clear all the data in the store */
	clear?(): Awaitable<void>
}

/** @deprecated Signal keys are managed by the Rust bridge. */
export type SignalKeyStoreWithTransaction = SignalKeyStore & {
	isInTransaction: () => boolean
	transaction<T>(exec: () => Promise<T>, key: string): Promise<T>
}

/** @deprecated Signal keys are managed by the Rust bridge. */
export type TransactionCapabilityOptions = {
	maxCommitRetries: number
	delayBetweenTriesMs: number
}

/** @deprecated Signal keys are managed by the Rust bridge. */
export type SignalAuthState = {
	creds: SignalCreds
	keys: SignalKeyStore | SignalKeyStoreWithTransaction
}

export type AuthenticationState = {
	/** Compatibility mirror; cryptographic state remains managed by the Rust bridge. */
	creds: AuthenticationCreds
	/** Compatibility facade for upstream code that reads or clears Signal keys. */
	keys: SignalKeyStore
	/** Bridge storage for persistent WASM state. Auto-created by useMultiFileAuthState. */
	store?: JsStoreCallbacks & {
		/** Flush all pending debounced writes to disk. Called automatically on disconnect. */
		flush?(): Promise<void>
	}
}
