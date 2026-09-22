import type { ILogger } from './Utils/logger.ts'
import type { HostSocketOperationName } from './host-socket-operations.ts'

export type HostStoreCallbacks = {
	get(store: string, key: string): Promise<Uint8Array | null>
	set(store: string, key: string, value: Uint8Array): Promise<void>
	delete(store: string, key: string): Promise<void>
	setMany?(store: string, entries: [key: string, value: Uint8Array][]): Promise<void>
	getMany?(store: string, keys: string[]): Promise<[key: string, value: Uint8Array][]>
	deleteMany?(store: string, keys: string[]): Promise<void>
	listKeys?(store: string, prefix?: string): Promise<string[]>
	listEntries?(store: string, prefix?: string): Promise<[key: string, value: Uint8Array][]>
	deletePrefix?(store: string, prefix: string): Promise<number>
	capabilities?: { batch?: boolean; enumerate?: boolean; prefixDelete?: boolean }
	flush?(): Promise<void>
}

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
	store: HostStoreCallbacks
}

export type HostRuntime = {
	bridge: object
	randomBytes: (length: number) => Uint8Array
	setTimeout: (callback: () => void, ms: number) => unknown
	clearTimeout: (handle: unknown) => void
	setImmediate?: (callback: () => void) => unknown
	queueMicrotask: (callback: () => void) => void
	events: { createEmitter(): HostEventEmitter }
	platformInfo?: () => { os: string; release: string }
	nativeCrypto?: unknown
	defaultLogger?: ILogger
	loggerSink: (line: string, delivered?: () => void) => void
	logLevel: () => string | undefined
	Long: unknown
}

export type HostSocketConfig = {
	auth: HostAuthenticationState
	logger?: ILogger
	[key: string]: unknown
}

export type HostEventEmitter = {
	on(event: string | symbol, listener: (...args: unknown[]) => void): HostEventEmitter
	off(event: string | symbol, listener: (...args: unknown[]) => void): HostEventEmitter
	once(event: string | symbol, listener: (...args: unknown[]) => void): HostEventEmitter
	prependListener(event: string | symbol, listener: (...args: unknown[]) => void): HostEventEmitter
	prependOnceListener(event: string | symbol, listener: (...args: unknown[]) => void): HostEventEmitter
	removeListener(event: string | symbol, listener: (...args: unknown[]) => void): HostEventEmitter
	removeAllListeners(event?: string | symbol): HostEventEmitter
	eventNames(): (string | symbol)[]
	rawListeners(event: string | symbol): Array<(...args: unknown[]) => void>
	setMaxListeners(count: number): HostEventEmitter
	emit(event: string | symbol, ...args: unknown[]): boolean
}

/** Host-facing operations retain callable types without importing Node Baileys declarations. */
type HostWASocketBase = {
	ev: HostEventEmitter
	end: (error?: unknown) => Promise<void> | void
	sendMessage: (...args: unknown[]) => Promise<unknown>
	logout: (...args: unknown[]) => Promise<void>
	query: (...args: unknown[]) => Promise<unknown>
	sendNode: (...args: unknown[]) => Promise<unknown>
	relayMessage: (...args: unknown[]) => Promise<unknown>
	downloadMedia: (...args: unknown[]) => Promise<unknown>
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

type GenericHostSocketOperations = {
	[K in Exclude<HostSocketOperationName, keyof HostWASocketBase>]: (...args: unknown[]) => unknown
}

/** Complete callable socket surface, with richer signatures for the common operations above. */
export type HostWASocket = HostWASocketBase & GenericHostSocketOperations
