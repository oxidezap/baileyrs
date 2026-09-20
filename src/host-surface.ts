// Host surface: everything in `./surface.ts` plus the host-bound socket
// factory and the in-memory store. No `node:` imports anywhere in this
// graph — the bridge arrives via `@oxidezap/whatsapp-rust-bridge/host`
// after the consumer calls `initSync({ module: wasm })`.
export * from './surface.ts'
export { useMemoryStore } from './Utils/use-memory-store.ts'
export { hostRuntime } from './Runtime/host.ts'
export { setPlatformInfo } from './Utils/browser-utils.ts'
export { setLoggerSink } from './Utils/logger.ts'
export { createWASocketFactory } from './Socket/core.ts'
import { createWASocketFactory } from './Socket/core.ts'
import { hostRuntime } from './Runtime/host.ts'

/** Host-bound socket factory: global WebSocket/fetch/WebCrypto, Rust crypto, no fs. */
export const makeHostWASocket = createWASocketFactory(hostRuntime)
export const makeWASocket = makeHostWASocket
export default makeWASocket
