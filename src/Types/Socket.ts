import type { URL } from 'url'
import type { CacheConfig } from 'whatsapp-rust-bridge'
import type { proto } from '../../WAProto/index.js'
import type { ILogger } from '../Utils/logger'
import type { AuthenticationState } from './Auth'

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
}
