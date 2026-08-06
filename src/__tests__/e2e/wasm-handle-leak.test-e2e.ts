/**
 * Regression guard: the bridge must not leak JS handles per operation.
 *
 * wasm-bindgen tracks every JS value the Rust side holds in a table. A handle
 * that is never released keeps its object alive for the whole process, and it
 * is invisible to allocation profiling because the object is live rather than
 * garbage. The failure mode we hit in production was exactly this shape: every
 * cancelled sleep (one per request that answers before its timeout) left the
 * timer's promise pending forever, and the promise kept its resolve/reject pair
 * alive. Thirty thousand messages left sixty thousand handles behind and the
 * heap grew by tens of megabytes with no leak visible in any profile.
 *
 * The check is a rate, not a total: a fixed number of long-lived handles is
 * normal (transport callbacks, the yield callback), so the test measures the
 * live count across two different workload sizes and asserts the slope is flat.
 *
 * Hermetic on purpose — the mock server is not involved. Every async callback
 * is a local stub, so what the test exercises is the bridge's own runtime:
 * connect attempts, their timeouts, and the client teardown that cancels them.
 *
 * Requires `--expose-gc` (the e2e script passes it) so finalization can be
 * forced; without it the run would report handles that are merely awaiting the
 * GC as if they had leaked.
 */

import { after, before, describe, test } from 'node:test'
import type { JsHttpClientConfig, JsStoreCallbacks, JsTransportCallbacks } from '@oxidezap/whatsapp-rust-bridge'
import { expect } from '../expect.ts'
import { type InstrumentedBridge, loadInstrumentedBridge } from './handle-probe.ts'

/** Handles per cycle above which we call it a leak. A correct build sits at
 * ~0; the cancelled-sleep regression sat at 2 per cancelled timer, so anything
 * at or above 1 is already a real leak and not measurement noise. */
const MAX_HANDLES_PER_CYCLE = 0.5
const WARMUP_CYCLES = 5
const SMALL_CYCLES = 10
const LARGE_CYCLES = 30

/** Transport that accepts the connection and then goes silent: the core keeps
 * waiting for the handshake, which is what arms (and later cancels) timers. */
function makeSilentTransport(): JsTransportCallbacks {
	return {
		connect: async () => undefined,
		send: async () => undefined,
		disconnect: async () => undefined
	}
}

/** Every stub must settle. A promise that never settles keeps the bridge's
 * `JsFuture` callbacks alive by definition, which would show up here as a leak
 * caused by the test rather than by the bridge. */
function makeFailingHttp(): JsHttpClientConfig {
	return { execute: async () => ({ statusCode: 503, body: new Uint8Array() }) }
}

function makeFastStore(): JsStoreCallbacks {
	return {
		get: async () => null,
		set: async () => undefined,
		delete: async () => undefined
	}
}

async function quiesce(ticks = 5): Promise<void> {
	for (let i = 0; i < ticks; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

/** Stubs that never succeed keep the core retrying, and the default engine logger
 * writes every attempt to the console. The counters are what this test reads, so
 * the run stays silent. */
function makeSilentLogger(): unknown {
	const sink = () => {}
	return { level: 'silent', trace: sink, debug: sink, info: sink, warn: sink, error: sink }
}

describe('bridge JS handles — leak guard (no mock server needed)', { timeout: 120_000 }, () => {
	let instrumented: InstrumentedBridge

	before(async () => {
		instrumented = await loadInstrumentedBridge()
		;(instrumented.bridge.initWasmEngine as (logger: unknown) => void)(makeSilentLogger())
	})

	after(() => instrumented?.cleanup())

	/** One create → run → teardown cycle, which arms and cancels the core's timers. */
	async function runCycles(count: number): Promise<void> {
		const createClient = instrumented.bridge.createWhatsAppClient as (
			transport: JsTransportCallbacks,
			http: JsHttpClientConfig,
			onEvent: null,
			store: JsStoreCallbacks
		) => Promise<{ run: () => void; free: () => void }>

		for (let i = 0; i < count; i++) {
			const client = await createClient(makeSilentTransport(), makeFailingHttp(), null, makeFastStore())
			client.run()
			await quiesce()
			client.free()
			await quiesce()
		}
	}

	test('live handle count does not grow with the number of cycles', async () => {
		await runCycles(WARMUP_CYCLES)
		await instrumented.settle()

		await runCycles(SMALL_CYCLES)
		await instrumented.settle(12)
		const afterSmall = instrumented.probe.live

		await runCycles(LARGE_CYCLES)
		await instrumented.settle(12)
		const afterLarge = instrumented.probe.live

		const perCycle = (afterLarge - afterSmall) / LARGE_CYCLES
		const detail =
			`live ${afterSmall} -> ${afterLarge} over ${LARGE_CYCLES} cycles ` +
			`(${perCycle.toFixed(2)}/cycle, made=${instrumented.probe.made}, ` +
			`freed=${instrumented.probe.freed}, finalized=${instrumented.probe.finalized})`

		console.error(`[handle-probe] ${detail}`)

		if (perCycle >= MAX_HANDLES_PER_CYCLE) {
			const stacks = instrumented.probe.liveStacks()
			const trace = stacks.length
				? `\n\nCreation stacks of live handles:\n${stacks.join('\n---\n')}`
				: '\n\nRe-run with HANDLE_PROBE_TRACE=1 to capture the creating stacks.'
			throw new Error(`bridge leaked JS handles: ${detail}${trace}`)
		}
		expect(perCycle).toBeLessThan(MAX_HANDLES_PER_CYCLE)
	})
})
