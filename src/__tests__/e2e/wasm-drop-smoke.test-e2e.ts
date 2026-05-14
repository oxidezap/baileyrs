/**
 * Isolated smoke test for the `WasmWhatsAppClient::Drop` fix in
 * `whatsapp-rust-bridge`.
 *
 * Bypasses the mock server entirely — uses hand-rolled
 * transport/HTTP/store adapters that return Promises which never
 * resolve, so the bridge sits with a `run()` loop and in-flight
 * JsFutures at the moment we drop the client.
 *
 * Production reference (alpha.25, wasm-bindgen 0.2.120): the second
 * `createWhatsAppClient` after an ungraceful free could throw
 * `RuntimeError: memory access out of bounds` at `__wbg_new_typed_…`
 * because the first round's detached `run()` task had corrupted the
 * shared WASM heap. The fix (Drop impl on `WasmWhatsAppClient` that
 * aborts handles + drains via oneshot before the next constructor)
 * combined with the wasm-bindgen 0.2.121 upgrade closed the race.
 *
 * What this file asserts: across many ungraceful free cycles, no
 * `uncaughtException` carrying the OOB signatures fires *during* the
 * test window. Errors that fire *after* the test ended are not the
 * regression we're guarding against — `wasm-bindgen` has its own
 * post-shutdown noise (e.g. wakers on dropped Tasks) that lives
 * outside our control.
 */

import process from 'node:process'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import {
	createWhatsAppClient,
	initWasmEngine,
	type JsHttpClientConfig,
	type JsStoreCallbacks,
	type JsTransportCallbacks,
	type WasmWhatsAppClient
} from 'whatsapp-rust-bridge'
import { expect } from '../expect.ts'

// ---------------------------------------------------------------------------
// Crash trap — describe-level so late-firing errors from a previous test
// don't propagate into the next test's window. Each test grabs a `startIdx`
// in beforeEach and only inspects entries from that point on.
// ---------------------------------------------------------------------------

type Crash = { kind: 'uncaughtException' | 'unhandledRejection'; err: unknown }
const captured: Crash[] = []
const onUncaught = (err: unknown) => captured.push({ kind: 'uncaughtException', err })
const onRejection = (err: unknown) => captured.push({ kind: 'unhandledRejection', err })

let startIdx = 0

function isWasmOobCrash(err: unknown): boolean {
	const msg = (err as Error)?.message ?? String(err)
	const stack = (err as Error)?.stack ?? ''
	return (
		/out of bounds memory access|Out of bounds memory access|memory access out of bounds/i.test(msg) ||
		/__wasm_bindgen_func_elem/i.test(stack)
	)
}

function currentCrashes(): Crash[] {
	return captured.slice(startIdx)
}

function dumpCrashes(): string {
	return currentCrashes()
		.map((c, i) => `\n[${i}] ${c.kind}: ${(c.err as Error)?.stack ?? String(c.err)}`)
		.join('\n')
}

/** Yield to the JS event loop enough times to drain microtasks and
 *  setImmediate callbacks. Used between ungraceful frees to give the
 *  bridge's spawn-local cleanup a chance to settle. Pure event-driven
 *  (no fixed wait). */
async function quiesce(ticks = 5): Promise<void> {
	for (let i = 0; i < ticks; i++) {
		await new Promise<void>(resolve => setImmediate(resolve))
	}
}

// ---------------------------------------------------------------------------
// Mock callbacks — every async path returns a Promise that never resolves
// EXCEPT the store, which must resolve so `createWhatsAppClient` itself
// can finish init.
// ---------------------------------------------------------------------------

function makeStuckTransport(): JsTransportCallbacks {
	return {
		connect: () => new Promise<void>(() => {}),
		send: () => new Promise<void>(() => {}),
		disconnect: () => new Promise<void>(() => {})
	}
}

function makeStuckHttp(): JsHttpClientConfig {
	return { execute: () => new Promise(() => {}) }
}

function makeFastStore(): JsStoreCallbacks {
	return {
		get: async () => null,
		set: async () => undefined,
		delete: async () => undefined
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WasmWhatsAppClient Drop fix — smoke (no mock server needed)', { timeout: 60_000 }, () => {
	before(() => {
		process.on('uncaughtException', onUncaught)
		process.on('unhandledRejection', onRejection)
		initWasmEngine()
	})

	after(() => {
		process.off('uncaughtException', onUncaught)
		process.off('unhandledRejection', onRejection)
	})

	beforeEach(() => {
		startIdx = captured.length
	})

	test('SMOKE-1: 10 rounds of create → free() with hanging Promises', async () => {
		const ROUNDS = 10
		for (let r = 0; r < ROUNDS; r++) {
			let client: WasmWhatsAppClient | undefined
			try {
				client = await createWhatsAppClient(makeStuckTransport(), makeStuckHttp(), null, makeFastStore())
			} catch (e) {
				throw new Error(
					`round ${r}: createWhatsAppClient threw — heap probably corrupted by previous round: ${(e as Error)?.stack}`,
					{ cause: e }
				)
			}

			client.run()
			void client.getMediaConn?.(true).catch(() => undefined)
			void client.fetchBlocklist?.().catch(() => undefined)

			await quiesce()

			client.free()
			await quiesce()

			if (currentCrashes().some(c => isWasmOobCrash(c.err))) {
				throw new Error(`SMOKE-1 round ${r} hit WASM OOB:${dumpCrashes()}`)
			}
		}

		expect(currentCrashes().filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('SMOKE-2: 4 clients alive at once, interleaved free + recreate', async () => {
		const N = 4
		const clients: WasmWhatsAppClient[] = []
		for (let i = 0; i < N; i++) {
			const c = await createWhatsAppClient(makeStuckTransport(), makeStuckHttp(), null, makeFastStore())
			c.run()
			void c.getMediaConn?.(true).catch(() => undefined)
			clients.push(c)
		}

		await quiesce()

		// Free in arbitrary order — mirrors a bot manager replacing entries
		// out-of-order under load.
		for (const client of [clients[2]!, clients[0]!, clients[3]!, clients[1]!]) {
			client.free()
			await quiesce()
			if (currentCrashes().some(c => isWasmOobCrash(c.err))) {
				throw new Error(`SMOKE-2 hit WASM OOB during interleaved free:${dumpCrashes()}`)
			}
		}

		// Allocate a new client AFTER all frees — same path that crashed
		// pre-fix at `__wbg_new_typed_…`.
		const afterc = await createWhatsAppClient(makeStuckTransport(), makeStuckHttp(), null, makeFastStore())
		afterc.run()
		await quiesce()
		afterc.free()
		await quiesce()

		expect(currentCrashes().filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test(
		'SMOKE-3: GC-triggered free via FinalizationRegistry',
		{ skip: !(globalThis as { gc?: () => void }).gc },
		async () => {
			const gc = (globalThis as { gc: () => void }).gc

			const ROUNDS = 6
			for (let r = 0; r < ROUNDS; r++) {
				let client: WasmWhatsAppClient | undefined = await createWhatsAppClient(
					makeStuckTransport(),
					makeStuckHttp(),
					null,
					makeFastStore()
				)
				client.run()
				void client.getMediaConn?.(true).catch(() => undefined)

				await quiesce()

				// Drop the only reference and force GC. FinalizationRegistry
				// should fire `__wbg_wasmwhatsappclient_free` — production path
				// when user code loses the sock reference.
				client = undefined
				for (let g = 0; g < 5; g++) {
					gc()
					await quiesce()
					// Sleep a hair to give V8 time to dispatch finalizers between
					// gc() calls. Not strictly event-driven because there's no JS
					// API to subscribe to "FR callbacks dispatched"; this is the
					// minimum we can do without a poll loop.
					await delay(20)
				}

				if (currentCrashes().some(c => isWasmOobCrash(c.err))) {
					throw new Error(`SMOKE-3 round ${r} hit WASM OOB after GC:${dumpCrashes()}`)
				}
			}

			expect(currentCrashes().filter(c => isWasmOobCrash(c.err)).length).toBe(0)
		}
	)
})
