import type { URL } from 'url'
import type { CacheConfig } from 'whatsapp-rust-bridge'
import type { proto } from 'whatsapp-rust-bridge/proto-types'
import type { ILogger } from '../Utils/logger.ts'
import type { AuthenticationState } from './Auth.ts'
import type { GroupMetadata } from './GroupMetadata.ts'
import type { WAMessageContent, WAMessageKey } from './Message.ts'

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
	/** logger */
	logger: ILogger
	/** version to connect with */
	version: WAVersion
	/** override browser config */
	browser: WABrowserDescription
	/** should events be emitted for actions done by this socket connection */
	emitOwnEvents: boolean
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

	// ─────────────────────────────────────────────────────────────────────
	// Upstream-Baileys options accepted for type-level compatibility.
	//
	// All of the following are silently ignored by baileyrs because the Rust
	// bridge handles the underlying behavior natively. They live here so that
	// `makeWASocket({...upstreamConfig})` keeps type-checking against code
	// migrated from `@whiskeysockets/baileys` without forcing the caller to
	// strip fields. None of these have a runtime effect — passing them is a
	// no-op, not an error.
	// ─────────────────────────────────────────────────────────────────────

	/** @deprecated QR timeout is handled by the bridge connection state machine. */
	qrTimeout?: number
	/** @deprecated Message retries are managed by the bridge. */
	maxMsgRetryCount?: number
	/** @deprecated Retry backoff is handled by the bridge. */
	retryRequestDelayMs?: number
	/** @deprecated Link previews are not generated automatically; build via your own helper if needed. */
	generateHighQualityLinkPreview?: boolean
	/** @deprecated See `generateHighQualityLinkPreview`. */
	linkPreviewImageThumbnailWidth?: number
	/** @deprecated Session recreation is automatic via the bridge's signal layer. */
	enableAutoSessionRecreation?: boolean
	/** @deprecated The bridge keeps its own recent-message cache. */
	enableRecentMessageCache?: boolean
	/** @deprecated Use `sendPresenceUpdate('available')` after `connection: 'open'` instead. */
	markOnlineOnConnect?: boolean
	/** @deprecated Auth/key storage is owned by the bridge; transactions are an internal concern. */
	transactionOpts?: { maxCommitRetries: number; delayBetweenTriesMs: number }
	/** @deprecated History sync is driven by the bridge; see `messaging-history.set` events. */
	syncFullHistory?: boolean
	/** @deprecated Init queries are issued by the bridge on connect. */
	fireInitQueries?: boolean
	/** @deprecated History download policy lives in the bridge. */
	downloadHistory?: boolean
	/** @deprecated See `syncFullHistory`. */
	shouldSyncHistoryMessage?: (msg: proto.Message.IHistorySyncNotification) => boolean
	/** @deprecated QR rendering is the caller's responsibility — listen on `connection.update` for the QR string. */
	printQRInTerminal?: boolean
	/** @deprecated Offline-message handling is built into the bridge event stream. */
	ignoreOfflineMessages?: boolean
	/** @deprecated Retry counters are kept inside the bridge. */
	msgRetryCounterCache?: CacheStore
	/** @deprecated The bridge maintains its own group-metadata cache (see `cache.group`). */
	cachedGroupMetadata?: (jid: string) => Promise<GroupMetadata | undefined>
	/** @deprecated Decryption retries are handled by the bridge using its message store. */
	getMessage?: (key: WAMessageKey) => Promise<WAMessageContent | undefined>
}
