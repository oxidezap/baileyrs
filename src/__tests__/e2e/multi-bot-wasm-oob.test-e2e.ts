/**
 * E2E reproducer: try to surface the production "RuntimeError: Out of bounds
 * memory access" crash inside whatsapp-rust-bridge's WASM closures.
 *
 * Production report (alpha.25): a single PM2 process running 4 bots crashed
 * with an uncaught WASM OOB at `__wasm_bindgen_func_elem_19310`, called from
 * `CU` → `Y` (the closure-factory `mJ` returns). The signature
 * `Fn(JsValue) -> Result<JsValue, JsValue>` is the canonical shape for
 * `Promise.then`/`JsFuture` continuations, so the suspect is a use-after-free
 * on a continuation that survives `client.free()` / `disconnect()`.
 *
 * This file does NOT assert anything except "the process did not crash".
 * Each test installs a `process.on('uncaughtException', …)` and surfaces the
 * captured error via the test runner. If any cycle hits the OOB, the test
 * fails with the WASM stack — exactly what we need to triangulate.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import P from 'pino'
import {
	type AuthenticationState,
	Boom,
	DisconnectReason,
	jidNormalizedUser,
	makeWASocket,
	useMultiFileAuthState
} from '../../index.ts'
import { expect } from '../expect.ts'
import { attachQrAutoresponder } from './qr-autoresponder.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

// ---------------------------------------------------------------------------
// Crash-trap: convert uncaught WASM errors into test failures
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

function dumpCrashes() {
	if (captured.length === 0) return ''
	return captured.map((c, i) => `\n[${i}] ${c.kind}: ${(c.err as Error)?.stack ?? String(c.err)}`).join('\n')
}

function isWasmOobCrash(err: unknown): boolean {
	const msg = (err as Error)?.message ?? String(err)
	const stack = (err as Error)?.stack ?? ''
	return /Out of bounds memory access/i.test(msg) || /__wasm_bindgen_func_elem/i.test(stack) || /RuntimeError/.test(msg)
}

// ---------------------------------------------------------------------------
// Scenario 1: many bots, tight lifecycle churn
// ---------------------------------------------------------------------------

describe('E2E reproducer: WASM OOB in whatsapp-rust-bridge', { timeout: 300_000 }, () => {
	test('S1: 4 bots in same process, simultaneous send + immediate end()', async () => {
		const N = 4
		const ROUNDS = 5

		for (let round = 0; round < ROUNDS; round++) {
			logger.info({ round }, 'S1 round start')

			const bots: TestClient[] = await Promise.all(
				Array.from({ length: N }, (_, i) =>
					createTestClient({ label: `s1-r${round}-b${i}`, folderPrefix: 'baileys-e2e-oob' })
				)
			)

			// Pair-wise sends so every bot has both outgoing and incoming traffic
			// in-flight at the moment we tear them down.
			const sends: Promise<unknown>[] = []
			for (let i = 0; i < N; i++) {
				for (let j = 0; j < N; j++) {
					if (i === j) continue
					sends.push(
						bots[i]!.sock.sendMessage(bots[j]!.jid, { text: `s1-r${round}-from${i}-to${j}` }).catch(err =>
							logger.warn({ err }, 'send failed')
						)
					)
				}
			}

			// Do NOT await sends — we want disconnect+free to race with in-flight
			// sendMessage / receipt / ack work. This is the closest analogue to a
			// production bot that's shutting down while uploads/sends are pending.
			void Promise.allSettled(sends)

			await Promise.all(bots.map(b => destroyTestClient(b)))

			// Give any deferred microtask / setImmediate from a dropped closure
			// a turn to surface — OOB shows up as an uncaughtException.
			await delay(500)

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`WASM OOB captured on round ${round}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S2: tight connect → send → disconnect cycles (no awaits between)', async () => {
		const CYCLES = 12

		for (let i = 0; i < CYCLES; i++) {
			const a = await createTestClient({ label: `s2-${i}-a`, folderPrefix: 'baileys-e2e-oob' })
			const b = await createTestClient({ label: `s2-${i}-b`, folderPrefix: 'baileys-e2e-oob' })

			// Fire a flurry then immediately end — do NOT await sendMessage. The
			// in-flight protobuf marshal happens in the WASM closure system, and
			// destroying the socket while it's mid-await is the canonical
			// use-after-free trigger.
			const sends: Promise<unknown>[] = []
			for (let k = 0; k < 6; k++) {
				sends.push(a.sock.sendMessage(b.jid, { text: `s2-${i}-${k}` }).catch(() => {}))
				sends.push(b.sock.sendMessage(a.jid, { text: `s2-${i}r-${k}` }).catch(() => {}))
			}
			void Promise.allSettled(sends)

			await Promise.all([destroyTestClient(a), destroyTestClient(b)])

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`WASM OOB captured on cycle ${i}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S4: slow async storage — store.set resolves after free() to simulate stale Promise', async () => {
		// Wrap the file store with a `set` that returns a Promise resolving on a
		// long timer. When the test calls `destroyTestClient()` mid-traffic, any
		// `set` from the bridge that landed seconds ago will resolve AFTER
		// `client.free()` — exactly the production race shape where a JsFuture
		// continuation fires on a freed Rust closure.

		const SOCKET_URL = process.env.SOCKET_URL ?? 'wss://127.0.0.1:8080/ws/chat'
		const baseLogger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

		async function createSlowStoreClient(label: string) {
			const folder = mkdtempSync(join(tmpdir(), `baileys-e2e-oob-slow-${label}-`))
			const { state } = await useMultiFileAuthState(folder)

			const origGet = state.store!.get.bind(state.store!)
			const origSet = state.store!.set.bind(state.store!)
			const origDelete = state.store!.delete.bind(state.store!)

			// Latency must be small enough that the initial sync still
			// completes inside the 30s connect window — the bridge times out
			// `MessageQueue` after ~20s of cumulative store latency. Random
			// 1–10ms is enough to land each `.then` continuation in a
			// macrotask, which is what we need.
			const slow: AuthenticationState['store'] = {
				get: async (store, key) => {
					const v = await origGet(store, key)
					await delay(Math.floor(Math.random() * 5))
					return v
				},
				set: async (store, key, value) => {
					await delay(Math.floor(Math.random() * 10) + 1)
					return origSet(store, key, value)
				},
				delete: async (store, key) => {
					await delay(Math.floor(Math.random() * 10) + 1)
					return origDelete(store, key)
				},
				flush: state.store!.flush
			}

			const sock = makeWASocket({
				auth: { store: slow },
				waWebSocketUrl: SOCKET_URL,
				logger: baseLogger.child({ user: label })
			})

			attachQrAutoresponder(sock, SOCKET_URL)

			const jid = await new Promise<string>((resolve, reject) => {
				const tid = setTimeout(() => reject(new Error(`${label}: connect timeout`)), 30_000)
				sock.ev.on('connection.update', u => {
					if (u.connection === 'open') {
						clearTimeout(tid)
						resolve(jidNormalizedUser(sock.user?.id))
					} else if (u.connection === 'close') {
						const reason = (u.lastDisconnect?.error as Boom)?.output?.statusCode
						if (reason === DisconnectReason.loggedOut) {
							clearTimeout(tid)
							reject(new Error(`${label}: Logged out`))
						}
					}
				})
			})

			return { sock, jid, folder }
		}

		const ROUNDS = 6
		for (let r = 0; r < ROUNDS; r++) {
			logger.info({ r }, 'S4 round')
			const a = await createSlowStoreClient(`s4-${r}-a`)
			const b = await createSlowStoreClient(`s4-${r}-b`)

			// Fire a flurry of cross-sends to land many `session`/`identity`
			// store.set calls in the bridge. Don't await — let them race with
			// the destroy below.
			const sends: Promise<unknown>[] = []
			for (let k = 0; k < 10; k++) {
				sends.push(a.sock.sendMessage(b.jid, { text: `s4-${r}-a-${k}` }).catch(() => {}))
				sends.push(b.sock.sendMessage(a.jid, { text: `s4-${r}-b-${k}` }).catch(() => {}))
			}
			void Promise.allSettled(sends)

			// Tear down IMMEDIATELY while sends + their pending store writes are
			// still going through the slow callback.
			await Promise.all(
				[a, b].map(async c => {
					try {
						c.sock.setAutoReconnect(false)
						await c.sock.end()
					} catch {
						/* ignore */
					}
					try {
						rmSync(c.folder, { recursive: true, force: true })
					} catch {
						/* ignore */
					}
				})
			)

			// Let the slow Promises that were queued land — they should hit any
			// freed continuation by now.
			await delay(800)

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`S4 WASM OOB on round ${r}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S5: reconnect() storm during in-flight sends + mediaconn fetches', async () => {
		// Theory: `client.reconnect()` drops the in-flight WS task tree. Tasks
		// awaiting JsFutures (HTTP responses, etc.) are cancelled — their
		// Closures drop on the Rust side, but the underlying JS Promises may
		// still resolve later. When they do, V8 invokes the `resolve` callback
		// (the `Y` closure) → `G.a` is now 0 → CU passes 0 to
		// __wasm_bindgen_func_elem_19310 → wasm derefs 0 → OOB.
		const N = 4
		const bots = await Promise.all(
			Array.from({ length: N }, (_, i) => createTestClient({ label: `s5-b${i}`, folderPrefix: 'baileys-e2e-oob-s5' }))
		)

		const stopAt = Date.now() + 30_000 // 30s sustained load

		// Background traffic: each bot fires sends + mediaconn fetches in a tight
		// loop. The mediaconn calls hit the bridge's HTTP client — JsFuture
		// territory.
		const trafficLoops = bots.map((bot, i) =>
			(async () => {
				let k = 0
				while (Date.now() < stopAt) {
					const peer = bots[(i + 1) % N]!
					bot.sock.sendMessage(peer.jid, { text: `s5-${i}-${k}` }).catch(() => {})
					Promise.resolve(bot.sock.waClient?.getMediaConn?.(true)).catch(() => {})
					k++
					await delay(20)
				}
			})()
		)

		// Reconnect storm: every 200ms each bot drops its in-flight WS and
		// reconnects. This cancels every pending operation in flight.
		const reconnectLoop = (async () => {
			while (Date.now() < stopAt) {
				await delay(200)
				await Promise.allSettled(bots.map(b => b.sock.waClient?.reconnect?.().catch(() => undefined)))
			}
		})()

		await Promise.allSettled([...trafficLoops, reconnectLoop])
		await delay(2000)
		await Promise.all(bots.map(b => destroyTestClient(b)))
		await delay(1000)

		if (captured.some(c => isWasmOobCrash(c.err))) {
			throw new Error(`S5 WASM OOB:${dumpCrashes()}`)
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S6: direct waClient.free() bypassing sock.end() (ungraceful free during traffic)', async () => {
		// Skip `sock.end()` entirely and call `waClient.free()` directly while
		// sends are in flight. This is the worst-case shutdown — no
		// `disconnect()`, no flush, no setImmediate barrier. Whatever JsFutures
		// the bridge was holding when `free()` lands get dropped *before* their
		// awaited Promises resolve.

		const ROUNDS = 6
		for (let r = 0; r < ROUNDS; r++) {
			const a = await createTestClient({ label: `s6-${r}-a`, folderPrefix: 'baileys-e2e-oob-s6' })
			const b = await createTestClient({ label: `s6-${r}-b`, folderPrefix: 'baileys-e2e-oob-s6' })

			const sends: Promise<unknown>[] = []
			for (let k = 0; k < 12; k++) {
				sends.push(a.sock.sendMessage(b.jid, { text: `s6-${r}-${k}` }).catch(() => {}))
				sends.push(b.sock.sendMessage(a.jid, { text: `s6-${r}r-${k}` }).catch(() => {}))
				sends.push(Promise.resolve(a.sock.waClient?.getMediaConn?.(true)).catch(() => undefined))
				sends.push(Promise.resolve(b.sock.waClient?.getMediaConn?.(true)).catch(() => undefined))
			}
			// Don't await — call free() while everything is mid-flight.
			void Promise.allSettled(sends)

			try {
				a.sock.waClient?.free?.()
			} catch {
				/* ignore */
			}
			try {
				b.sock.waClient?.free?.()
			} catch {
				/* ignore */
			}

			// Let pending Promises that were awaiting Rust JsFutures land.
			await delay(1500)

			try {
				rmSync(a.authFolder, { recursive: true, force: true })
				rmSync(b.authFolder, { recursive: true, force: true })
			} catch {
				/* ignore */
			}

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`S6 WASM OOB on round ${r}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S7: GRACEFUL sock.end() during heavy traffic + recreate (production-path)', async () => {
		// Same shape as S6 but uses baileyrs's `sock.end()` (which awaits
		// disconnect() before free()) instead of bare `waClient.free()`. This
		// is the production code path — if THIS crashes too, the disconnect()
		// barrier is insufficient.
		const ROUNDS = 6
		for (let r = 0; r < ROUNDS; r++) {
			const a = await createTestClient({ label: `s7-${r}-a`, folderPrefix: 'baileys-e2e-oob-s7' })
			const b = await createTestClient({ label: `s7-${r}-b`, folderPrefix: 'baileys-e2e-oob-s7' })

			const sends: Promise<unknown>[] = []
			for (let k = 0; k < 12; k++) {
				sends.push(a.sock.sendMessage(b.jid, { text: `s7-${r}-${k}` }).catch(() => {}))
				sends.push(b.sock.sendMessage(a.jid, { text: `s7-${r}r-${k}` }).catch(() => {}))
				sends.push(Promise.resolve(a.sock.waClient?.getMediaConn?.(true)).catch(() => undefined))
				sends.push(Promise.resolve(b.sock.waClient?.getMediaConn?.(true)).catch(() => undefined))
			}
			void Promise.allSettled(sends)

			// Production path: setAutoReconnect(false) + sock.end() (awaits disconnect → flushes → free)
			await Promise.all([destroyTestClient(a), destroyTestClient(b)])
			await delay(500)

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`S7 WASM OOB on round ${r}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S8: minimal repro — single bot, getMediaConn in flight, direct free()', async () => {
		// Strip S6 to the smallest case. Just `getMediaConn(true)` (which makes
		// an HTTP fetch through the bridge's JS HTTP client → JsFuture awaits)
		// then immediately call waClient.free(). Try a single bot pair, see if
		// it still corrupts heap for the next.
		const ROUNDS = 6
		for (let r = 0; r < ROUNDS; r++) {
			const a = await createTestClient({ label: `s8-${r}-a`, folderPrefix: 'baileys-e2e-oob-s8' })

			const inflight: Promise<unknown>[] = []
			for (let k = 0; k < 6; k++) {
				inflight.push(Promise.resolve(a.sock.waClient?.getMediaConn?.(true)).catch(() => undefined))
			}
			void Promise.allSettled(inflight)

			try {
				a.sock.waClient?.free?.()
			} catch {
				/* ignore */
			}
			await delay(1500)

			try {
				rmSync(a.authFolder, { recursive: true, force: true })
			} catch {
				/* ignore */
			}

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`S8 WASM OOB on round ${r}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S9: minimal repro — sends only, direct free() (no mediaconn)', async () => {
		const ROUNDS = 6
		for (let r = 0; r < ROUNDS; r++) {
			const a = await createTestClient({ label: `s9-${r}-a`, folderPrefix: 'baileys-e2e-oob-s9' })
			const b = await createTestClient({ label: `s9-${r}-b`, folderPrefix: 'baileys-e2e-oob-s9' })

			const sends: Promise<unknown>[] = []
			for (let k = 0; k < 12; k++) {
				sends.push(a.sock.sendMessage(b.jid, { text: `s9-${r}-${k}` }).catch(() => {}))
				sends.push(b.sock.sendMessage(a.jid, { text: `s9-${r}r-${k}` }).catch(() => {}))
			}
			void Promise.allSettled(sends)

			try {
				a.sock.waClient?.free?.()
				b.sock.waClient?.free?.()
			} catch {
				/* ignore */
			}
			await delay(1500)

			try {
				rmSync(a.authFolder, { recursive: true, force: true })
				rmSync(b.authFolder, { recursive: true, force: true })
			} catch {
				/* ignore */
			}

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`S9 WASM OOB on round ${r}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S10: 4-bot graceful production simulation, long duration + cross-traffic + reconnects', async () => {
		// Closest analogue to the production setup: 4 bots, continuous traffic,
		// periodic forced reconnects, eventually graceful sock.end(). Production
		// crashed in CU (a Promise.then continuation) — typical of a JsFuture
		// dropped during cancellation. Try to land it here.
		const N = 4
		const bots = await Promise.all(
			Array.from({ length: N }, (_, i) => createTestClient({ label: `s10-b${i}`, folderPrefix: 'baileys-e2e-oob-s10' }))
		)

		const stopAt = Date.now() + 60_000 // 60s sustained
		let totalSends = 0
		let totalRecons = 0

		const trafficLoops = bots.map((bot, i) =>
			(async () => {
				let k = 0
				while (Date.now() < stopAt) {
					const peer = bots[(i + 1) % N]!
					bot.sock.sendMessage(peer.jid, { text: `s10-${i}-${k}` }).catch(() => {})
					if (k % 3 === 0) {
						Promise.resolve(bot.sock.waClient?.getMediaConn?.(true)).catch(() => undefined)
					}
					totalSends++
					k++
					await delay(15)
				}
			})()
		)

		const reconnectLoop = (async () => {
			while (Date.now() < stopAt) {
				await delay(400 + Math.floor(Math.random() * 200))
				const idx = Math.floor(Math.random() * N)
				await bots[idx]!.sock.waClient?.reconnect?.().catch(() => undefined)
				totalRecons++
			}
		})()

		await Promise.allSettled([...trafficLoops, reconnectLoop])
		logger.info({ totalSends, totalRecons }, 'S10 traffic complete')
		await delay(2000)
		await Promise.all(bots.map(b => destroyTestClient(b)))
		await delay(2000)

		if (captured.some(c => isWasmOobCrash(c.err))) {
			throw new Error(`S10 WASM OOB:${dumpCrashes()}`)
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S11: GC-triggered free() — drop sock reference, force GC, expect FinalizationRegistry call', async () => {
		// The bridge installs `new FinalizationRegistry(Q => __wbg_wasmwhatsappclient_free(Q, 1))`
		// (see dist/index.js around col 33400). Any WasmWhatsAppClient that
		// loses all JS references gets `free()` called by the GC. If the user's
		// code drops a sock without calling sock.end(), the still-running
		// background `run()` task + in-flight JsFutures get torn down
		// ungracefully — same shape as S6.
		//
		// Need `--expose-gc` for global.gc(). Skip if not available.
		const gc = (globalThis as { gc?: () => void }).gc
		if (!gc) {
			// Skip silently; this scenario only meaningful with --expose-gc
			logger.warn('S11 needs --expose-gc; skipping')
			return
		}

		const ROUNDS = 6
		for (let r = 0; r < ROUNDS; r++) {
			let a: TestClient | undefined = await createTestClient({
				label: `s11-${r}-a`,
				folderPrefix: 'baileys-e2e-oob-s11'
			})
			let b: TestClient | undefined = await createTestClient({
				label: `s11-${r}-b`,
				folderPrefix: 'baileys-e2e-oob-s11'
			})

			// Kick off in-flight ops.
			for (let k = 0; k < 12; k++) {
				a!.sock.sendMessage(b!.jid, { text: `s11-${r}-${k}` }).catch(() => {})
				Promise.resolve(a!.sock.waClient?.getMediaConn?.(true)).catch(() => undefined)
			}

			// Drop all references to the sock (and thus the underlying WasmWhatsAppClient)
			// WITHOUT calling end(). Force GC to run the finalizer.
			const aFolder = a.authFolder
			const bFolder = b.authFolder
			a = undefined
			b = undefined

			// Several GC passes — finalizers sometimes need a second pass.
			for (let g = 0; g < 5; g++) {
				gc()
				await delay(100)
			}
			await delay(1500)

			try {
				rmSync(aFolder, { recursive: true, force: true })
				rmSync(bFolder, { recursive: true, force: true })
			} catch {
				/* ignore */
			}

			if (captured.some(c => isWasmOobCrash(c.err))) {
				throw new Error(`S11 WASM OOB on round ${r}:${dumpCrashes()}`)
			}
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})

	test('S3: parallel destroy of 4 bots in same process (no sock.end() ordering)', async () => {
		const N = 4
		const bots = await Promise.all(
			Array.from({ length: N }, (_, i) => createTestClient({ label: `s3-b${i}`, folderPrefix: 'baileys-e2e-oob' }))
		)

		const sends: Promise<unknown>[] = []
		for (let i = 0; i < N; i++) {
			for (let k = 0; k < 8; k++) {
				const peer = bots[(i + 1) % N]!
				sends.push(bots[i]!.sock.sendMessage(peer.jid, { text: `s3-${i}-${k}` }).catch(() => {}))
			}
		}

		// Do not await sends; tear down everything *in parallel*. If any bot's
		// disconnect triggers a callback into another bot's WASM state through
		// the shared instance, this is where it would show up.
		void Promise.allSettled(sends)
		await Promise.all(bots.map(b => destroyTestClient(b)))
		await delay(1000)

		if (captured.some(c => isWasmOobCrash(c.err))) {
			throw new Error(`WASM OOB captured in S3:${dumpCrashes()}`)
		}

		expect(captured.filter(c => isWasmOobCrash(c.err)).length).toBe(0)
	})
})
