/**
 * E2E regression for the production `RuntimeError: Out of bounds memory
 * access` crash that hit alpha.25 + wasm-bindgen 0.2.120 with 4 bots in a
 * single PM2 process.
 *
 * Two scenarios:
 *
 *   **MULTI-BOT-GRACEFUL** — 4 bots in the same process, cross-traffic,
 *   `sock.end()` (graceful: awaits `disconnect()` before `free()`). This is
 *   the canonical production lifecycle. If this stays clean across rounds,
 *   user code that always calls `sock.end()` is safe.
 *
 *   **RECREATE-AFTER-TRAFFIC** — pair, send a flurry, end, immediately
 *   pair again. Stresses the inter-client drain in `create_whatsapp_client`
 *   that serializes new construction against the previous Drop's
 *   `spawn_local(disconnect)` cleanup.
 *
 * Earlier revisions of this file shipped a dozen more variations
 * (`S2`–`S11`) that fired chaotic patterns to triangulate the bug. They are
 * gone now — they were exploratory, not regression-worthy, and they
 * accumulated mock-server `CLOSE_WAIT`s that made the suite flaky in CI.
 * The two cases above cover the production-relevant lifecycle.
 */

import process from 'node:process'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'

// ---------------------------------------------------------------------------
// Crash trap — describe-level. Tests grab a `startIdx` in `beforeEach` and
// inspect entries from that point on, so late-firing async noise from a
// previous test doesn't surface as a new test's failure.
// ---------------------------------------------------------------------------

type Crash = { kind: 'uncaughtException' | 'unhandledRejection'; err: unknown }
const captured: Crash[] = []
const onUncaught = (err: unknown) => captured.push({ kind: 'uncaughtException', err })
const onRejection = (err: unknown) => captured.push({ kind: 'unhandledRejection', err })

let startIdx = 0

function isWasmOobCrash(err: unknown): boolean {
	const msg = (err as Error)?.message ?? String(err)
	const stack = (err as Error)?.stack ?? ''
	return /Out of bounds memory access/i.test(msg) || /__wasm_bindgen_func_elem/i.test(stack)
}

function currentCrashes(): Crash[] {
	return captured.slice(startIdx)
}

function dumpCrashes(): string {
	return currentCrashes()
		.map((c, i) => `\n[${i}] ${c.kind}: ${(c.err as Error)?.stack ?? String(c.err)}`)
		.join('\n')
}

/** Yield through enough setImmediate ticks for the bridge's spawn-local
 *  Drop cleanup to settle. Event-driven; no fixed wait. */
async function quiesce(ticks = 8): Promise<void> {
	for (let i = 0; i < ticks; i++) {
		await new Promise<void>(resolve => setImmediate(resolve))
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E regression: WASM OOB in whatsapp-rust-bridge', { timeout: 300_000 }, () => {
	before(() => {
		process.on('uncaughtException', onUncaught)
		process.on('unhandledRejection', onRejection)
	})

	after(() => {
		process.off('uncaughtException', onUncaught)
		process.off('unhandledRejection', onRejection)
	})

	beforeEach(() => {
		startIdx = captured.length
	})

	test('MULTI-BOT-GRACEFUL: 4 bots, cross-traffic, sock.end() teardown — 3 rounds', async () => {
		const N = 4
		const ROUNDS = 3

		for (let round = 0; round < ROUNDS; round++) {
			const bots: TestClient[] = await Promise.all(
				Array.from({ length: N }, (_, i) =>
					createTestClient({ label: `mbg-r${round}-b${i}`, folderPrefix: 'baileys-e2e-oob' })
				)
			)

			// Pair-wise sends so every bot has both outgoing and incoming
			// traffic in flight at teardown. AWAIT them all here — we're
			// testing the graceful path, not the abandoned-Promise race.
			const sends: Promise<unknown>[] = []
			for (let i = 0; i < N; i++) {
				for (let j = 0; j < N; j++) {
					if (i === j) continue
					sends.push(
						bots[i]!.sock.sendMessage(bots[j]!.jid, { text: `mbg-r${round}-from${i}-to${j}` }).catch(() => undefined)
					)
				}
			}
			await Promise.allSettled(sends)

			// Production lifecycle: setAutoReconnect(false) + sock.end() (the
			// destroyTestClient helper does both). Serial to avoid hammering
			// the mock server with parallel teardowns.
			for (const bot of bots) {
				await destroyTestClient(bot)
			}

			await quiesce()

			if (currentCrashes().some(c => isWasmOobCrash(c.err))) {
				throw new Error(`MULTI-BOT-GRACEFUL round ${round} hit WASM OOB:${dumpCrashes()}`)
			}
		}

		expect(currentCrashes().filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('RECREATE-AFTER-TRAFFIC: pair → flurry → end → re-pair (3 cycles)', async () => {
		const CYCLES = 3

		for (let i = 0; i < CYCLES; i++) {
			const a = await createTestClient({ label: `rec-${i}-a`, folderPrefix: 'baileys-e2e-oob' })
			const b = await createTestClient({ label: `rec-${i}-b`, folderPrefix: 'baileys-e2e-oob' })

			// Short flurry of cross-sends, awaited so the next teardown isn't
			// racing protobuf marshalling.
			const sends: Promise<unknown>[] = []
			for (let k = 0; k < 4; k++) {
				sends.push(a.sock.sendMessage(b.jid, { text: `rec-${i}-${k}` }).catch(() => undefined))
				sends.push(b.sock.sendMessage(a.jid, { text: `rec-${i}r-${k}` }).catch(() => undefined))
			}
			await Promise.allSettled(sends)

			// Serial teardown — destroyTestClient runs sock.end() which is
			// graceful. Recreate happens on the next iteration; that's the
			// window where `drain_drop_cleanups` inside the bridge runs.
			await destroyTestClient(a)
			await destroyTestClient(b)

			await quiesce()

			if (currentCrashes().some(c => isWasmOobCrash(c.err))) {
				throw new Error(`RECREATE-AFTER-TRAFFIC cycle ${i} hit WASM OOB:${dumpCrashes()}`)
			}
		}

		// Give one extra macrotask sweep for any straggler async work to
		// reach `currentCrashes()` before the final assert.
		await delay(50)

		expect(currentCrashes().filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})
})
