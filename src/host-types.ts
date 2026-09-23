import type { ILogger } from './Utils/logger.ts'
import type { WAMessage } from './host-shared.ts'
import type { HostSocketOperationName } from './host-socket-operations.ts'
import type * as HostBridge from '@oxidezap/whatsapp-rust-bridge/host'
import type Long from 'long'

export type HostLoggerSink = (line: string, delivered: () => void) => void

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

export type HostBridgeRuntime = Pick<
	typeof HostBridge,
	| 'createWhatsAppClient'
	| 'initWasmEngine'
	| 'encodeProto'
	| 'decodeProto'
	| 'inflateZlib'
	| 'BinaryReader'
	| 'decodeMessageWireBatch'
	| 'decodeReceiptWireBatch'
	| 'decodeServerAckWireBatch'
	| 'decryptPollVotePayload'
	| 'decryptEventResponsePayload'
	| 'hkdf'
	| 'sha256'
	| 'aesGcm256Encrypt'
	| 'aesGcm256Decrypt'
>
export type HostMediaCryptoRuntime = Pick<
	HostBridgeRuntime,
	'hkdf' | 'sha256' | 'aesGcm256Encrypt' | 'aesGcm256Decrypt'
> & { randomBytes(length: number): Uint8Array }

export type HostLongValue = {
	low: number
	high: number
	unsigned: boolean
	toNumber(): number
	toString(radix?: number): string
}

export type HostLongConstructor = {
	new (low: number, high?: number, unsigned?: boolean): HostLongValue
	fromValue: typeof Long.fromValue
}

export type HostRuntime = {
	bridge: HostBridgeRuntime
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
	Long: HostLongConstructor
}

export type HostCacheStore = {
	get<T>(key: string): Promise<T | undefined> | T | undefined
	set<T>(key: string, value: T): Promise<void> | void | number | boolean
	del(key: string): Promise<void> | void | number | boolean
	flushAll(): Promise<void> | void
	close?(): void
}

type HostNativeCacheStore = {
	get(namespace: string, key: string): Promise<Uint8Array | null>
	set(namespace: string, key: string, value: Uint8Array, ttlSecs?: number): Promise<void>
	delete(namespace: string, key: string): Promise<void>
	clear(namespace: string): Promise<void>
}

type HostCacheEntryConfig = { ttlSecs?: number; capacity?: number; store?: HostNativeCacheStore }

type HostSocketCacheConfig = {
	store?: HostNativeCacheStore
	group?: HostCacheEntryConfig
	device?: HostCacheEntryConfig
	deviceRegistry?: HostCacheEntryConfig
	lidPn?: HostCacheEntryConfig
	retriedGroupMessages?: HostCacheEntryConfig
	recentMessages?: HostCacheEntryConfig
	messageRetry?: HostCacheEntryConfig
}

export type HostSocketConfig = {
	auth: HostAuthenticationState
	logger?: ILogger
	waWebSocketUrl?: string | URL
	connectTimeoutMs?: number
	defaultQueryTimeoutMs?: number
	keepAliveIntervalMs?: number
	version?: [number, number, number]
	browser?: [os: string, browser: string, version: string]
	pushName?: string
	emitOwnEvents?: boolean
	customUploadHosts?: Array<{ hostname: string; maxContentLengthBytes: number }>
	shouldIgnoreJid?: (jid: string) => boolean | undefined
	options?: RequestInit
	cache?: HostSocketCacheConfig
	deviceProps?: Record<string, unknown>
	wantedPreKeyCount?: number
	dangerSkipCertChainVerify?: boolean
	qrTimeout?: number
	maxMsgRetryCount?: number
	retryRequestDelayMs?: number
	generateHighQualityLinkPreview?: boolean
	linkPreviewImageThumbnailWidth?: number
	enableAutoSessionRecreation?: boolean
	enableRecentMessageCache?: boolean
	markOnlineOnConnect?: boolean
	transactionOpts?: { maxCommitRetries: number; delayBetweenTriesMs: number }
	syncFullHistory?: boolean
	fireInitQueries?: boolean
	countryCode?: string
	downloadHistory?: boolean
	shouldSyncHistoryMessage?: (message: {
		syncType?: number | null
		chunkOrder?: number | null
		progress?: number | null
		fileLength?: number | string | { low: number; high: number; unsigned?: boolean } | null
		peerDataRequestSessionId?: string | null
	}) => boolean
	printQRInTerminal?: boolean
	ignoreOfflineMessages?: boolean
	mediaCache?: HostCacheStore
	msgRetryCounterCache?: HostCacheStore
	userDevicesCache?: HostCacheStore
	callOfferCache?: HostCacheStore
	placeholderResendCache?: HostCacheStore
	patchMessageBeforeSending?: (
		message: Record<string, unknown>,
		recipientJids?: string[]
	) =>
		| Promise<Record<string, unknown> | Record<string, unknown>[]>
		| Record<string, unknown>
		| Record<string, unknown>[]
	appStateMacVerification?: { patch: boolean; snapshot: boolean }
	getMessage?: (key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null }) => Promise<unknown>
	cachedGroupMetadata?: (jid: string) => Promise<Record<string, unknown> | undefined>
	makeSignalRepository?: (...args: never[]) => unknown
}

export type HostConnectionUpdate = {
	connection?: 'open' | 'connecting' | 'close'
	lastDisconnect?: { error?: Error; date: Date }
	isNewLogin?: boolean
	qr?: string
	receivedPendingNotifications?: boolean
	legacy?: { phoneConnected: boolean; user?: { id: string; name?: string } }
	isOnline?: boolean
	reachoutTimeLock?: Record<string, unknown>
}

export type HostBaileysEventMap = {
	'connection.update': HostConnectionUpdate
	'creds.update': Partial<HostAuthenticationCreds>
	'messages.upsert': {
		messages: WAMessage[]
		type: 'append' | 'notify'
		requestId?: string
	}
}

// Unknown event names are an intentional EventEmitter-compatible escape hatch;
// known Baileys events above retain contextual payload types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostEventListener = (...args: any[]) => void

type HostMappedEventListener<K extends keyof HostBaileysEventMap> = (payload: HostBaileysEventMap[K]) => void

export type HostEventEmitter = {
	on<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): HostEventEmitter
	on(event: string | symbol, listener: HostEventListener): HostEventEmitter
	off<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): HostEventEmitter
	off(event: string | symbol, listener: HostEventListener): HostEventEmitter
	once<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): HostEventEmitter
	once(event: string | symbol, listener: HostEventListener): HostEventEmitter
	prependListener<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): HostEventEmitter
	prependListener(event: string | symbol, listener: HostEventListener): HostEventEmitter
	prependOnceListener<K extends keyof HostBaileysEventMap>(
		event: K,
		listener: HostMappedEventListener<K>
	): HostEventEmitter
	prependOnceListener(event: string | symbol, listener: HostEventListener): HostEventEmitter
	removeListener<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): HostEventEmitter
	removeListener(event: string | symbol, listener: HostEventListener): HostEventEmitter
	removeAllListeners(event?: string | symbol): HostEventEmitter
	eventNames(): (string | symbol)[]
	rawListeners(event: string | symbol): HostEventListener[]
	listeners(event: string | symbol): HostEventListener[]
	listenerCount(event: string | symbol, listener?: HostEventListener): number
	setMaxListeners(count: number): HostEventEmitter
	getMaxListeners(): number
	emit<K extends keyof HostBaileysEventMap>(event: K, payload: HostBaileysEventMap[K]): boolean
	emit(event: string | symbol, ...args: unknown[]): boolean
}

/** Host-facing operations retain callable types without importing Node Baileys declarations. */
export type HostSocketEventEmitter = {
	on<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): void
	on(event: string | symbol, listener: HostEventListener): void
	off<K extends keyof HostBaileysEventMap>(event: K, listener: HostMappedEventListener<K>): void
	off(event: string | symbol, listener: HostEventListener): void
	removeAllListeners(event: string | symbol): void
	emit<K extends keyof HostBaileysEventMap>(event: K, payload: HostBaileysEventMap[K]): boolean
	emit(event: string | symbol, ...args: unknown[]): boolean
	process(handler: (events: Partial<HostBaileysEventMap> & Record<string, unknown>) => void | Promise<void>): () => void
	buffer(): void
	flush(force?: boolean): boolean
	isBuffering(): boolean
	createBufferedFunction<A extends unknown[], R>(work: (...args: A) => Promise<R>): (...args: A) => Promise<R>
	destroy(): void
}

export type HostWebSocketClient = HostEventEmitter & {
	url: URL
	config: unknown
	readonly isOpen: boolean
	readonly isClosed: boolean
	readonly isClosing: boolean
	readonly isConnecting: boolean
	connect(): void
	close(): Promise<void>
	send(data: string | Uint8Array, callback?: (error?: Error) => void): boolean
}

type HostMutex = { mutex<T>(work: () => Promise<T> | T): Promise<T> }

export type HostAnyMessageContent = string | Record<string, unknown>
export type HostMessageGenerationOptions = {
	messageId?: string
	useCachedGroupMetadata?: boolean
	timestamp?: Date
	ephemeralExpiration?: number | string
	mediaUploadTimeoutMs?: number
	statusJidList?: string[]
	backgroundColor?: string
	font?: number
}

type HostWASocketBase = {
	ev: HostSocketEventEmitter
	logger: ILogger
	ws: HostWebSocketClient
	type: 'md'
	user: { id: string; lid?: string; name?: string; verifiedName?: string; phoneNumber?: string } | undefined
	waClient: unknown | undefined
	readonly isConnected: boolean
	readonly isLoggedIn: boolean
	readonly authState: { creds: HostAuthenticationCreds; keys?: unknown }
	signalRepository: unknown
	messageRetryManager: null
	devicesMutex: HostMutex
	messageMutex: HostMutex
	receiptMutex: HostMutex
	appStatePatchMutex: HostMutex
	notificationMutex: HostMutex
	[Symbol.asyncDispose](): Promise<void>
	end: (error?: unknown) => Promise<void> | void
	sendMessage(jid: string, content: HostAnyMessageContent, options?: HostMessageGenerationOptions): Promise<WAMessage>
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
