/**
 * `connection.update { close }` means one thing on this socket, the same thing
 * it means in upstream Baileys: this socket is finished, build a new one.
 *
 * That equivalence is what makes the canonical upstream handler safe here:
 *
 * ```ts
 * if (connection === 'close') {
 *   const shouldReconnect = statusCode !== DisconnectReason.loggedOut
 *   if (shouldReconnect) connectToWhatsApp()
 * }
 * ```
 *
 * Upstream has no auto-reconnect, so that handler assumes every `close` is
 * final. baileyrs runs an engine that reconnects on a Fibonacci backoff, so if
 * a transient drop surfaced as `close` the handler would build a second socket
 * while the engine was already restoring the first — two live sockets for one
 * connection. Transient drops therefore surface as `connecting`.
 *
 * The split mirrors `whatsapp-rust`: it clears `enable_auto_reconnect` and
 * exits its run loop on the terminal set below, and retries everything else.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import { makeEventHandler, makeEventHandlers } from '../Socket/events.ts'
import type { WithClientSocketContext as SocketContext } from '../Socket/types.ts'
import type { ConnectionState } from '../Types/index.ts'
import { DisconnectReason } from '../Types/index.ts'
import type { Boom } from '../Utils/boom.ts'
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

const makeCtx = () => {
	const ev = new EventEmitter()
	const ws = new EventEmitter()
	const ctx: SocketContext = {
		ev: ev as unknown as SocketContext['ev'],
		logger: noopLogger as never,
		fullConfig: {} as never,
		ws,
		getUser: () => undefined,
		getMe: () => undefined,
		setUser: () => {},
		reportUnexpectedError: () => {},
		withClient: () => Promise.reject(new Error('not used')),
		getClientSync: () => {
			throw new Error('not used')
		}
	}
	return { ctx, ev }
}

type BridgeEvent = { type: string; data?: unknown }

/**
 * Run a bridge event through the dispatcher and collect what it published.
 *
 * `trace` records `onTerminalClose` and each `connection.update` in the order
 * they actually happened — the ordering is the invariant the whole design
 * rests on, so it has to be observed, not assumed.
 */
const dispatch = (bridgeEvent: BridgeEvent, opts: { autoReconnect?: boolean } = {}) => {
	const { ctx, ev } = makeCtx()
	const updates: Partial<ConnectionState>[] = []
	const terminalCloses: Error[] = []
	const trace: string[] = []

	ev.on('connection.update', (update: Partial<ConnectionState>) => {
		updates.push(update)
		trace.push(update.connection ?? 'update')
	})

	makeEventHandlers(ctx, {
		onTerminalClose: (error, publish) => {
			terminalCloses.push(error)
			trace.push('end')
			// The socket wires this to `end(...).finally(publish)`; the test
			// stands in for a teardown that has already finished.
			publish()
		},
		isAutoReconnectEnabled: () => opts.autoReconnect ?? true
	}).onEvent?.(bridgeEvent as never)

	const close = updates.find(update => update.connection === 'close')
	return {
		updates,
		close,
		terminalCloses,
		trace,
		statusCode: (close?.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
	}
}

/**
 * Disconnects where `whatsapp-rust` stores `enable_auto_reconnect = false` and
 * exits its run loop. None recover without a new socket.
 */
const TERMINAL: Array<{ label: string; event: BridgeEvent; expected: number }> = [
	{
		label: 'logged out',
		event: { type: 'logged_out', data: { reason: 'LoggedOut' } },
		expected: DisconnectReason.loggedOut
	},
	{
		// `<stream:error conflict="replaced">` / code 409
		label: 'stream replaced: another session took the device',
		event: { type: 'stream_replaced' },
		expected: DisconnectReason.connectionReplaced
	},
	{
		// `<failure reason="405">`
		// The wire code, not `badSession` (500) — see the dispatcher.
		label: 'client outdated: the server rejected this build',
		event: { type: 'client_outdated' },
		expected: 405
	},
	{
		// `<failure reason="402">`
		label: 'temporary ban',
		event: { type: 'temporary_ban', data: { code: 101, expire: 1893456000 } },
		expected: DisconnectReason.forbidden
	},
	{
		// `should_reconnect()` is false for every reason below.
		label: 'connect failure 400 (Generic)',
		event: { type: 'connect_failure', data: { reason: 400, message: 'Generic' } },
		expected: DisconnectReason.connectionClosed
	},
	{
		label: 'connect failure 409 (BadUserAgent)',
		event: { type: 'connect_failure', data: { reason: 409, message: 'BadUserAgent' } },
		expected: DisconnectReason.connectionClosed
	},
	{
		label: 'connect failure 413 (CatExpired)',
		event: { type: 'connect_failure', data: { reason: 413, message: 'CatExpired' } },
		expected: DisconnectReason.connectionClosed
	},
	{
		// No reason at all: the engine reads it as `Unknown(0)`, which fails
		// `should_reconnect()`.
		label: 'connect failure with no reason',
		event: { type: 'connect_failure', data: {} },
		expected: DisconnectReason.connectionClosed
	}
]

/** Disconnects the engine recovers from on its own. */
const RETRYING: Array<{ label: string; event: BridgeEvent }> = [
	{
		// The engine dispatches `Disconnected` only for an unexpected loop exit;
		// terminal paths set `expected_disconnect`, which suppresses it.
		label: 'transport drop',
		event: { type: 'disconnected' }
	},
	{
		// `should_reconnect()` matches ServiceUnavailable…
		label: 'connect failure 503 (ServiceUnavailable)',
		event: { type: 'connect_failure', data: { reason: 503, message: 'ServiceUnavailable' } }
	},
	{
		// …and InternalServerError.
		label: 'connect failure 500 (InternalServerError)',
		event: { type: 'connect_failure', data: { reason: 500, message: 'InternalServerError' } }
	},
	{
		// Pairing failed; the engine keeps its loop and re-emits a QR. The
		// `connecting` update is what clears the spent QR from consumer state.
		label: 'pair error',
		event: { type: 'pair_error', data: { error: 'bad signature' } }
	}
]

/** Events that must not touch `connection.update` at all. */
const SILENT: Array<{ label: string; event: BridgeEvent }> = [
	{
		// The engine's catch-all `<stream:error>` branch — unknown code,
		// `<ack/>`, `<xml-not-well-formed>` — every one of which keeps or
		// deliberately recycles the connection. This used to report
		// `badSession`, the code bots use to wipe credentials and re-pair.
		//
		// Not every stream error is silent: `429` is a rejected session, not a
		// preserved connection, and reports `connecting`. See
		// `rate-limited-stream-error.test.ts`.
		label: 'stream error (connection preserved)',
		event: { type: 'stream_error', data: { code: 'unknown' } }
	}
]

describe('dispatcher cleanup', () => {
	it('hands back a cleanup the socket can run on any teardown', () => {
		// The history-sync pause timer outlives the event that armed it, and
		// only `emitClose` clears it — so `sock.end()` or an `await using` scope
		// exiting would leave it to fire `messaging-history.status: paused` from
		// a socket whose client is already freed. The socket registers this as
		// an end handler.
		const { ctx } = makeCtx()
		const cleanups: Array<() => void> = []

		makeEventHandlers(ctx, { onCleanup: cleanup => cleanups.push(cleanup) })

		expect(cleanups.length).toBe(1)
		// Idempotent and safe with nothing armed.
		cleanups[0]!()
		cleanups[0]!()
	})
})

describe('connection.update: terminal disconnects', () => {
	for (const { label, event, expected } of TERMINAL) {
		it(`${label} → close ${expected}, and the socket ends itself`, () => {
			const result = dispatch(event)

			expect(result.close?.connection).toBe('close')
			expect(result.statusCode).toBe(expected)
			// `onTerminalClose` is what frees the wasm client: `run()` returns
			// void, so the engine's loop exit is invisible from JS.
			expect(result.terminalCloses.length).toBe(1)
		})
	}
})

/**
 * `logged_out.reason` used to be `format!("{:?}")` on the core's
 * `ConnectFailureReason`, a `Debug` string, which is not a stable API: a
 * variant renamed upstream would have silently changed what a consumer reads,
 * with nothing here failing to build. Bridge 0.7.0 writes the spellings down
 * instead, keeping every value it already emitted.
 *
 * The events are synthetic, so this pins our half of that contract rather than
 * the bridge's: the dispatcher hands the reason through untouched, the close
 * message is exactly `Logged out: <reason>`, and the status code stays
 * `loggedOut` whatever the reason says. The list doubles as the record of which
 * values the bridge undertakes to emit. A change on the bridge side of the line
 * is caught by the bridge's own tests, which assert those spellings literally.
 */
const LOGGED_OUT_REASONS = [
	'Generic',
	'LoggedOut',
	'TempBanned',
	'AccountLocked',
	'UnknownLogout',
	'ClientOutdated',
	'BadUserAgent',
	'CatExpired',
	'CatInvalid',
	'NotFound',
	'ClientUnknown',
	'InternalServerError',
	'Experimental',
	'ServiceUnavailable',
	// The core's own fallback for a code it cannot name, carried through.
	'Unknown(499)'
]

describe('logged out: the reason reaches the consumer verbatim', () => {
	for (const reason of LOGGED_OUT_REASONS) {
		it(`${reason} → 'Logged out: ${reason}'`, () => {
			const result = dispatch({ type: 'logged_out', data: { reason } })

			expect((result.close?.lastDisconnect?.error as Boom | undefined)?.message).toBe(`Logged out: ${reason}`)
			expect(result.statusCode).toBe(DisconnectReason.loggedOut)
		})
	}

	it('no reason at all → plain "Logged out"', () => {
		const result = dispatch({ type: 'logged_out', data: {} })

		expect((result.close?.lastDisconnect?.error as Boom | undefined)?.message).toBe('Logged out')
		expect(result.statusCode).toBe(DisconnectReason.loggedOut)
	})
})

describe('connection.update: disconnects the engine retries', () => {
	for (const { label, event } of RETRYING) {
		it(`${label} → 'connecting', never 'close'`, () => {
			const result = dispatch(event)

			expect(result.close).toBe(undefined)
			expect(result.updates.map(update => update.connection)).toEqual(['connecting'])
			// Ending here would kill a socket the engine is busy restoring.
			expect(result.terminalCloses.length).toBe(0)
		})
	}
})

describe('connection.update: events that must stay off the channel', () => {
	for (const { label, event } of SILENT) {
		it(`${label} → no connection.update`, () => {
			const result = dispatch(event)

			expect(result.updates.length).toBe(0)
			expect(result.terminalCloses.length).toBe(0)
		})
	}
})

describe('the upstream Baileys reconnect handler is safe against every disconnect', () => {
	/** README §"Connecting" — the canonical consumer handler, verbatim in spirit. */
	const upstreamHandler = (update: Partial<ConnectionState>): 'reconnect' | 'stay-logged-out' | 'ignore' => {
		if (update.connection !== 'close') return 'ignore'
		const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
		return statusCode === DisconnectReason.loggedOut ? 'stay-logged-out' : 'reconnect'
	}

	it('never builds a second socket while the engine is still retrying', () => {
		// This is the whole point. Every retrying disconnect must leave the
		// upstream handler idle, or the consumer's new socket races the one the
		// engine is restoring.
		for (const { label, event } of [...RETRYING, ...SILENT]) {
			const { updates } = dispatch(event)
			const actions = updates.map(upstreamHandler)
			expect(actions.every(action => action === 'ignore')).toBe(true)
			expect(label.length > 0).toBe(true)
		}
	})

	it('does act on every terminal disconnect, which is the only time a new socket is right', () => {
		for (const { event } of TERMINAL) {
			const { close } = dispatch(event)
			if (!close) throw new Error('expected a terminal close')
			const action = upstreamHandler(close)
			expect(action === 'reconnect' || action === 'stay-logged-out').toBe(true)
		}
	})

	it('and by then the old socket has already ended, so the two never overlap', () => {
		// Ordering, not just occurrence. `end()` sets its `ended` flag
		// synchronously, so it has to run BEFORE the consumer sees the close —
		// otherwise a handler that answers with `makeWASocket()` races a socket
		// that has not started tearing down. Asserting only that
		// `onTerminalClose` fired would pass with the two swapped.
		for (const { label, event } of TERMINAL) {
			const { trace } = dispatch(event)
			expect(trace).toEqual(['end', 'close'])
			expect(label.length > 0).toBe(true)
		}
	})
})

describe('setAutoReconnect(false) turns a plain drop terminal', () => {
	// `client/lifecycle.rs` dispatches `Disconnected` and only THEN tests the
	// flag and breaks out of the run loop. Reporting `connecting` there would
	// leave the socket in that state forever: the engine is gone, nothing frees
	// the wasm client, and the consumer's reconnect handler never fires.
	it('reports close and ends the socket when auto-reconnect is off', () => {
		const { close, statusCode, trace } = dispatch({ type: 'disconnected' }, { autoReconnect: false })

		expect(close?.connection).toBe('close')
		expect(statusCode).toBe(DisconnectReason.connectionClosed)
		expect(trace).toEqual(['end', 'close'])
	})

	it('still reports connecting while auto-reconnect is on', () => {
		const { close, trace } = dispatch({ type: 'disconnected' }, { autoReconnect: true })

		expect(close).toBe(undefined)
		expect(trace).toEqual(['connecting'])
	})

	// 500/503 are only "retryable" while the engine is allowed to retry. With
	// the flag off the run loop breaks on the next pass, so reporting
	// `connecting` would strand the socket in that state with nothing left to
	// restore it and the wasm client never freed.
	// 503 has a DisconnectReason of its own; 500 falls through to the generic
	// connectionClosed, same as it would in `mapConnectFailureToDisconnect`.
	for (const { reason, expected } of [
		{ reason: 503, expected: DisconnectReason.unavailableService },
		{ reason: 500, expected: DisconnectReason.connectionClosed }
	]) {
		it(`connect failure ${reason} is terminal too when auto-reconnect is off`, () => {
			const { close, statusCode, trace } = dispatch(
				{ type: 'connect_failure', data: { reason, message: 'x' } },
				{ autoReconnect: false }
			)

			expect(close?.connection).toBe('close')
			expect(statusCode).toBe(expected)
			expect(trace).toEqual(['end', 'close'])
		})
	}
})

describe('a retrying update clears the spent QR', () => {
	// Upstream's own `connecting` always carries these. Without the explicit
	// clear, a consumer merging partial state keeps rendering a QR the server
	// has already rotated away.
	it('carries qr: undefined and receivedPendingNotifications: false', () => {
		const { updates } = dispatch({ type: 'disconnected' })

		expect(updates.length).toBe(1)
		expect('qr' in updates[0]!).toBe(true)
		expect(updates[0]?.qr).toBe(undefined)
		expect(updates[0]?.receivedPendingNotifications).toBe(false)
	})
})

describe('makeEventHandler stays usable without callbacks', () => {
	it('a terminal event with no onTerminalClose wired still emits its close', () => {
		const { ctx, ev } = makeCtx()
		const updates: Partial<ConnectionState>[] = []
		ev.on('connection.update', (update: Partial<ConnectionState>) => updates.push(update))

		makeEventHandler(ctx)({ type: 'stream_replaced' } as never)

		expect(updates.length).toBe(1)
		expect(updates[0]?.connection).toBe('close')
	})
})
