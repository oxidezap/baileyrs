// Host surface: deliberately separate declarations from the Node-shaped Types barrel.
import { createWASocketFactory as createFactory } from './Socket/core.ts'
import { hostLoggerSink, hostRuntime } from './Runtime/host.ts'
import { useMemoryStore as makeMemoryStore } from './Utils/use-memory-store.ts'
import type { HostLoggerSink, HostRuntime, HostSocketConfig, HostStoreCallbacks, HostWASocket } from './host-types.ts'

export * from './host-types.ts'
export const useMemoryStore = (options?: { native?: boolean }): HostStoreCallbacks => makeMemoryStore(options)
export { createAuthenticationState, initHostAuthCreds } from './Compatibility/host-auth-state.ts'
export const setPlatformInfo = (info: { os: string; release: string }): void => {
	hostRuntime.platformInfo = () => ({ ...info })
}
export function setLoggerSink(sink: HostLoggerSink | undefined): void {
	if (!sink) {
		hostRuntime.loggerSink = hostLoggerSink
		return
	}
	hostRuntime.loggerSink = (line, delivered) => {
		if (sink.length >= 2) (sink as (line: string, delivered: () => void) => void)(line, delivered ?? (() => {}))
		else {
			;(sink as (line: string) => void)(line)
			delivered?.()
		}
	}
}

export type HostSocketFactory = (config: HostSocketConfig) => HostWASocket

/** Build a host socket factory from explicitly supplied host capabilities. */
export const createWASocketFactory = (runtime: HostRuntime): HostSocketFactory =>
	createFactory(runtime as never) as unknown as HostSocketFactory

/** Host-bound socket factory: global WebSocket/fetch/WebCrypto and caller-owned WASM. */
export const makeHostWASocket: HostSocketFactory = createWASocketFactory(hostRuntime as unknown as HostRuntime)
export const makeWASocket: HostSocketFactory = makeHostWASocket
export default makeWASocket
