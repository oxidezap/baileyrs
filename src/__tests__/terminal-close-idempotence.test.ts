/**
 * Terminal-close idempotence through the real composition: the dispatcher
 * learns about the close and hands publishing to the reporter, the way
 * `src/Socket/index.ts` wires `onTerminalClose` to
 * `terminalClose.reportAfter(() => owner.close(error)..., publish)`.
 *
 * The unit of idempotence is one reporter lifetime — one socket. A socket
 * never gets a second generation (a terminal close means "build a new
 * socket"), so any second terminal signal for the same socket must not
 * publish again: not a duplicate dispatch, not a logout racing the
 * dispatcher, not a late event after the first publish settled.
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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface Harness {
	ev: EventEmitter
	onEvent: (event: never) => void
	reporter: ReturnType<typeof makeTerminalCloseReporter>
	closes: Array<Partial<ConnectionState>>
	teardowns: number
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
	const harness = {} as Harness
	harness.ev = ev
	harness.closes = []
	harness.teardowns = 0
	harness.reporter = makeTerminalCloseReporter({ logger: noopLogger as never, publishTimeoutMs: 1000 })
	ev.on('connection.update', (update: Partial<ConnectionState>) => {
		if (update.connection === 'close') harness.closes.push(update)
	})
	const handlers = makeEventHandlers(ctx, {
		onTerminalClose: (_error, publish) => {
			harness.reporter.reportAfter(async () => {
				harness.teardowns++
			}, publish)
		}
	})
	harness.onEvent = handlers.onEvent as Harness['onEvent']
	return harness
}

describe('terminal close idempotence: dispatcher + reporter', () => {
	it('two sequential terminal events publish exactly one close', async () => {
		const h = makeHarness()

		h.onEvent({ type: 'logged_out', data: { reason: 'LoggedOut' } } as never)
		h.onEvent({ type: 'stream_replaced' } as never)
		await h.reporter.published()
		await wait(20)

		expect(h.closes.length).toBe(1)
		expect(h.teardowns).toBe(1)
	})

	it('a duplicate of the same terminal event publishes once', async () => {
		const h = makeHarness()

		h.onEvent({ type: 'logged_out', data: { reason: 'LoggedOut' } } as never)
		h.onEvent({ type: 'logged_out', data: { reason: 'LoggedOut' } } as never)
		await h.reporter.published()
		await wait(20)

		expect(h.closes.length).toBe(1)
	})

	it('a late terminal event after the first publish settled is ignored', async () => {
		const h = makeHarness()

		h.onEvent({ type: 'logged_out', data: { reason: 'LoggedOut' } } as never)
		await h.reporter.published()
		h.onEvent({ type: 'stream_replaced' } as never)
		await h.reporter.published()
		await wait(20)

		expect(h.closes.length).toBe(1)
	})

	it('logout fallback after a dispatcher close does not add a second close', async () => {
		// `logout()` with a live client: the bridge dispatches `LoggedOut`
		// (claimed), then the fallback rechecks `hasReported()` — and even if
		// that recheck raced, `reportNow` itself is a no-op past the claim.
		const h = makeHarness()

		h.onEvent({ type: 'logged_out', data: { reason: 'LoggedOut' } } as never)
		h.reporter.reportNow(() => {
			h.ev.emit('connection.update', { connection: 'close' } as Partial<ConnectionState>)
		})
		await h.reporter.published()
		await wait(20)

		expect(h.closes.length).toBe(1)
	})

	it('logout with no live client still reports its one close', async () => {
		// No dispatcher claim at all: the fallback is the first and only one.
		const h = makeHarness()

		h.reporter.reportNow(() => {
			h.ev.emit('connection.update', { connection: 'close' } as Partial<ConnectionState>)
		})
		await h.reporter.published()

		expect(h.closes.length).toBe(1)
		expect(h.reporter.hasReported()).toBe(true)
	})

	it('a transient drop keeps reporting connecting and never claims the close', async () => {
		const h = makeHarness()
		const connections: Array<string | undefined> = []
		h.ev.on('connection.update', (update: Partial<ConnectionState>) => {
			connections.push(update.connection)
		})

		h.onEvent({ type: 'disconnected' } as never)

		expect(h.reporter.hasReported()).toBe(false)
		expect(h.closes.length).toBe(0)
		expect(connections).toEqual(['connecting'])
	})

	it('end without a terminal event claims nothing, so a later logout still closes once', async () => {
		// A plain `end()` reports nothing through the reporter. The logout
		// fallback that follows is therefore the first claim, not a duplicate.
		const h = makeHarness()

		expect(h.reporter.hasReported()).toBe(false)
		h.reporter.reportNow(() => {
			h.ev.emit('connection.update', { connection: 'close' } as Partial<ConnectionState>)
		})
		await h.reporter.published()

		expect(h.closes.length).toBe(1)
	})
})
