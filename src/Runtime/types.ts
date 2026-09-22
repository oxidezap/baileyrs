/**
 * Runtime capability interface for `makeWASocket`.
 *
 * A `BaileysRuntime` bundles every host operation the socket core needs that
 * differs between runtimes: bridge entrypoint, randomness, timers, event
 * emitter construction, platform identity, native crypto, media processing
 * and logging. `Socket/core.ts` consumes only this interface, so the same
 * factory builds the Node socket and the host-neutral socket from different
 * capabilities. There is intentionally no global mutable runtime: callers
 * pick `nodeRuntime` or `hostRuntime` (or a custom one) per socket.
 */

import type { AuthenticationState, NativeAuthenticationState } from '../Types/Auth.ts'
import type {
	BinaryReader as BridgeBinaryReader,
	JsHttpClientConfig,
	JsTransportCallbacks,
	WasmWhatsAppClient,
	WhatsAppEventCallbacks,
	CacheConfig,
	ClientPolicies,
	JsStoreCallbacks
} from '@oxidezap/whatsapp-rust-bridge/host'
import type Long from 'long'
import type { ILogger } from '../Utils/logger.ts'

/** Subset of the bridge surface the socket core touches. */
export interface BridgeRuntime {
	createWhatsAppClient(
		transport: JsTransportCallbacks,
		httpClient: JsHttpClientConfig,
		onEvent?: WhatsAppEventCallbacks | null,
		store?: JsStoreCallbacks | null,
		cache?: CacheConfig | null,
		version?: readonly [number, number, number] | null,
		wantedPreKeyCount?: number | null,
		dangerSkipCertChainVerify?: boolean | null,
		policies?: ClientPolicies | null
	): Promise<WasmWhatsAppClient>
	initWasmEngine(logger?: unknown, crypto?: unknown): void
	encodeProto(path: string, message: unknown): Uint8Array
	decodeProto(path: string, data: Uint8Array): unknown
	inflateZlib(data: Uint8Array, maxOutputBytes?: number | null): Uint8Array
	BinaryReader: typeof BridgeBinaryReader
	decodeMessageWireBatch(data: Uint8Array): unknown
	decodeReceiptWireBatch(data: Uint8Array): unknown
	decodeServerAckWireBatch(data: Uint8Array): unknown
	decryptPollVotePayload(
		encPayload: Uint8Array,
		encIv: Uint8Array,
		messageSecret: Uint8Array,
		stanzaId: string,
		pollCreatorJid: string,
		voterJid: string
	): Uint8Array
	decryptEventResponsePayload(
		encPayload: Uint8Array,
		encIv: Uint8Array,
		messageSecret: Uint8Array,
		stanzaId: string,
		eventCreatorJid: string,
		responderJid: string
	): Uint8Array
}

/** Minimal emitter surface the socket core needs. */
export interface EmitterFactory {
	createEmitter(): {
		on(event: string, listener: (...args: never[]) => void): unknown
		off(event: string, listener: (...args: never[]) => void): unknown
		once(event: string, listener: (...args: never[]) => void): unknown
		prependListener(event: string, listener: (...args: never[]) => void): unknown
		prependOnceListener(event: string, listener: (...args: never[]) => void): unknown
		removeListener(event: string, listener: (...args: never[]) => void): unknown
		removeAllListeners(event?: string): unknown
		eventNames(): (string | symbol)[]
		emit(event: string, ...args: never[]): boolean
	}
}

/** Platform identity for `Browsers.appropriate()` and device props. */
export interface PlatformInfo {
	os: string
	release: string
}

export interface BaileysRuntime {
	/** Bridge entrypoint: Node imports the bare root, hosts import `/host`. */
	bridge: BridgeRuntime
	/** Cryptographically strong random bytes (WebCrypto-backed everywhere). */
	randomBytes(length: number): Uint8Array
	/** Timer handle with optional `unref` (Node) / plain (hosts). */
	setTimeout(callback: () => void, ms: number): { unref?: () => void; ref?: () => void }
	clearTimeout(handle: unknown): void
	setImmediate?(callback: () => void): unknown
	queueMicrotask(callback: () => void): void
	/** Portable event emitter constructor (the `events` package). */
	events: EmitterFactory
	/** Platform identity; absent on hosts (stable fallback is used). */
	platformInfo?(): PlatformInfo
	/** Native AES/HMAC fast path; absent on hosts (Rust/WASM fallback). */
	nativeCrypto?: unknown
	/** Runtime-specific default logger. Node preserves the pino-backed connection logger; hosts omit it. */
	defaultLogger?: ILogger
	/** Where core log lines go: Node writes stdout, hosts console. */
	loggerSink(line: string, delivered?: () => void): void
	/** Log level: Node reads `BAILEYRS_LOG_LEVEL`, hosts use config/default. */
	logLevel(): string | undefined
	/** Normalize auth while preserving the root Node projection or host native store. */
	normalizeAuth?: (input: AuthenticationState | NativeAuthenticationState) => AuthenticationState
	/** Node-only legacy auth adapter; absent on host runtimes. */
	wrapLegacyStore?: (state: unknown, onCredsUpdate: () => Promise<void>, logger: unknown) => Promise<JsStoreCallbacks>
	/** Node-only Baileys transaction facade; native host stores do not need it. */
	makeTransactionKeyStore?: (state: unknown, logger: unknown, options: unknown) => () => unknown
	/** 64-bit integer constructor identity for this runtime's module graph. */
	Long: typeof Long
}
