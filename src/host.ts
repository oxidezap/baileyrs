/**
 * Host entrypoint: runtime-neutral `makeWASocket` for Workers/workerd/DO,
 * Deno and browser-like hosts.
 *
 * The bridge WASM arrives host-supplied — the host imports it with whatever
 * its platform provides and passes it to `initSync` before creating a
 * socket:
 *
 * ```ts
 * import { readFileSync } from 'node:fs' // Node check only; on a real host use its own import
 * import { initSync } from '@oxidezap/whatsapp-rust-bridge/host'
 * import { makeWASocket, createAuthenticationState, useMemoryStore } from '@oxidezap/baileyrs/host'
 *
 * initSync({ module: readFileSync('whatsapp_rust_bridge_bg.wasm') })
 * const auth = await createAuthenticationState(useMemoryStore())
 * const sock = makeWASocket({ auth, logger: myLogger })
 * ```
 *
 * (`@oxidezap/baileyrs/wasm` re-exports the bridge WASM asset without
 * duplicating it — see `src/wasm.ts`. Bundlers that cannot import `.wasm`
 * pass raw bytes instead; both shapes are `SyncInitInput`.)
 *
 * Host defaults: global `WebSocket` transport, `fetch` HTTP client,
 * WebCrypto randomness, portable emitter, stable Ubuntu platform fallback,
 * Rust/WASM crypto (no OpenSSL fast path), `console` logger sink, no
 * filesystem auth, no media processors, no `Buffer`/`Readable` inputs.
 */
export * from './surface.ts'
export {
	createWASocketFactory,
	makeHostWASocket,
	makeWASocket,
	setLoggerSink,
	setPlatformInfo,
	useMemoryStore
} from './host-surface.ts'
export type { HostSocketFactory } from './host-surface.ts'
export type {
	HostAuthenticationCreds,
	HostAuthenticationState,
	HostBaileysEventMap,
	HostBridgeRuntime,
	HostCacheStore,
	HostConnectionUpdate,
	HostEventEmitter,
	HostKeyPair,
	HostLongConstructor,
	HostLongValue,
	HostRuntime,
	HostSignedKeyPair,
	HostSocketConfig,
	HostSocketEventEmitter,
	HostStoreCallbacks,
	HostWASocket,
	HostWebSocketClient
} from './host-types.ts'
export { default } from './host-surface.ts'
