/**
 * The terminal-close contract, tested without a socket.
 *
 * Nine review-found bugs lived in this logic while it was inline across the
 * dispatcher hook and `logout()`. Each case below is one of them, and they are
 * plain unit tests now — no wasm, no mock server, no child process — because
 * the rule they check finally has one home.
 */

import { describe, it } from 'node:test'

import { makeTerminalCloseReporter } from '../Socket/terminal-close-reporter.ts'
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

const makeReporter = (publishTimeoutMs = 10_000) =>
	makeTerminalCloseReporter({ logger: noopLogger as never, publishTimeoutMs })

describe('terminal close: reportAfter', () => {
	it('publishes only once teardown has finished', async () => {
		// A consumer answering `close` with a replacement socket on the same
		// auth folder would otherwise overlap this one's store flush and free.
		const order: string[] = []
		const reporter = makeReporter()

		reporter.reportAfter(
			async () => {
				await wait(60)
				order.push('teardown')
			},
			() => order.push('publish')
		)
		await reporter.published()

		expect(order).toEqual(['teardown', 'publish'])
	})

	it('publishes even when teardown rejects', async () => {
		// `end()` rethrows the first auth-store flush failure. Losing the close
		// there leaves a socket that definitely ended with nobody told.
		let published = false
		const reporter = makeReporter()

		reporter.reportAfter(
			async () => {
				throw new Error('flush exploded')
			},
			() => {
				published = true
			}
		)
		await reporter.published()

		expect(published).toBe(true)
	})

	it('publishes anyway when teardown never settles', async () => {
		// The watchdog. Trading "after teardown" for "at all" is deliberate:
		// a close that never arrives is a bot offline with nothing in its logs.
		let published = false
		const reporter = makeReporter(50)

		reporter.reportAfter(
			() => new Promise<void>(() => {}),
			() => {
				published = true
			}
		)
		await reporter.published()

		expect(published).toBe(true)
	})

	it('publishes once, even if the watchdog and teardown both get there', async () => {
		let publishes = 0
		const reporter = makeReporter(30)

		reporter.reportAfter(
			async () => {
				await wait(60)
			},
			() => {
				publishes++
			}
		)
		await reporter.published()
		await wait(80)

		expect(publishes).toBe(1)
	})

	it('contains a throwing listener instead of letting it escape', async () => {
		// `publish` emits on the consumer's bus, from a detached chain — an
		// escaping throw is an unhandled rejection, i.e. process exit under
		// Node's default handler. Resolving is the assertion.
		const reporter = makeReporter()

		reporter.reportAfter(
			async () => {},
			() => {
				throw new Error('listener exploded')
			}
		)
		await reporter.published()
	})
})

describe('terminal close: hasReported', () => {
	it('is true as soon as a report is claimed, before it is published', () => {
		// `logout()` checks this right after the bridge dispatched `LoggedOut`,
		// while teardown is still running. Keying it on delivery would read
		// `false` there and add a second close of its own.
		const reporter = makeReporter()
		expect(reporter.hasReported()).toBe(false)

		reporter.reportAfter(
			async () => {
				await wait(60)
			},
			() => {}
		)

		expect(reporter.hasReported()).toBe(true)
	})

	it('is true after a direct report', () => {
		const reporter = makeReporter()
		reporter.reportNow(() => {})

		expect(reporter.hasReported()).toBe(true)
	})
})

describe('terminal close: published', () => {
	it('resolves immediately when nothing has been reported', async () => {
		// `logout()` awaits it unconditionally.
		await makeReporter().published()
	})

	it('releases waiters at the moment the close is reported, not when teardown ends', async () => {
		// The watchdog exists for a teardown that never settles, so a waiter
		// tied to the teardown would hang past a close the consumer already
		// received — which is how `await sock.logout()` used to deadlock.
		const reporter = makeReporter(40)
		let published = false

		reporter.reportAfter(
			() => new Promise<void>(() => {}),
			() => {
				published = true
			}
		)

		await reporter.published()
		expect(published).toBe(true)
	})

	it('tracks the most recent report', async () => {
		const reporter = makeReporter()
		const seen: string[] = []

		reporter.reportNow(() => seen.push('first'))
		await reporter.published()

		reporter.reportAfter(
			async () => {
				await wait(40)
			},
			() => seen.push('second')
		)
		await reporter.published()

		expect(seen).toEqual(['first', 'second'])
	})
})
