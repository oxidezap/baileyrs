/**
 * A `<stream:error code="429">` leaves the session unusable, and the consumer
 * has to be able to see that.
 *
 * The engine treats 429 differently from every other stream error it forwards.
 * `client/node_io.rs`:
 *
 * ```rust
 * "429" => {
 *     warn!("Got 429 stream error (rate limited). Will auto-reconnect with extended backoff.");
 *     self.is_logged_in.store(false, Ordering::Relaxed);
 *     self.auto_reconnect_errors.fetch_add(5, Ordering::Relaxed);
 *     self.backoff_reset_suppressed.store(true, Ordering::Relaxed);
 *     self.core.event_bus.dispatch(Event::StreamError(…));
 * }
 * ```
 *
 * That is a rejected session — `is_logged_in` cleared, five rungs added to the
 * Fibonacci ladder, and the reset that would undo them suppressed — dispatched
 * on purpose so an embedder can act, as the core's own comment says: "An
 * embedder has none [no human watching a UI], so report the rate limit through
 * `StreamError`."
 *
 * It arrived here and was dropped. Two things were wrong with that:
 *
 *  1. The socket kept reporting `open`. The transport is still up at that
 *     instant — 429 falls through the handler's `should_disconnect` block ("so
 *     the socket layer notices a real teardown without us forcing one") — so
 *     nothing else contradicted it until the server ended the stream, which is
 *     the one signal whose timing we do not control.
 *  2. The log said `the connection is preserved`, which is true for the
 *     catch-all branch this dispatcher was written for and false here.
 *
 * `connecting` is not a new state invented for this: it is the state this
 * library already defines for "the engine is restoring the connection", and it
 * is the state the very next server frame produces anyway. This publishes it at
 * the moment the engine already knows the session was rejected, instead of
 * waiting for the round trip that confirms it.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import { makeEventHandlers } from '../Socket/events.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { ConnectionState } from '../Types/index.ts'
import { expect } from './expect.ts'

type LogLine = { payload: Record<string, unknown>; message: string }

const makeCtx = () => {
	const ev = new EventEmitter()
	const ws = new EventEmitter()
	const warnings: LogLine[] = []
	const logger = {
		trace() {},
		debug() {},
		info() {},
		warn(payload: Record<string, unknown>, message: string) {
			warnings.push({ payload, message })
		},
		error() {},
		child() {
			return logger
		}
	}
	const ctx: SocketContext = {
		ev: ev as unknown as SocketContext['ev'],
		logger: logger as never,
		fullConfig: {} as never,
		ws,
		getUser: () => undefined,
		getMe: () => undefined,
		setUser: () => {},
		reportUnexpectedError: () => {},
		getClient: () => Promise.reject(new Error('not used')),
		getClientSync: () => {
			throw new Error('not used')
		}
	}
	return { ctx, ev, warnings }
}

const dispatchStreamError = (code: string) => {
	const { ctx, ev, warnings } = makeCtx()
	const updates: Partial<ConnectionState>[] = []
	const terminalCloses: Error[] = []

	ev.on('connection.update', (update: Partial<ConnectionState>) => updates.push(update))

	makeEventHandlers(ctx, {
		onTerminalClose: (error, publish) => {
			terminalCloses.push(error)
			publish()
		}
	}).onEvent?.({ type: 'stream_error', data: { code } } as never)

	return { updates, warnings, terminalCloses }
}

describe('stream error 429: a rate-limited session', () => {
	it('reports the session as no longer usable', () => {
		const { updates } = dispatchStreamError('429')

		expect(updates.length).toBe(1)
		expect(updates[0]?.connection).toBe('connecting')
	})

	it('is not a close: the engine keeps the socket and retries on its own', () => {
		const { updates, terminalCloses } = dispatchStreamError('429')

		expect(terminalCloses.length).toBe(0)
		expect(updates.some(update => update.connection === 'close')).toBe(false)
	})

	it('clears a QR the drop invalidated, like every other retry path', () => {
		const { updates } = dispatchStreamError('429')

		expect(updates[0]?.qr).toBe(undefined)
		expect(updates[0]?.receivedPendingNotifications).toBe(false)
	})

	it('does not tell the operator the connection was preserved', () => {
		const { warnings } = dispatchStreamError('429')

		expect(warnings.length).toBe(1)
		expect(warnings[0]?.message.includes('preserved')).toBe(false)
		expect(warnings[0]?.message.includes('rate limited')).toBe(true)
		expect(warnings[0]?.payload.code).toBe('429')
	})
})

describe('stream error: every other code is still silent', () => {
	// The catch-all branch the dispatcher was written for. The connection really
	// is preserved (an `<ack/>` the server is still owed) or recycled by the
	// engine itself (`<xml-not-well-formed>`, which sets `should_disconnect` and
	// therefore reaches the consumer as a `disconnected` event of its own).
	for (const code of ['', 'unknown', 'ack']) {
		it(`code ${code === '' ? '(none)' : code} touches no connection.update`, () => {
			const { updates, warnings } = dispatchStreamError(code)

			expect(updates.length).toBe(0)
			expect(warnings.length).toBe(1)
			expect(warnings[0]?.message.includes('preserved')).toBe(true)
		})
	}
})
