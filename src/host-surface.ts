// Host surface: deliberately separate declarations from the Node-shaped Types barrel.
import { createWASocketFactory as createFactory } from './Socket/core.ts'
import { hostLoggerSink, hostRuntime } from './Runtime/host.ts'
import { setPlatformInfo as setPlatformInfoInternal } from './Utils/browser-utils.ts'
import { useMemoryStore as makeMemoryStore } from './Utils/use-memory-store.ts'
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge/host'
import type { HostRuntime, HostSocketConfig, HostWASocket } from './host-types.ts'

export * from './host-types.ts'
export const useMemoryStore = (options?: { native?: boolean }): JsStoreCallbacks => makeMemoryStore(options)
export { createAuthenticationState, initHostAuthCreds } from './Compatibility/host-auth-state.ts'
export const setPlatformInfo = (info: { os: string; release: string }): void => {
	setPlatformInfoInternal(info as never)
	hostRuntime.platformInfo = () => ({ ...info })
}
export const setLoggerSink = (sink: ((line: string, delivered?: () => void) => void) | undefined): void => {
	hostRuntime.loggerSink = sink ?? hostLoggerSink
}

export type HostSocketFactory = (config: HostSocketConfig) => HostWASocket

/** Build a host socket factory from explicitly supplied host capabilities. */
export const createWASocketFactory = (runtime: HostRuntime): HostSocketFactory =>
	createFactory(runtime as never) as unknown as HostSocketFactory

/** Host-bound socket factory: global WebSocket/fetch/WebCrypto and caller-owned WASM. */
export const makeHostWASocket: HostSocketFactory = createWASocketFactory(hostRuntime)
export const makeWASocket: HostSocketFactory = makeHostWASocket
export default makeWASocket
