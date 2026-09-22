/**
 * Host-neutral runtime capabilities for `createWASocketFactory`.
 *
 * No `node:` imports, no filesystem, no Node streams: the bridge comes from
 * the host-loaded entrypoint (`initSync({ module })` before first use),
 * randomness is WebCrypto, timers are duck-typed (no `unref` contract),
 * platform identity is the stable Ubuntu fallback, crypto stays in
 * Rust/WASM, and log lines go to `console.log`.
 */

import EventEmitter from 'events'
import * as bridge from '@oxidezap/whatsapp-rust-bridge/host'
import Long from 'long'
import { randomBytes } from './bytes.ts'
import type { BaileysRuntime } from './types.ts'
import { nodeMedia } from './node-media.ts'

nodeMedia.hkdf = bridge.hkdf

/** Stable fallback: Ubuntu 22.04, matching `Browsers.ubuntu()` output shape. */
export const HOST_PLATFORM_FALLBACK = { os: 'Ubuntu', release: '22.04.4' } as const

export const hostPlatformInfo = () => ({ ...HOST_PLATFORM_FALLBACK })

export const hostLoggerSink = (line: string, delivered?: () => void): void => {
	try {
		console.log(line)
	} catch {
		/* logging must not crash the host it observes */
	} finally {
		delivered?.()
	}
}

export const hostRuntime: BaileysRuntime = {
	bridge: bridge as never,
	randomBytes,
	setTimeout: (callback, ms) => setTimeout(callback, ms) as never,
	clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
	queueMicrotask: callback => queueMicrotask(callback),
	events: {
		createEmitter: () => new EventEmitter() as never
	},
	platformInfo: hostPlatformInfo,
	nativeCrypto: undefined,
	loggerSink: hostLoggerSink,
	logLevel: () => undefined,
	Long
}
