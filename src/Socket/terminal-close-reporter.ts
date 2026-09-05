/**
 * Reports the terminal `connection.update { close }` — exactly once, after
 * teardown, and never silently not at all.
 *
 * That sentence is the whole contract this branch sells, and getting it wrong
 * has two opposite failure modes, both bad:
 *
 *  - **Not reported.** The consumer's handler never runs, so it never builds a
 *    replacement socket. A bot offline with nothing in its logs — the original
 *    bug this branch exists to fix.
 *  - **Reported early, or twice.** The replacement socket overlaps the old
 *    one's auth-store flush and `free()`, or every listener sees two terminal
 *    notifications for one socket and a handler that cleans up on close loops.
 *
 * Keeping both away used to be inline logic split across the dispatcher hook
 * and `logout()`, sharing a counter and a promise. Nine separate bugs came out
 * of that in review — a publish that could never run, a throwing listener
 * taking the process down, `logout()` resolving before the close it caused,
 * the watchdog not releasing its waiters, a suppression check that also
 * matched non-terminal teardown, a fallback that did not count itself. Every
 * one was a different way of answering the same question, so it is one object
 * now, with the answer in one place.
 */

import type { ILogger } from '../Utils/logger.ts'

/**
 * How long teardown may run before the close is reported anyway.
 *
 * A deliberate trade of one guarantee for the other: past this point the close
 * goes out with teardown still running, because losing the event entirely is
 * the worse of the two failures. Teardown takes milliseconds in practice, so
 * reaching this means a consumer end handler or a store flush never settled —
 * and the error logged alongside says exactly that. Generous rather than
 * tight, since firing early is the harmful direction.
 */
export const TERMINAL_CLOSE_PUBLISH_TIMEOUT_MS = 60_000

export interface TerminalCloseReporter {
	/**
	 * Run `teardown`, then publish. Used by the dispatcher, which learns about
	 * the close first and hands over the publishing so the socket can finish
	 * releasing its resources before a consumer can react.
	 *
	 * Never rejects and never leaves `publish` uncalled: teardown failures are
	 * logged, a throwing listener is contained, and a teardown that hangs is
	 * cut short by the watchdog.
	 *
	 * Idempotent per socket: the first claim wins and every later call is a
	 * no-op. A socket never gets a second generation — a terminal close means
	 * "build a new socket" — so a second terminal event (a logout racing a
	 * dispatcher close, a late duplicate dispatch) must not publish again.
	 */
	reportAfter: (teardown: () => Promise<void>, publish: () => void) => void
	/**
	 * Publish immediately, for a close nothing else will announce — a `logout()`
	 * with no live client, or one whose `logout()` threw before the bridge
	 * dispatched anything.
	 *
	 * Part of the same single claim as `reportAfter`: a no-op when a close
	 * was already claimed.
	 */
	reportNow: (publish: () => void) => void
	/**
	 * Whether a terminal close has been *claimed* — reported, or reported-and-
	 * still-tearing-down. Not "published": `reportAfter` publishes only once
	 * teardown finishes, so a check keyed on delivery would see `false` right
	 * after the bridge announced the logout and let `logout()` add a second
	 * close of its own.
	 *
	 * `logout()` uses this rather than "is the socket closing", which is also
	 * true for a plain `end()` — and those report nothing, so keying off them
	 * would let a logout racing one finish with no close at all.
	 */
	hasReported: () => boolean
	/**
	 * Settles once the single report has been published — the moment the
	 * consumer sees it, not the moment teardown finishes, so a waiter is not
	 * left hanging when the watchdog is what released the event.
	 *
	 * Resolves immediately when nothing has been reported. Every waiter
	 * observes the same promise, so concurrent `logout()` and dispatcher
	 * paths cannot split across generations.
	 */
	published: () => Promise<void>
}

export const makeTerminalCloseReporter = (opts: {
	logger: ILogger
	/** Overridable for tests; production uses the constant above. */
	publishTimeoutMs?: number
}): TerminalCloseReporter => {
	const { logger } = opts
	const publishTimeoutMs = opts.publishTimeoutMs ?? TERMINAL_CLOSE_PUBLISH_TIMEOUT_MS

	/**
	 * Claims, not deliveries — see `hasReported`. At most one: a socket has a
	 * single terminal generation, so the first claim wins and later ones are
	 * ignored rather than published.
	 */
	let claimed = 0
	let publishedPromise: Promise<void> | undefined

	/** True once the single terminal generation has been claimed. */
	const claim = (): boolean => {
		if (claimed > 0) {
			logger.debug('terminal close already claimed; ignoring a duplicate terminal signal')
			return false
		}
		claimed++
		return true
	}

	/** One publish per claim, whatever gets there first, and never throwing. */
	const makeOnce = (publish: () => void, settle: () => void) => {
		let done = false
		return () => {
			if (done) return
			done = true
			try {
				publish()
			} catch (err) {
				// `publish` emits on the consumer's bus. Letting this escape
				// would surface as an unhandled rejection on a detached chain —
				// process exit under Node's default handler.
				logger.error({ err }, 'connection.update listener threw on the terminal close')
			}
			settle()
		}
	}

	return {
		reportAfter: (teardown, publish) => {
			if (!claim()) return
			let settle!: () => void
			publishedPromise = new Promise<void>(resolve => {
				settle = resolve
			})
			const publishOnce = makeOnce(publish, settle)

			// Deliberately referenced: a pending promise does not keep Node's
			// event loop alive, so an unref'd timer lets a minimal bot exit
			// before it can publish — and the close handler that would have
			// built the replacement never runs, which is what this guards.
			// Cleared the moment teardown settles, so it holds the loop only
			// while one is in flight.
			const watchdog = setTimeout(() => {
				logger.error({ afterMs: publishTimeoutMs }, 'socket teardown is still running; reporting the close anyway')
				publishOnce()
			}, publishTimeoutMs)

			const finish = (err?: unknown) => {
				clearTimeout(watchdog)
				if (err) logger.error({ err }, 'socket teardown failed after a terminal disconnect')
				publishOnce()
			}
			// `teardown()` is called inside the try because it can throw
			// *synchronously*, before returning a promise — `.then` would never
			// run and the close would stay unpublished until the watchdog, or
			// forever if the timer were ever removed. The no-silent-failure
			// promise has to hold for that path too.
			try {
				void teardown().then(() => finish(), finish)
			} catch (err) {
				finish(err)
			}
		},

		reportNow: publish => {
			if (!claim()) return
			let settle!: () => void
			publishedPromise = new Promise<void>(resolve => {
				settle = resolve
			})
			makeOnce(publish, settle)()
		},

		hasReported: () => claimed > 0,

		published: () => publishedPromise ?? Promise.resolve()
	}
}
