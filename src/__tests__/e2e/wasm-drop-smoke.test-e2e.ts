/**
 * Isolated smoke test for the `WasmWhatsAppClient::Drop` fix.
 *
 * Bypasses the mock server entirely — uses hand-rolled transport/HTTP/store
 * adapters that return Promises which never resolve. This reproduces the
 * exact production failure mode (in-flight JsFutures at the moment `free()`
 * lands) without needing pairing or a real WS endpoint.
 *
 * Pre-fix: 2nd round's `createWhatsAppClient` crashed with
 *   `RuntimeError: memory access out of bounds` at `__wbg_new_typed_…`,
 * because the 1st round's detached `run()` task kept polling stale state
 * and corrupted the shared WASM heap. Post-fix: each round's `free()`
 * aborts the spawned tasks before the heap is reused, so subsequent
 * allocations are safe.
 *
 * What we assert: 10 rounds of `create → start tasks with hanging Promises
 * → free()` complete without any `uncaughtException` carrying
 * `Out of bounds memory access` or `wasm_bindgen_func_elem`. If the bug
 * regresses, this test fails fast with the WASM stack as the captured error.
 */

import process from 'node:process'
import { afterEach, beforeEach, describe, test } from 'node:test'
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
// Crash-trap
// ---------------------------------------------------------------------------

type Crash = { kind: 'uncaughtException' | 'unhandledRejection'; err: unknown }
let captured: Crash[] = []
const onUncaught = (err: unknown) => captured.push({ kind: 'uncaughtException', err })
const onRejection = (err: unknown) => captured.push({ kind: 'unhandledRejection', err })

beforeEach(() => {
	captured = []
	process.on('uncaughtException', onUncaught)
	process.on('unhandledRejection', onRejection)
})

afterEach(() => {
	process.off('uncaughtException', onUncaught)
	process.off('unhandledRejection', onRejection)
})

function isWasmOobCrash(err: unknown): boolean {
	const msg = (err as Error)?.message ?? String(err)
	const stack = (err as Error)?.stack ?? ''
	return (
		/out of bounds memory access|Out of bounds memory access|memory access out of bounds/i.test(msg) ||
		/__wasm_bindgen_func_elem/i.test(stack)
	)
}

function dumpCrashes(): string {
	return captured.map((c, i) => `\n[${i}] ${c.kind}: ${(c.err as Error)?.stack ?? String(c.err)}`).join('\n')
}

// ---------------------------------------------------------------------------
// Mock callbacks — every async path returns a Promise that never resolves
// ---------------------------------------------------------------------------

/** Transport whose `connect()` returns a pending Promise. The bridge waits
 *  forever for the WS to open — perfect for parking the run loop in a
 *  JsFuture::from(promise).await. */
function makeStuckTransport(): JsTransportCallbacks {
	return {
		connect: () => new Promise<void>(() => {}),
		send: () => new Promise<void>(() => {}),
		disconnect: () => new Promise<void>(() => {})
	}
}

function makeStuckHttp(): JsHttpClientConfig {
	return {
		execute: () => new Promise(() => {})
	}
}

/** Store that resolves immediately — required because `PersistenceManager::new`
 *  awaits store callbacks during `createWhatsAppClient`. A hanging store
 *  hangs init forever. We only need transport/HTTP to hang to keep JsFutures
 *  parked. */
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
	test('SMOKE-1: create → free() with hanging Promises → next create succeeds (10 rounds)', async () => {
		initWasmEngine()

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

			// Kick off run() — spawns the detached background loop that holds
			// the JsFuture against `connect()`'s eternal Promise.
			client!.run()

			// Issue some methods that go through HTTP / send paths to land more
			// in-flight JsFutures.
			void client!.getMediaConn?.(true).catch(() => undefined)
			void client!.fetchBlocklist?.().catch(() => undefined)

			// Tiny yield so the spawn drain queue starts the run loop.
			await delay(20)

			// Ungraceful free — this is the FinalizationRegistry path.
			client!.free()

			// Drain queued microtasks / macrotasks; any straggler closure that
			// the Drop didn't abort would surface here as OOB.
			await delay(100)

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`SMOKE-1 round ${r} hit WASM OOB:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('SMOKE-2: 4 clients alive at once, free() in interleaved order (multi-bot analogue)', async () => {
		initWasmEngine()

		const N = 4
		const clients: WasmWhatsAppClient[] = []
		for (let i = 0; i < N; i++) {
			const c = await createWhatsAppClient(makeStuckTransport(), makeStuckHttp(), null, makeFastStore())
			c.run()
			void c.getMediaConn?.(true).catch(() => undefined)
			clients.push(c)
		}

		await delay(50)

		// Free in arbitrary order (mirrors a bot manager replacing entries
		// out-of-order under load). The shared WASM heap must survive every
		// permutation.
		for (const client of [clients[2]!, clients[0]!, clients[3]!, clients[1]!]) {
			client.free()
			await delay(30)
			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`SMOKE-2 hit WASM OOB during interleaved free:${dumpCrashes()}`)
			}
		}

		// Allocate a new client AFTER all the frees — same path that crashed
		// pre-fix at `__wbg_new_typed_…`.
		const after = await createWhatsAppClient(makeStuckTransport(), makeStuckHttp(), null, makeFastStore())
		after.run()
		await delay(50)
		after.free()
		await delay(100)

		if (captured.some(c => isWasmOobCrash(c.err))) {
			throw new Error(`SMOKE-2 post-recreation hit WASM OOB:${dumpCrashes()}`)
		}
		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('SMOKE-3: GC-triggered free via FinalizationRegistry (no explicit .free())', async () => {
		const gc = (globalThis as { gc?: () => void }).gc
		if (!gc) {
			// Test only meaningful with --expose-gc; treat absence as skip.
			return
		}

		initWasmEngine()

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

			await delay(20)

			// Drop the only reference. FinalizationRegistry should fire on next GC,
			// invoking `__wbg_wasmwhatsappclient_free` — same path as the production
			// crash where user code lost the sock reference.
			client = undefined

			for (let g = 0; g < 5; g++) {
				gc()
				await delay(50)
			}

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`SMOKE-3 round ${r} hit WASM OOB after GC:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})
})
