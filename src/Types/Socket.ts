import type { Agent } from 'node:https'
import type { URL } from 'url'
import type { CacheConfig, DevicePropsInput } from '@oxidezap/whatsapp-rust-bridge'
import type { proto } from '../WAProto/runtime.ts'

export type {
	DeviceAppVersion,
	DeviceHistorySyncConfig,
	DevicePlatformType,
	DevicePropsInput
} from '@oxidezap/whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger.ts'
import type { AuthenticationState, LIDMapping, SignalAuthState } from './Auth.ts'
import type { GroupMetadata } from './GroupMetadata.ts'
import type { MediaConnInfo, WAMessageKey } from './Message.ts'
import type { SignalRepositoryWithLIDStore } from './Signal.ts'

export type WAVersion = [number, number, number]
export type WABrowserDescription = [string, string, string]

export type CacheStore = {
	/** get a cached key and change the stats */
	get<T>(key: string): Promise<T> | T | undefined
	/** set a key in the cache */
	set<T>(key: string, value: T): Promise<void> | void | number | boolean
	/** delete a key from the cache */
	del(key: string): void | Promise<void> | number | boolean
	/** flush all data */
	flushAll(): void | Promise<void>
	close?: () => void
}

export type PossiblyExtendedCacheStore = CacheStore & {
	mget?: <T>(keys: string[]) => Promise<Record<string, T | undefined>>
	mset?: <T>(entries: { key: string; value: T }[]) => Promise<void> | void | number | boolean
	mdel?: (keys: string[]) => void | Promise<void> | number | boolean
}

export type PatchedMessageWithRecipientJID = proto.IMessage & { recipientJid?: string }

export type SocketConfig = {
	/** the WS url to connect to WA */
	waWebSocketUrl: string | URL
	/** Fails the connection if the socket times out in this interval */
	connectTimeoutMs: number
	/** Default timeout for queries, undefined for no timeout */
	defaultQueryTimeoutMs: number | undefined
	/** ping-pong interval for WS connection */
	keepAliveIntervalMs: number
	/** @deprecated Mobile mode was removed upstream. */
	mobile?: boolean
	/** Proxy agent used by socket requests. */
	agent?: Agent
	/** logger */
	logger: ILogger
	/** version to connect with */
	version: WAVersion
	/** override browser config */
	browser: WABrowserDescription
	/** Initial push name sent in the registration payload before first pairing. */
	pushName?: string
	/** Agent used for media fetches. */
	fetchAgent?: Agent
	/** should events be emitted for actions done by this socket connection */
	emitOwnEvents: boolean
	/** Custom media upload hosts. */
	customUploadHosts: MediaConnInfo['hosts']
	/** provide an auth state object to maintain the auth state */
	auth: AuthenticationState
	/**
	 * Returns if a jid should be ignored,
	 * no event for that jid will be triggered.
	 * Messages from that jid will also not be decrypted
	 * */
	shouldIgnoreJid: (jid: string) => boolean | undefined
	/** options for HTTP fetch requests */
	options: RequestInit
	/**
	 * Cache configuration — tune TTL, capacity, or provide custom store backends.
	 * Omitted fields keep defaults. See CacheConfig type for details.
	 */
	cache?: CacheConfig
	/**
	 * Override the `DeviceProps` advertised in the pairing registration node
	 * (display name in "Linked Devices" + server-side feature gating, e.g.
	 * view-once payload vs `absent` stub for non-Android companions).
	 *
	 * Orthogonal to `browser` — that controls the connection identity, this
	 * controls the post-pairing display identity. When omitted, defaults are
	 * derived from `browser`. Setting `platformType: 'ANDROID_PHONE'` does
	 * NOT switch the underlying transport — baileyrs still speaks the web
	 * protocol; real Android companion mode (CRSC/TEE) is not implemented.
	 */
	deviceProps?: DevicePropsInput

	/**
	 * Number of one-time pre-keys generated and uploaded per batch. Defaults to
	 * WhatsApp Web's 812; clamped to the protocol-safe range at upload time.
	 * Lower it to cut memory/CPU of the first pre-key upload (the whole batch is
	 * generated and encoded in one shot). Must be set before connecting.
	 */
	wantedPreKeyCount?: number

	// ─────────────────────────────────────────────────────────────────────
	// Compatibility options are either translated by the socket or owned by
	// the native runtime. Keep their public declarations exact.
	// ─────────────────────────────────────────────────────────────────────

	/** @deprecated QR timeout is handled by the bridge connection state machine. */
	qrTimeout?: number
	/** Maximum retry count. */
	maxMsgRetryCount: number
	/** Delay between retry requests. */
	retryRequestDelayMs: number
	/** Generate high-quality link previews. */
	generateHighQualityLinkPreview: boolean
	/** Width used for link-preview images. */
	linkPreviewImageThumbnailWidth: number
	/** Enable automatic session recreation for failed messages. */
	enableAutoSessionRecreation: boolean
	/** Enable the recent-message retry cache. */
	enableRecentMessageCache: boolean
	/** Mark the client online after connecting. */
	markOnlineOnConnect: boolean
	/** Retry policy for compatibility key-store transactions. */
	transactionOpts: { maxCommitRetries: number; delayBetweenTriesMs: number }
	/** Request full history synchronization. */
	syncFullHistory: boolean
	/** Fire initialization queries automatically. */
	fireInitQueries: boolean
	/** Alphanumeric country code used for number parsing. */
	countryCode: string
	/** @deprecated History download policy lives in the bridge. */
	downloadHistory?: boolean
	/** Decide whether a history notification should be processed. */
	shouldSyncHistoryMessage: (msg: proto.Message.IHistorySyncNotification) => boolean
	/** @deprecated QR rendering is the caller's responsibility — listen on `connection.update` for the QR string. */
	printQRInTerminal?: boolean
	/** @deprecated Offline-message handling is built into the bridge event stream. */
	ignoreOfflineMessages?: boolean
	/** Optional media cache. */
	mediaCache?: CacheStore
	/** Optional retry-counter cache. */
	msgRetryCounterCache?: CacheStore
	/** Optional user-device cache. */
	userDevicesCache?: PossiblyExtendedCacheStore
	/** Optional call-offer cache. */
	callOfferCache?: CacheStore
	/** Optional placeholder-resend cache. */
	placeholderResendCache?: CacheStore
	/** Patch a message before it is sent. */
	patchMessageBeforeSending: (
		msg: proto.IMessage,
		recipientJids?: string[]
	) =>
		| Promise<PatchedMessageWithRecipientJID[] | PatchedMessageWithRecipientJID>
		| PatchedMessageWithRecipientJID[]
		| PatchedMessageWithRecipientJID
	/** App-state MAC verification policy. */
	appStateMacVerification: { patch: boolean; snapshot: boolean }
	/** Resolve a message from the caller's store for retries. */
	getMessage: (key: WAMessageKey) => Promise<proto.IMessage | undefined>
	/** Resolve cached group metadata. */
	cachedGroupMetadata: (jid: string) => Promise<GroupMetadata | undefined>
	makeSignalRepository: (
		auth: SignalAuthState,
		logger: ILogger,
		pnToLIDFunc?: (jids: string[]) => Promise<LIDMapping[] | undefined>
	) => SignalRepositoryWithLIDStore
}
