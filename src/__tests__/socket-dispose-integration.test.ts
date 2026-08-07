/**
 * Integration: disposing a socket really stops the bridge engine.
 *
 * No mock server needed. A bare TCP listener accepts each connection and drops
 * it, so the WebSocket handshake always fails and the Rust run loop sits in
 * its retry path — where it lives in production whenever the network is down.
 * Counting accepted connections is the observable: while the engine retries
 * the count climbs, and once the socket is disposed it must stop.
 *
 * Counting sockets rather than reading logs is deliberate: `initWasmEngine`
 * runs once per process, so the Rust-side logger belongs to whichever socket
 * was created first and later sockets in the same process log nothing.
 *
 * The bug this covers: `end()` fired before `init()` finished saw
 * `client === undefined` and freed nothing, while the in-flight `init()` went
 * on to create the client and call `run()`. The result was an ownerless
 * `WasmWhatsAppClient` reconnecting on the Fibonacci backoff forever, immune
 * to the `sock.end()` the caller had already awaited. Disposing right after
 * `makeWASocket()` lands squarely in that window.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import P from 'pino'

import makeWASocket from '../Socket/index.ts'
import { downloadHistory } from '../Utils/process-history-message.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { expect } from './expect.ts'

const silentLogger = P({ level: 'silent' })

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Disposable = { [Symbol.asyncDispose](): Promise<void> }
const dispose = (sock: unknown) => (sock as Disposable)[Symbol.asyncDispose]()

/** Accepts and immediately drops every connection, counting the attempts. */
const startConnectionCounter = async () => {
	const live = new Set<Socket>()
	let attempts = 0
	const server: Server = createServer(socket => {
		attempts++
		live.add(socket)
		socket.on('error', () => {})
		socket.on('close', () => live.delete(socket))
		socket.destroy()
	})
	server.on('error', () => {})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (typeof address === 'string' || address === null) throw new Error('expected a TCP address')

	return {
		url: `ws://127.0.0.1:${address.port}`,
		attempts: () => attempts,
		close: async () => {
			for (const socket of live) socket.destroy()
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	}
}

/** Resolves once the engine has retried `count` times, or throws on timeout. */
const waitForAttempts = async (attempts: () => number, count: number, timeoutMs = 15_000) => {
	const deadline = Date.now() + timeoutMs
	while (attempts() < count) {
		if (Date.now() > deadline) throw new Error(`only saw ${attempts()} connection attempts, wanted ${count}`)
		await wait(50)
	}
}

describe('makeWASocket: disposing stops the bridge run loop', { timeout: 120_000 }, () => {
	let authFolder: string

	before(async () => {
		authFolder = await mkdtemp(join(tmpdir(), 'baileyrs-dispose-'))
	})

	after(async () => {
		await rm(authFolder, { recursive: true, force: true })
	})

	it('exposes Symbol.asyncDispose so `await using` works', async () => {
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: counter.url })

			expect(typeof (sock as Record<symbol, unknown>)[Symbol.asyncDispose]).toBe('function')
			await dispose(sock)
		} finally {
			await counter.close()
		}
	})

	it('a mid-init end() still closes the transport and drains the auth store', async () => {
		// Both used to sit inside `if (client)`, so an `end()` landing before
		// `createWhatsAppClient()` resolved skipped them: `ws.readyState` stayed
		// at CONNECTING on a socket the caller had disposed, and whatever the
		// store had buffered was dropped.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			let flushes = 0
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (prop !== 'flush' || typeof value !== 'function') return value
					return (...args: unknown[]) => {
						flushes++
						return (value as (...a: unknown[]) => unknown).apply(target, args)
					}
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})
			await sock.end(undefined)

			// 3 === CLOSED on the upstream-compatible readyState ladder. Private
			// to `WebSocketClient`, but it is the observable a consumer reads
			// through the upstream `ws` surface.
			expect((sock.ws as unknown as { readyState: number }).readyState).toBe(3)
			expect(flushes > 0).toBe(true)
		} finally {
			await counter.close()
		}
	})

	it('end() runs the socket end handlers even when the auth store fails to flush', async () => {
		// `end()` rethrows the first flush failure. Running the consumer's
		// teardown hooks BEFORE that rethrow is deliberate: a corrupt-on-shutdown
		// store is exactly when they most need to run.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (prop !== 'flush' || typeof value !== 'function') return value
					return () => Promise.reject(new Error('flush exploded'))
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})
			let handlerRan = false
			sock.registerSocketEndHandler(() => {
				handlerRan = true
			})

			let thrown: unknown
			try {
				await sock.end(undefined)
			} catch (err) {
				thrown = err
			}

			expect((thrown as Error | undefined)?.message).toBe('flush exploded')
			expect(handlerRan).toBe(true)
		} finally {
			await counter.close()
		}
	})

	it('the disposer waits for initialization even when end() rejects', async () => {
		// `end()` rethrows a flush failure, and letting that propagate straight
		// out would skip `await initPromise` — resolving the disposer with
		// `init()` still in flight, in exactly the situation where cleanup has
		// already gone wrong. Hence the try/finally.
		//
		// Timed rather than counted: the wasm client's own `Drop` schedules a
		// detached disconnect that touches the store on its own schedule, so
		// counting post-dispose store calls is inherently racy. Slowing the
		// store down instead makes `init()` take a known, long time, and the
		// only way for the disposer to beat it is to not have waited.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const INIT_DELAY_MS = 1200
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (typeof value !== 'function') return value
					if (prop === 'flush') return () => Promise.reject(new Error('flush exploded'))
					return async (...args: unknown[]) => {
						await wait(INIT_DELAY_MS)
						return (value as (...a: unknown[]) => unknown).apply(target, args)
					}
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})

			const startedAt = Date.now()
			let rejected: unknown
			await dispose(sock).catch(err => {
				rejected = err
			})
			const elapsed = Date.now() - startedAt

			// The flush error still reaches the caller…
			expect((rejected as Error | undefined)?.message).toBe('flush exploded')
			// …and it did not short-circuit the wait for `init()`.
			expect(elapsed >= INIT_DELAY_MS).toBe(true)
		} finally {
			await counter.close()
		}
	})

	it('a second end() awaits the in-flight teardown instead of resolving early', async () => {
		// The socket now ends itself on a terminal close, so the consumer's own
		// `await sock.end()` is usually the SECOND call. Returning early on an
		// `ended` flag resolved it while the store flush was still running —
		// which is how `close` → `await sock.end()` → `makeWASocket()` ends up
		// with two writers on one auth folder.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			let flushDone = false
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (prop !== 'flush' || typeof value !== 'function') return value
					return async (...args: unknown[]) => {
						await wait(300)
						const result = await (value as (...a: unknown[]) => unknown).apply(target, args)
						flushDone = true
						return result
					}
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})

			// First call detached, the way `onTerminalClose` fires it.
			void sock.end(undefined).catch(() => {})
			// Second call is the consumer's; it must join, not skip.
			await sock.end(undefined)

			expect(flushDone).toBe(true)
		} finally {
			await counter.close()
		}
	})

	it('logout() reports exactly one close even when the bridge never announces it', async () => {
		// Normally `Client::logout()` dispatches `LoggedOut` and the dispatcher
		// reports the close. When it cannot — no client yet, or `logout()` threw
		// before reaching the bridge — `logout()` has to report it itself.
		// Emitting unconditionally gave two closes; emitting never gave zero.
		// Upstream always gives exactly one.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: counter.url })

			let closes = 0
			sock.ev.on('connection.update', update => {
				if (update.connection === 'close') closes++
			})

			// No connection was ever established, so nothing will dispatch.
			await sock.logout().catch(() => {})
			await wait(500)

			expect(closes).toBe(1)
		} finally {
			await counter.close()
		}
	})

	it('flushes the auth store through its own object, keeping the receiver', async () => {
		// Collecting `store.flush` into an array and calling it bare drops the
		// receiver, so a store whose `flush()` touches `this` throws on
		// `undefined`. Teardown then records a flush failure and releases the
		// client anyway — auth writes silently unpersisted.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			let sawReceiver = false
			const store = {
				...(state.store as object),
				flush() {
					sawReceiver = this !== undefined
					return Promise.resolve()
				}
			} as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})
			await sock.end(undefined)

			expect(sawReceiver).toBe(true)
		} finally {
			await counter.close()
		}
	})

	it('logout() after a close has already been reported does not synthesize a second one', async () => {
		// A consumer that logs out from its own `close` handler finds no live
		// client, so nothing dispatches `LoggedOut` and the terminal-close count
		// cannot move. Treating that as "nobody announced it" gave every
		// listener two terminal notifications for one socket — and a handler
		// that logs out on close an asynchronous close/logout loop.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: counter.url })

			let closes = 0
			sock.ev.on('connection.update', update => {
				if (update.connection === 'close') closes++
			})

			// First logout reports the close…
			await sock.logout().catch(() => {})
			expect(closes).toBe(1)

			// …a second one, as a close handler would do, must stay silent.
			await sock.logout().catch(() => {})
			await wait(300)
			expect(closes).toBe(1)
		} finally {
			await counter.close()
		}
	})

	it('refuses socket operations once teardown owns the client', async () => {
		// `peek()` keeps returning the client through `closing` so teardown can
		// still close the transport with it — but handing it to an ordinary
		// call racing shutdown starts a bridge operation while that client is
		// being disconnected and freed, which is the heap-corruption hazard the
		// teardown ordering exists to avoid.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (prop !== 'flush' || typeof value !== 'function') return value
					// Hold teardown open so the racing call lands inside it.
					return async () => wait(400)
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})
			await wait(300)

			const ending = sock.end(undefined)
			// `sendNode` goes through `ctx.getClient()`.
			const message = await sock
				.sendNode({ tag: 'iq', attrs: {} })
				.then(() => '<resolved>')
				.catch((err: Error) => err.message)
			await ending

			expect(message).toContain('Connection Closed')
		} finally {
			await counter.close()
		}
	})

	it('refuses a call that was waiting on init when teardown starts', async () => {
		// The guard runs again after the `initPromise` await: a close landing
		// while startup was still going would otherwise hand the client to a
		// call that had been queued behind it.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (typeof value !== 'function' || prop === 'flush') return value
					// Slow startup so the call below is still queued behind it.
					return async (...args: unknown[]) => {
						await wait(250)
						return (value as (...a: unknown[]) => unknown).apply(target, args)
					}
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})

			// Queued behind init…
			const queued = sock
				.sendNode({ tag: 'iq', attrs: {} })
				.then(() => '<resolved>')
				.catch((err: Error) => err.message)
			// …and teardown starts before init finishes.
			const ending = sock.end(undefined).catch(() => {})

			expect(await queued).toContain('Connection Closed')
			await ending
		} finally {
			await counter.close()
		}
	})

	it('reports the logout close even when the auth store fails to flush', async () => {
		// `end()` rethrows the first flush failure, and the owner releases the
		// client regardless — so without publishing on that path listeners see
		// no terminal close at all for a socket that has definitely ended.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (prop !== 'flush' || typeof value !== 'function') return value
					return () => Promise.reject(new Error('flush exploded'))
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})
			let closes = 0
			sock.ev.on('connection.update', update => {
				if (update.connection === 'close') closes++
			})

			let thrown: unknown
			await sock.logout().catch(err => {
				thrown = err
			})

			// The flush failure still reaches the caller…
			expect((thrown as Error | undefined)?.message).toBe('flush exploded')
			// …and the close was not swallowed with it.
			expect(closes).toBe(1)
		} finally {
			await counter.close()
		}
	})

	it('an immediate dispose — before init settles — keeps the engine from reconnecting', async () => {
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: counter.url })
			// No await between creation and dispose: `init()` is still in flight.
			await dispose(sock)
			expect(sock.waClient).toBe(undefined)

			// The engine may already have one connect in flight; what must not
			// happen is a retry after it. The Fibonacci backoff starts at ~1s, so
			// 3s covers several attempts.
			const baseline = counter.attempts()
			await wait(3000)
			expect(counter.attempts()).toBe(baseline)
		} finally {
			await counter.close()
		}
	})

	it('the disposer resolves only after in-flight initialization has finished', async () => {
		// The async-disposal contract: once `await using` leaves scope, nothing
		// belonging to the socket is still running. `end()` alone cannot deliver
		// that — called mid-init it sees `client === undefined` and resolves
		// while `init()` is still constructing the bridge client and reading the
		// auth store. Counting store calls that land after the disposer resolved
		// is the observable, because `init()` drives the store on that path.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)

			let disposed = false
			let callsAfterDispose = 0
			const store = new Proxy(state.store as object, {
				get(target, prop, receiver) {
					const value = Reflect.get(target, prop, receiver)
					if (typeof value !== 'function') return value
					return (...args: unknown[]) => {
						if (disposed) callsAfterDispose++
						return (value as (...a: unknown[]) => unknown).apply(target, args)
					}
				}
			}) as typeof state.store

			const sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: counter.url
			})
			await dispose(sock)
			disposed = true

			// Generous enough for a disposer that resolved early to let `init()`
			// run on and touch the store behind the caller's back.
			await wait(2000)
			expect(callsAfterDispose).toBe(0)
		} finally {
			await counter.close()
		}
	})

	it('stops a run loop that was already retrying, and is idempotent', async () => {
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: counter.url })

			// Two attempts prove the engine is really in its retry loop, not just
			// making its first connect.
			await waitForAttempts(counter.attempts, 2)

			await dispose(sock)
			await dispose(sock) // second call: no-op, must not throw

			const baseline = counter.attempts()
			await wait(3000)
			expect(counter.attempts()).toBe(baseline)
		} finally {
			await counter.close()
		}
	})

	it('unregisters the freed client, so standalone helpers do not reach a null wasm pointer', async () => {
		// `end()` calls `c.free()`. The module-level pointer the standalone
		// helpers fall back on must not survive it: reaching through a freed
		// handle raises an opaque wasm-bindgen error instead of the actionable
		// "no bridge client available" Boom.
		const counter = await startConnectionCounter()
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: counter.url })

			// Wait for init to publish the client — that is what registers it.
			await waitForAttempts(counter.attempts, 1)
			await wait(200)
			expect(sock.waClient !== undefined).toBe(true)

			await dispose(sock)

			let message = '<no error>'
			try {
				await downloadHistory(
					{
						directPath: '/v/history',
						mediaKey: new Uint8Array(32),
						fileSha256: new Uint8Array(32),
						fileEncSha256: new Uint8Array(32),
						fileLength: 1
					},
					{}
				)
			} catch (err) {
				message = err instanceof Error ? err.message : String(err)
			}
			expect(message).toContain('no bridge client available')
		} finally {
			await counter.close()
		}
	})
})

/**
 * Two effects that are invisible in-process and only a child can observe:
 *
 *  - `created.free()` on the mid-init dispose path. Nothing in the parent says
 *    whether that client was freed, but an unfreed `WasmWhatsAppClient` keeps
 *    the wasm instance alive and the process cannot exit.
 *  - `await c.disconnect()` before `c.free()` in `end()`. Freeing with a bridge
 *    call still in flight corrupts the wasm heap: dlmalloc trips
 *    `assertion failed: psize <= size + max_overhead` and the process dies on
 *    `RuntimeError: unreachable`, thrown from a microtask no try/catch reaches.
 *
 * Both therefore assert the same thing — the child exits cleanly, on its own.
 */
const runChild = async (body: string, folder: string, url: string) => {
	const script = `
		import makeWASocket from ${JSON.stringify(join(import.meta.dirname, '../Socket/index.ts'))}
		import { useMultiFileAuthState } from ${JSON.stringify(join(import.meta.dirname, '../Utils/use-multi-file-auth-state.ts'))}
		import P from 'pino'
		const { state } = await useMultiFileAuthState(${JSON.stringify(folder)})
		const sock = makeWASocket({
			auth: state,
			logger: P({ level: 'silent' }),
			waWebSocketUrl: ${JSON.stringify(url)}
		})
		${body}
	`
	const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'ignore' })
	return new Promise<{ outcome: 'exited' | 'timeout'; code: number | null }>(resolve => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			resolve({ outcome: 'timeout', code: null })
		}, 25_000)
		// `close` rather than `exit`, so the child's pipes are drained before
		// the outcome is reported.
		child.on('close', code => {
			clearTimeout(timer)
			resolve({ outcome: 'exited', code })
		})
	})
}

describe('makeWASocket: teardown frees the client without corrupting the wasm heap', { timeout: 90_000 }, () => {
	let folder: string
	let counter: Awaited<ReturnType<typeof startConnectionCounter>>

	before(async () => {
		folder = await mkdtemp(join(tmpdir(), 'baileyrs-childexit-'))
		counter = await startConnectionCounter()
	})

	after(async () => {
		await rm(folder, { recursive: true, force: true })
		await counter.close()
	})

	it('a socket disposed mid-init lets the process exit', async () => {
		const result = await runChild('await sock[Symbol.asyncDispose]()', folder, counter.url)
		expect(result.outcome).toBe('exited')
		expect(result.code).toBe(0)
	})

	it('end() with a bridge call still in flight exits cleanly instead of corrupting the heap', async () => {
		// `fetchBlocklist()` is deliberately not awaited: it stays pending
		// inside wasm across the `end()`. Without `await c.disconnect()` before
		// `c.free()`, this child dies on the dlmalloc assertion.
		const result = await runChild(
			`
			await new Promise(r => setTimeout(r, 400))
			sock.fetchBlocklist().catch(() => {})
			await sock.end(undefined)
			await new Promise(r => setTimeout(r, 1500))
			`,
			folder,
			counter.url
		)
		expect(result.outcome).toBe('exited')
		expect(result.code).toBe(0)
	})

	it('logout() reports exactly one close and exits cleanly', async () => {
		// `Client::logout()` dispatches `LoggedOut` before awaiting its own
		// `disconnect()`, so the terminal-close path re-enters `end()` while
		// `await sock.logout()` is still running. Two hazards at once: a second
		// synthetic close, and `free()` racing the in-flight call.
		const result = await runChild(
			`
			await new Promise(r => setTimeout(r, 400))
			let closes = 0
			sock.ev.on('connection.update', u => { if (u.connection === 'close') closes++ })
			await sock.logout().catch(() => {})
			await new Promise(r => setTimeout(r, 1500))
			if (closes !== 1) {
				console.error('expected exactly one close, got ' + closes)
				process.exit(3)
			}
			`,
			folder,
			counter.url
		)
		expect(result.outcome).toBe('exited')
		expect(result.code).toBe(0)
	})
})
