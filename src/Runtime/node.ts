/**
 * Node runtime capabilities for `createWASocketFactory`.
 *
 * The Node runtime keeps current behavior exactly: bare bridge entrypoint
 * (reads the wasm off disk), WebCrypto-backed randomness (measured at parity
 * with `node:crypto`), `node:events` emitter, `platform()`/`release()`
 * identity, OpenSSL native crypto fast path, and the stdout logger sink with
 * `BAILEYRS_LOG_LEVEL`.
 */

import { randomBytes as nodeRandomBytesSource } from 'node:crypto'
import EventEmitter from 'events'
import { platform, release } from 'node:os'
import * as bridge from '@oxidezap/whatsapp-rust-bridge'
import Long from 'long'
import { makeNativeCryptoProvider } from '../Utils/native-crypto-provider.ts'
import type { BaileysRuntime } from './types.ts'

export const nodeRandomBytes = (length: number): Uint8Array => {
	const out = new Uint8Array(length)
	if (length > 0) {
		const native = nodeRandomBytesSource(length)
		out.set(native)
	}
	return out
}

export const nodeLoggerSink = (line: string): void => {
	try {
		process.stdout.write(`${line}\n`)
	} catch {
		/* logging must not crash the process it observes */
	}
}

export const nodeRuntime: BaileysRuntime = {
	bridge,
	randomBytes: nodeRandomBytes,
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
	setImmediate: callback => setImmediate(callback),
	queueMicrotask: callback => queueMicrotask(callback),
	events: {
		createEmitter: () => new EventEmitter() as never
	},
	platformInfo: () => ({ os: platform(), release: release() }),
	nativeCrypto: makeNativeCryptoProvider(),
	loggerSink: nodeLoggerSink,
	logLevel: () => process.env.BAILEYRS_LOG_LEVEL,
	Long
}
