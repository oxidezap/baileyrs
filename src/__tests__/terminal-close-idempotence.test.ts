/**
 * Terminal-close idempotence through the dispatcher + reporter composition.
 *
 * The wiring mirrors `src/Socket/index.ts`: the dispatcher learns about the
 * close and hands publishing to the reporter via `onTerminalClose`, which
 * claims `reportAfter` with the socket teardown. These tests prove the
 * duplicate-close failure and its fix at that composition — but they are NOT
 * full socket tests: teardowns are gates, `logout()` is simulated by calling
 * the same `reportNow` fallback the socket calls, and no bridge client ever
 * exists. Full-socket coverage (real `end()`/`logout()` through the owner)
 * lives in `socket-dispose-integration.test.ts`.
 *
 * The unit of idempotence is one reporter lifetime — one socket. A socket
 * never gets a second generation (a terminal close means "build a new
 * socket"), so any second terminal signal for the same socket must not
 * publish again: not a duplicate dispatch, not a logout racing the
 * dispatcher, not a late event after the first publish settled.
 *
 * Timing is barrier-based, never wall-clock: the first claim's teardown waits
 * on a gate the test releases, and `flush()` drains the microtask/macrotask
 * queue so an un-gated duplicate publish would already have happened. Each
 * suppression test below fails against the old per-claim implementation.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import { makeEventHandlers } from '../Socket/events.ts'
import { makeTerminalCloseReporter } from '../Socket/terminal-close-reporter.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { ConnectionState } from '../Types/index.ts'
import { expect } from './expect.ts'

const noopLogger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return noopLogger
	}
}

/**
 * Drain pending microtasks and macrotask callbacks without sleeping: any
 * teardown that was never gated has resolved by the time this returns, so an
 * assertion on "nothing published yet" is deterministic.
 */
const flush = async () => {
	await new Promise<void>(resolve => setImmediate(resolve))
	await new Promise<void>(resolve => setImmediate(resolve))
}

interface Harness {
	ev: EventEmitter
	onEvent: (event: never) => void
	reporter: ReturnType<typeof makeTerminalCloseReporter>
	closes: Array<Partial<ConnectionState>>
	teardowns: number
	releaseTeardown: () => void
}

const makeHarness = (): Harness => {
	const ev = new EventEmitter()
	const ctx = {
		ev,
		logger: noopLogger,
		fullConfig: {},
		ws: new EventEmitter(),
		getUser: () => undefined,
		getMe: () => undefined,
		setUser: () => {},
		reportUnexpectedError: () => {},
		getClient: () => Promise.reject(new Error('not used')),
		getClientSync: () => {
			throw new Error('not used')
		}
	} as unknown as SocketContext
	let releaseTeardown!: () => void
	const teardownGate = new Promise<void>(resolve => {
		releaseTeardown = resolve
	})
	const harness = {} as Harness
	harness.ev = ev
	harness.closes = []
	harness.teardowns = 0
	harness.releaseTeardown = () => releaseTeardown()
	harness.reporter = makeTerminalCloseReporter({ logger: noopLogger as never, publishTimeoutMs: 1000 })
	ev.on('connection.update', (update: Partial<ConnectionState>) => {
		if (update.connection === 'close') harness.closes.push(update)
	})
	const handlers = makeEventHandlers(ctx, {
		onTerminalClose: (_error, publish) => {
			harness.reporter.reportAfter(async () => {
				// Runs synchronously up to the gate, so the count is exact
				// the moment `onEvent` returns — no flush needed to observe it.
				harness.teardowns++
				await teardownGate
			}, publish)
		}
	})
	harness.onEvent = handlers.onEvent as Harness['onEvent']
	return harness
}

const loggedOut = { type: 'logged_out', data: { reason: 'LoggedOut' } } as never
const streamReplaced = { type: 'stream_replaced' } as never

describe('terminal close idempotence: dispatcher + reporter', () => {
	it('two sequential terminal events publish exactly one close', async () => {
		const h = makeHarness()

		h.onEvent(loggedOut)
		h.onEvent(streamReplaced)
		// The second claim must not even start its teardown, let alone publish.
		expect(h.teardowns).toBe(1)

		await flush()
		expect(h.closes.length).toBe(0)

		h.releaseTeardown()
		await h.reporter.published()

		expect(h.closes.length).toBe(1)
		expect(h.teardowns).toBe(1)
	})

	it('a duplicate of the same terminal event publishes once', async () => {
		const h = makeHarness()

		h.onEvent(loggedOut)
		h.onEvent(loggedOut)
		expect(h.teardowns).toBe(1)

		h.releaseTeardown()
		await h.reporter.published()
		await flush()

		expect(h.closes.length).toBe(1)
	})

	it('a late terminal event after the first publish settled is ignored', async () => {
		const h = makeHarness()

		h.onEvent(loggedOut)
		h.releaseTeardown()
		await h.reporter.published()
		expect(h.closes.length).toBe(1)

		h.onEvent(streamReplaced)
		expect(h.teardowns).toBe(1)
		await flush()

		expect(h.closes.length).toBe(1)
	})

	it('a reportNow fallback racing an in-flight reportAfter publishes nothing extra', async () => {
		// Reporter-level simulation of the socket's `logout()` fallback: the
		// bridge already dispatched `LoggedOut` (claim one, teardown gated),
		// then the fallback's `reportNow` lands before teardown settles. It
		// must be absorbed into the in-flight claim, not published alongside.
		const h = makeHarness()

		h.onEvent(loggedOut)
		h.reporter.reportNow(() => {
			h.ev.emit('connection.update', { connection: 'close' } as Partial<ConnectionState>)
		})
		await flush()
		expect(h.closes.length).toBe(0)

		h.releaseTeardown()
		await h.reporter.published()
		await flush()

		expect(h.closes.length).toBe(1)
	})

	it('reportNow as the first claim publishes the one close', async () => {
		// Reporter-level simulation of the no-live-client logout fallback:
		// nothing dispatched, so the fallback is the first and only claim.
		// (Whether a real `sock.logout()` reaches this path is covered by
		// the socket-dispose integration tests, not here.)
		const h = makeHarness()

		expect(h.reporter.hasReported()).toBe(false)
		h.reporter.reportNow(() => {
			h.ev.emit('connection.update', { connection: 'close' } as Partial<ConnectionState>)
		})
		await h.reporter.published()

		expect(h.closes.length).toBe(1)
		expect(h.reporter.hasReported()).toBe(true)
	})

	it('a transient drop claims nothing, so the terminal close that follows is still the first', async () => {
		const h = makeHarness()
		const connections: Array<string | undefined> = []
		h.ev.on('connection.update', (update: Partial<ConnectionState>) => {
			connections.push(update.connection)
		})

		h.onEvent({ type: 'disconnected' } as never)
		expect(h.reporter.hasReported()).toBe(false)
		expect(h.closes.length).toBe(0)
		expect(connections).toEqual(['connecting'])

		h.onEvent(loggedOut)
		h.releaseTeardown()
		await h.reporter.published()

		expect(h.closes.length).toBe(1)
	})

	it('an ignored duplicate never touches the logger, even a throwing one', async () => {
		// The duplicate path must be side-effect-free: no teardown, no
		// publish, no log call a hostile logger could turn into a throw.
		const throwingLogger = {
			trace(): never {
				throw new Error('logger threw')
			},
			debug(): never {
				throw new Error('logger threw')
			},
			info(): never {
				throw new Error('logger threw')
			},
			warn(): never {
				throw new Error('logger threw')
			},
			error(): never {
				throw new Error('logger threw')
			},
			child() {
				return throwingLogger
			}
		} as never
		const reporter = makeTerminalCloseReporter({ logger: throwingLogger, publishTimeoutMs: 1000 })
		let publishes = 0

		reporter.reportAfter(
			async () => {},
			() => {
				publishes++
			}
		)
		reporter.reportAfter(
			async () => {},
			() => {
				publishes++
			}
		)
		reporter.reportNow(() => {
			publishes++
		})
		await reporter.published()

		expect(publishes).toBe(1)
	})
})
