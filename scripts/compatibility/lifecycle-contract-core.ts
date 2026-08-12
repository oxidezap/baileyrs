import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeWASocket } from '../../src/index.ts'
import { makeEventHandlers } from '../../src/Socket/events.ts'
import type { SocketContext } from '../../src/Socket/types.ts'
import type { BaileysEventEmitter, BaileysEventMap, ConnectionState } from '../../src/Types/index.ts'
import type { Boom } from '../../src/Utils/boom.ts'
import { useMultiFileAuthState } from '../../src/Utils/use-multi-file-auth-state.ts'

/**
 * Lifecycle contract auditor.
 *
 * The declaration auditor compares `.d.ts` shapes, so a socket that never
 * publishes `connection.update` at all still scores 100% compatible: the event
 * is declared, `ConnectionState.connection` still includes `'open'`, and every
 * type matches. What upstream actually promises is not a shape but an order —
 * `connecting` first, exactly one `open` once the session authenticates,
 * `close` last and never followed by anything. This file states those promises
 * as invariants over an observed trace and reports which ones a trace breaks.
 *
 * Every invariant cites where upstream guarantees it. A trace that does not
 * exercise an invariant's premise reports `not-exercised` rather than passing,
 * so a scenario suite that stops covering a state is visible instead of silently
 * green.
 */

export type LifecycleConnection = 'open' | 'connecting' | 'close'

/**
 * A `connection.update` reduced to the facts the invariants judge.
 *
 * Normalized rather than kept raw because the distinction upstream relies on —
 * `qr` present and cleared versus absent — does not survive JSON, and a trace
 * has to be able to travel as a file. A consumer merging partial state keeps
 * rendering the old QR when the key is absent, which is why the two cases are
 * not interchangeable (`src/Socket/events.ts:270`).
 */
export interface LifecycleUpdate {
	connection?: LifecycleConnection
	/** `absent`: no `qr` key. `cleared`: key present, value undefined. `code`: a QR string. */
	qr: 'absent' | 'cleared' | 'code'
	receivedPendingNotifications?: boolean
	lastDisconnect: 'absent' | 'present'
	/** `lastDisconnect.error` Boom status code, when it carries one. */
	lastDisconnectStatus?: number
	isNewLogin?: boolean
}

export type LifecycleEventName = 'connection.update' | 'creds.update' | 'messages.upsert' | 'messaging-history.set'

export interface LifecycleEvent {
	/** Milliseconds from the start of the recording. Monotonic, never decreasing. */
	at: number
	name: LifecycleEventName
	/** Present exactly when `name` is `connection.update`. */
	update?: LifecycleUpdate
	/** A `creds.update` carrying `me.id`: this socket has authenticated. */
	authenticated?: boolean
}

export interface LifecycleTrace {
	label: string
	/**
	 * The recording started when the socket was built. False disables the
	 * invariants that judge what comes first, because a trace attached late
	 * cannot distinguish a missing `connecting` from one it never saw.
	 */
	fromSocketStart: boolean
	/**
	 * The event source is exhausted: nothing else can arrive. True for a
	 * synchronous dispatcher run, false for a live socket, where absence is
	 * only evidence once the deadline has passed.
	 */
	settled: boolean
	/** Last instant observed, on the same clock as `event.at`. */
	observedUntil: number
	/**
	 * When the consumer disposed the socket, if it did.
	 *
	 * `sock.end()` publishes nothing, so a socket disposed right after pairing
	 * leaves the same trace as one the engine never announced. Recording who
	 * stopped it is what keeps the liveness invariant from blaming the library
	 * for a consumer's own teardown.
	 */
	consumerEndedAt?: number
	events: LifecycleEvent[]
}

export type LifecycleStatus = 'holds' | 'violated' | 'not-exercised'

export interface LifecycleFinding {
	invariant: string
	trace: string
	status: LifecycleStatus
	detail?: string
}

export interface LifecycleReport {
	findings: LifecycleFinding[]
	summary: { traces: number; holds: number; violated: number; 'not-exercised': number }
}

export interface LifecycleOptions {
	/**
	 * How long after authenticating a live socket may stay silent before the
	 * absence of `open` counts as evidence rather than as a short recording.
	 */
	openDeadlineMs: number
}

export const DEFAULT_LIFECYCLE_OPTIONS: LifecycleOptions = { openDeadlineMs: 30_000 }

type CheckResult = { status: LifecycleStatus; detail?: string }

export interface LifecycleInvariant {
	id: string
	title: string
	/** Where upstream Baileys guarantees this, as `file:line`. */
	upstream: string
	check: (trace: LifecycleTrace, options: LifecycleOptions) => CheckResult
}

const holds = (detail?: string): CheckResult => ({ status: 'holds', detail })
const violated = (detail: string): CheckResult => ({ status: 'violated', detail })
const notExercised = (detail: string): CheckResult => ({ status: 'not-exercised', detail })

/**
 * An event with the position it was recorded at.
 *
 * Order comes from the position, never from `at`: `Date.now()` has millisecond
 * resolution and a socket publishes several events inside one, so a message
 * emitted just before `open` shares its timestamp and would read as
 * simultaneous. `at` still answers "how long", which is what the deadline in
 * LC-004 needs; it just does not answer "before or after".
 */
type PositionedEvent = LifecycleEvent & { at_: number }
type PositionedUpdate = PositionedEvent & { update: LifecycleUpdate }

const positioned = (trace: LifecycleTrace): PositionedEvent[] =>
	trace.events.map((event, index) => ({ ...event, at_: index }))

const connectionUpdates = (trace: LifecycleTrace): PositionedUpdate[] =>
	positioned(trace).filter((event): event is PositionedUpdate => event.update !== undefined)

const statefulUpdates = (trace: LifecycleTrace): PositionedUpdate[] =>
	connectionUpdates(trace).filter(event => event.update.connection)

const firstOpen = (trace: LifecycleTrace): PositionedUpdate | undefined =>
	statefulUpdates(trace).find(event => event.update.connection === 'open')

/**
 * The connection state in effect when the event at `position` was published.
 *
 * The state a socket is in, not the state it once reached: after
 * `open → connecting`, a socket is connecting, and something that may only
 * happen while open may not happen there either. Comparing against the first
 * `open` instead would let everything after a reconnect through.
 */
const stateAt = (trace: LifecycleTrace, position: number): LifecycleConnection | undefined => {
	let state: LifecycleConnection | undefined
	for (const event of statefulUpdates(trace)) {
		if (event.at_ > position) break
		state = event.update.connection
	}
	return state
}

/**
 * The contract, one entry per promise upstream makes.
 *
 * Ordered as a session runs, not by importance: reading them top to bottom is
 * meant to read as the life of a socket.
 */
export const LIFECYCLE_INVARIANTS: readonly LifecycleInvariant[] = [
	{
		id: 'LC-001',
		title: 'the first connection state a socket publishes is `connecting`',
		upstream: 'Socket/socket.ts:1214',
		check: trace => {
			if (!trace.fromSocketStart) return notExercised('recording did not start at socket construction')
			const [first] = statefulUpdates(trace)
			if (!first) return notExercised('no connection state was published')
			return first.update.connection === 'connecting'
				? holds()
				: violated(`first published state was \`${first.update.connection}\``)
		}
	},
	{
		id: 'LC-002',
		title: '`connecting` clears the QR and resets pending notifications',
		upstream: 'Socket/socket.ts:1214',
		check: trace => {
			const targets = statefulUpdates(trace).filter(event => event.update.connection === 'connecting')
			if (!targets.length) return notExercised('no `connecting` was published')
			for (const event of targets) {
				if (event.update.qr !== 'cleared') {
					return violated(
						`\`connecting\` at ${event.at}ms carries qr=${event.update.qr}, expected the key present and cleared`
					)
				}
				if (event.update.receivedPendingNotifications !== false) {
					return violated(
						`\`connecting\` at ${event.at}ms carries receivedPendingNotifications=${event.update.receivedPendingNotifications}, expected false`
					)
				}
			}
			return holds(`${targets.length} checked`)
		}
	},
	{
		id: 'LC-003',
		title: '`open` is not republished without leaving the state first',
		upstream: 'Socket/socket.ts:1138',
		check: trace => {
			const states = statefulUpdates(trace)
			if (!states.some(event => event.update.connection === 'open')) return notExercised('the socket never opened')
			let open = false
			for (const event of states) {
				if (event.update.connection === 'open') {
					if (open) return violated(`a second \`open\` at ${event.at}ms with no \`connecting\` or \`close\` in between`)
					open = true
					continue
				}
				open = false
			}
			return holds()
		}
	},
	{
		id: 'LC-004',
		title: 'a socket that authenticates reaches `open` or `close`',
		upstream: 'Socket/socket.ts:1138',
		check: (trace, options) => {
			const authenticated = positioned(trace).find(event => event.authenticated === true)
			if (!authenticated) return notExercised('the socket did not authenticate during the recording')
			const settledState = statefulUpdates(trace).find(
				event =>
					event.at_ >= authenticated.at_ && (event.update.connection === 'open' || event.update.connection === 'close')
			)
			if (settledState) {
				return holds(
					`\`${settledState.update.connection}\` ${settledState.at - authenticated.at}ms after authenticating`
				)
			}
			const silentFor = trace.observedUntil - authenticated.at
			if (trace.settled)
				return violated(
					`authenticated at ${authenticated.at}ms and the event source ended with no \`open\` and no \`close\``
				)
			// `sock.end()` publishes nothing by design, so a consumer that
			// disposes a socket right after pairing produces the same shape as
			// the engine going quiet. The difference is who stopped it, and only
			// the recording knows.
			if (trace.consumerEndedAt !== undefined && trace.consumerEndedAt - authenticated.at < options.openDeadlineMs) {
				return notExercised(
					`the consumer ended the socket ${trace.consumerEndedAt - authenticated.at}ms after authenticating, before the deadline`
				)
			}
			if (silentFor >= options.openDeadlineMs) {
				return violated(`authenticated at ${authenticated.at}ms and stayed silent for ${silentFor}ms`)
			}
			return notExercised(
				`only observed ${silentFor}ms after authenticating, below the ${options.openDeadlineMs}ms deadline`
			)
		}
	},
	{
		id: 'LC-005',
		title: '`close` is terminal: no connection state follows it',
		upstream: 'Socket/socket.ts:829',
		check: trace => {
			const updates = connectionUpdates(trace)
			const closeIndex = updates.findIndex(event => event.update.connection === 'close')
			if (closeIndex < 0) return notExercised('the socket never closed')
			const after = updates[closeIndex + 1]
			return after ? violated(`a \`connection.update\` at ${after.at}ms follows the close`) : holds()
		}
	},
	{
		id: 'LC-006',
		title: 'a socket closes at most once',
		upstream: 'Socket/socket.ts:790',
		check: trace => {
			const closes = statefulUpdates(trace).filter(event => event.update.connection === 'close')
			if (!closes.length) return notExercised('the socket never closed')
			return closes.length === 1 ? holds() : violated(`${closes.length} closes published`)
		}
	},
	{
		id: 'LC-007',
		title: '`lastDisconnect` rides only on `close`',
		upstream: 'Socket/socket.ts:824',
		check: trace => {
			const carriers = connectionUpdates(trace).filter(event => event.update.lastDisconnect === 'present')
			if (!carriers.length) return notExercised('no update carried `lastDisconnect`')
			const stray = carriers.find(event => event.update.connection !== 'close')
			return stray
				? violated(
						`update at ${stray.at}ms carries \`lastDisconnect\` with connection=\`${stray.update.connection ?? 'none'}\``
					)
				: holds(`${carriers.length} checked`)
		}
	},
	{
		id: 'LC-008',
		title: '`close` carries a Boom status a reconnect handler can branch on',
		upstream: 'Socket/socket.ts:824',
		check: trace => {
			const closes = statefulUpdates(trace).filter(event => event.update.connection === 'close')
			if (!closes.length) return notExercised('the socket never closed')
			const bare = closes.find(
				event => event.update.lastDisconnect !== 'present' || event.update.lastDisconnectStatus === undefined
			)
			return bare ? violated(`close at ${bare.at}ms carries no Boom status code`) : holds()
		}
	},
	{
		id: 'LC-009',
		title: 'pending notifications are only reported while the socket is open',
		upstream: 'Socket/socket.ts:1228',
		check: trace => {
			const targets = connectionUpdates(trace).filter(event => event.update.receivedPendingNotifications === true)
			if (!targets.length) return notExercised('pending notifications were never reported')
			// Judged against the state in effect, not against the first `open`
			// ever seen: `open → connecting → reported` is a socket reporting an
			// offline batch for a connection it is still re-establishing, and
			// comparing with the first `open` would call that fine.
			const stray = targets.find(event => stateAt(trace, event.at_) !== 'open')
			return stray
				? violated(`reported at ${stray.at}ms while the socket was \`${stateAt(trace, stray.at_) ?? 'in no state'}\``)
				: holds(`${targets.length} checked`)
		}
	},
	{
		id: 'LC-010',
		title: 'no QR is published once the socket has opened',
		upstream: 'Socket/socket.ts:1090',
		check: trace => {
			const codes = connectionUpdates(trace).filter(event => event.update.qr === 'code')
			if (!codes.length) return notExercised('no QR was published')
			const open = firstOpen(trace)
			// The premise is what happens *after* opening, so a session that
			// only ever showed a QR has not exercised this. Reporting it as
			// holding would let `--strict` keep claiming coverage even if every
			// scenario regressed into a QR-only session.
			if (!open) return notExercised('the socket never opened, so nothing followed an open')
			const late = codes.find(event => event.at_ > open.at_)
			return late ? violated(`QR published at ${late.at}ms, after the socket opened at ${open.at}ms`) : holds()
		}
	},
	{
		id: 'LC-011',
		title: 'no message reaches the consumer while the socket is not open',
		upstream: 'Socket/socket.ts:1206',
		check: trace => {
			const upserts = positioned(trace).filter(event => event.name === 'messages.upsert')
			if (!upserts.length) return notExercised('no message was published')
			// Same reasoning as LC-009: upstream buffers until the offline flush
			// that follows `<success>`, so a consumer is never handed messages
			// for a connection that is not up, first one or fifth.
			const stray = upserts.find(event => stateAt(trace, event.at_) !== 'open')
			return stray
				? violated(
						`messages published at ${stray.at}ms while the socket was \`${stateAt(trace, stray.at_) ?? 'in no state'}\``
					)
				: holds(`${upserts.length} checked`)
		}
	}
]

export const evaluateLifecycle = (
	traces: readonly LifecycleTrace[],
	options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS
): LifecycleReport => {
	const findings: LifecycleFinding[] = []
	const summary: LifecycleReport['summary'] = { traces: traces.length, holds: 0, violated: 0, 'not-exercised': 0 }
	for (const trace of traces) {
		assertMonotonic(trace)
		for (const invariant of LIFECYCLE_INVARIANTS) {
			const result = invariant.check(trace, options)
			findings.push({ invariant: invariant.id, trace: trace.label, status: result.status, detail: result.detail })
			summary[result.status] += 1
		}
	}
	return { findings, summary }
}

/**
 * A trace whose clock runs backwards would make every ordering invariant
 * meaningless, and silently so. Rejected at the door rather than judged.
 */
const assertMonotonic = (trace: LifecycleTrace) => {
	let previous = Number.NEGATIVE_INFINITY
	for (const event of trace.events) {
		if (event.at < previous) throw new Error(`${trace.label}: trace clock went backwards at ${event.at}ms`)
		previous = event.at
	}
	if (trace.observedUntil < previous) {
		throw new Error(`${trace.label}: observedUntil (${trace.observedUntil}ms) precedes the last event (${previous}ms)`)
	}
}

export const lifecycleAuditFailed = (report: LifecycleReport): boolean => report.summary.violated > 0

/**
 * An invariant no trace exercised is a coverage hole, not a pass: the suite
 * stopped reaching a state the contract still promises something about.
 */
export const unexercisedInvariants = (report: LifecycleReport): string[] => {
	const exercised = new Set(
		report.findings.filter(finding => finding.status !== 'not-exercised').map(finding => finding.invariant)
	)
	return LIFECYCLE_INVARIANTS.filter(invariant => !exercised.has(invariant.id)).map(invariant => invariant.id)
}

export const renderLifecycleReport = (report: LifecycleReport, details: boolean): string => {
	const lines: string[] = []
	const byInvariant = new Map<string, LifecycleFinding[]>()
	for (const finding of report.findings) {
		const bucket = byInvariant.get(finding.invariant)
		if (bucket) bucket.push(finding)
		else byInvariant.set(finding.invariant, [finding])
	}

	lines.push(`Lifecycle contract: ${report.summary.traces} trace(s), ${LIFECYCLE_INVARIANTS.length} invariant(s)`)
	lines.push('')
	for (const invariant of LIFECYCLE_INVARIANTS) {
		const bucket = byInvariant.get(invariant.id) ?? []
		const violations = bucket.filter(finding => finding.status === 'violated')
		const passes = bucket.filter(finding => finding.status === 'holds')
		const mark = violations.length ? 'FAIL' : passes.length ? 'ok  ' : '--  '
		lines.push(`${mark} ${invariant.id}  ${invariant.title}  (upstream ${invariant.upstream})`)
		for (const violation of violations) {
			lines.push(`       ${violation.trace}: ${violation.detail}`)
		}
		if (details) {
			for (const finding of bucket.filter(entry => entry.status !== 'violated')) {
				lines.push(
					`       ${finding.status === 'holds' ? '·' : '~'} ${finding.trace}: ${finding.detail ?? ''}`.trimEnd()
				)
			}
		}
	}
	lines.push('')
	lines.push(
		`holds ${report.summary.holds} · violated ${report.summary.violated} · not exercised ${report.summary['not-exercised']}`
	)
	const uncovered = unexercisedInvariants(report)
	if (uncovered.length) lines.push(`no trace exercised: ${uncovered.join(', ')}`)
	return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording — the only place that knows what a raw `connection.update` looks
// like. Everything above judges the normalized form.
// ─────────────────────────────────────────────────────────────────────────────

export const normalizeUpdate = (update: Partial<ConnectionState>): LifecycleUpdate => {
	const hasQrKey = Object.prototype.hasOwnProperty.call(update, 'qr')
	const status = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
	return {
		connection: update.connection,
		qr: !hasQrKey ? 'absent' : typeof update.qr === 'string' ? 'code' : 'cleared',
		receivedPendingNotifications: update.receivedPendingNotifications,
		lastDisconnect: update.lastDisconnect ? 'present' : 'absent',
		lastDisconnectStatus: typeof status === 'number' ? status : undefined,
		isNewLogin: update.isNewLogin
	}
}

export interface LifecycleRecorder {
	/**
	 * Mark the moment the consumer disposed the socket.
	 *
	 * Call it around `sock.end()` / `sock.logout()`. Without it, a socket the
	 * consumer put down before it ever opened is indistinguishable from one the
	 * library left hanging.
	 */
	noteConsumerEnd: () => void
	/** Stop listening and return what was observed. */
	stop: () => LifecycleTrace
}

/** Anything with the Baileys event bus on it: the real socket, or a bare emitter in a scenario. */
export interface RecordableSocket {
	ev: Pick<BaileysEventEmitter, 'on' | 'off'>
}

/**
 * Record a live socket's lifecycle.
 *
 * `now` is injectable so a test can drive the clock instead of sleeping, and so
 * the recorder itself has no dependency on wall time being the interesting one.
 */
export const recordLifecycle = (
	sock: RecordableSocket,
	options: {
		label: string
		fromSocketStart?: boolean
		/**
		 * The socket was already authenticated when the recording started.
		 *
		 * A socket resuming a stored session never publishes `creds.update`
		 * merely because it is logged in, so without this LC-004 has no premise
		 * and a resumed session that hangs without ever opening reports as
		 * unexercised — which is the liveness regression, missed. Pass
		 * `Boolean(sock.authState?.creds?.me?.id)` at construction.
		 */
		authenticatedAtStart?: boolean
		now?: () => number
	} = { label: 'live' }
): LifecycleRecorder => {
	const now = options.now ?? (() => Date.now())
	const start = now()
	const events: LifecycleEvent[] = []
	const at = () => now() - start
	if (options.authenticatedAtStart) events.push({ at: 0, name: 'creds.update', authenticated: true })

	const onConnection = (update: BaileysEventMap['connection.update']) => {
		events.push({ at: at(), name: 'connection.update', update: normalizeUpdate(update) })
	}
	// `me.id` is what upstream's own creds carry once a session exists, so it is
	// the same signal here whether the socket paired now or loaded from disk.
	const onCreds = (creds: BaileysEventMap['creds.update']) => {
		events.push({ at: at(), name: 'creds.update', authenticated: typeof creds?.me?.id === 'string' })
	}
	const onUpsert = () => {
		events.push({ at: at(), name: 'messages.upsert' })
	}
	const onHistory = () => {
		events.push({ at: at(), name: 'messaging-history.set' })
	}

	sock.ev.on('connection.update', onConnection)
	sock.ev.on('creds.update', onCreds)
	sock.ev.on('messages.upsert', onUpsert)
	sock.ev.on('messaging-history.set', onHistory)

	let consumerEndedAt: number | undefined
	return {
		noteConsumerEnd: () => {
			consumerEndedAt ??= at()
		},
		stop: () => {
			sock.ev.off('connection.update', onConnection)
			sock.ev.off('creds.update', onCreds)
			sock.ev.off('messages.upsert', onUpsert)
			sock.ev.off('messaging-history.set', onHistory)
			return {
				label: options.label,
				fromSocketStart: options.fromSocketStart ?? true,
				settled: false,
				observedUntil: at(),
				consumerEndedAt,
				events
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline scenarios — the real dispatcher, driven by bridge events.
// ─────────────────────────────────────────────────────────────────────────────

const noopLogger = {
	// `level` included because a real socket reads it. Without it `init()`
	// throws before it queues the bootstrap update, and the failure is swallowed
	// by the socket's own `initPromise.catch`, so the recording just comes back
	// empty with nothing to say why.
	level: 'silent',
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return noopLogger
	}
}

export interface LifecycleScenario {
	label: string
	/** Bridge events, in the order the engine would dispatch them. */
	events: readonly { type: string; data?: unknown }[]
	autoReconnect?: boolean
}

/**
 * Run a scenario through the real dispatcher.
 *
 * `fromSocketStart` is false for all of them, and deliberately: a scenario
 * starts at the dispatcher, which is downstream of the socket's own bootstrap
 * update. Claiming otherwise would have LC-001 judging a `connecting` written
 * here rather than the one `makeWASocket` publishes, and a fixture cannot
 * regress with the implementation it stands in for. `recordBootstrap` covers
 * that one against a real socket.
 *
 * Every scenario ends `settled`: the dispatcher is synchronous, so once the
 * last bridge event has been handed over, nothing else can arrive. That is what
 * lets a missing `open` count as evidence here without waiting out a deadline.
 */
export const runScenario = (scenario: LifecycleScenario): LifecycleTrace => {
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
		getClient: () => Promise.reject(new Error('not used')),
		getClientSync: () => {
			throw new Error('not used')
		}
	}

	let clock = 0
	const recorder = recordLifecycle({ ev } as unknown as RecordableSocket, {
		label: scenario.label,
		now: () => clock
	})

	const handlers = makeEventHandlers(ctx, {
		// The socket wires this to `end(...).finally(publish)`; here the teardown
		// has already finished, so the close goes out immediately.
		onTerminalClose: (_error, publish) => publish(),
		isAutoReconnectEnabled: () => scenario.autoReconnect ?? true
	})

	for (const event of scenario.events) {
		clock += 1
		handlers.onEvent?.(event as never)
	}

	const trace = recorder.stop()
	return { ...trace, settled: true, fromSocketStart: false }
}

/**
 * Record what a real socket publishes before it has a client at all.
 *
 * The one invariant a dispatcher scenario cannot cover: the bootstrap update is
 * published from a microtask queued inside `makeWASocket` (`src/Socket/index.ts`),
 * upstream of everything the dispatcher does. Standing in for it with a literal
 * would leave LC-001 and LC-002 asserting a fixture, green forever even if the
 * socket stopped publishing `connecting` first or dropped one of the fields
 * that clears the previous QR.
 *
 * No server is involved: the socket is pointed at an unreachable port and torn
 * down as soon as the update lands, which happens before any I/O is attempted.
 */
export const recordBootstrap = async (): Promise<LifecycleTrace> => {
	const folder = await mkdtemp(join(tmpdir(), 'lifecycle-bootstrap-'))
	try {
		const { state } = await useMultiFileAuthState(folder)
		const sock = makeWASocket({
			auth: state,
			// Reserved as "discard" and unreachable, so the socket cannot connect
			// to anything a developer happens to be running.
			waWebSocketUrl: 'wss://127.0.0.1:9/ws',
			logger: noopLogger as never
		})
		const recorder = recordLifecycle(sock, { label: 'socket-bootstrap' })
		// One macrotask: the update is queued as a microtask during construction,
		// so it has already landed by the time this resolves.
		await new Promise(resolve => setTimeout(resolve, 0))
		recorder.noteConsumerEnd()
		const trace = recorder.stop()
		sock.setAutoReconnect(false)
		await sock.end(undefined).catch(() => {})
		return { ...trace, settled: true, fromSocketStart: true }
	} finally {
		await rm(folder, { recursive: true, force: true })
	}
}

/**
 * The sessions the contract has to hold for. Each one is a shape the engine
 * really produces; together they have to exercise every invariant, which
 * `unexercisedInvariants` turns into a failure when they stop doing so.
 */
export const LIFECYCLE_SCENARIOS: readonly LifecycleScenario[] = [
	{
		label: 'fresh-pair',
		events: [
			{ type: 'qr', data: { code: '2@abc', timeout: 60 } },
			{
				type: 'pair_success',
				data: { id: '5511999999999@s.whatsapp.net', lid: '1@lid', business_name: '', platform: 'android' }
			},
			{ type: 'connected', data: {} },
			{ type: 'offline_sync_completed', data: { count: 3 } },
			{ type: 'message', data: MESSAGE_FIXTURE() }
		]
	},
	{
		label: 'transient-drop',
		events: [
			{ type: 'connected', data: {} },
			{ type: 'disconnected', data: {} },
			{ type: 'connected', data: {} },
			{ type: 'offline_sync_completed', data: { count: 0 } }
		]
	},
	{
		label: 'connect-failure-retryable',
		events: [
			{ type: 'connected', data: {} },
			{ type: 'connect_failure', data: { reason: 503, message: 'service unavailable' } },
			{ type: 'connected', data: {} }
		]
	},
	{
		label: 'pair-error-then-new-qr',
		events: [
			{ type: 'qr', data: { code: '2@abc', timeout: 60 } },
			{ type: 'pair_error', data: { id: '', lid: '', business_name: '', platform: '', error: 'bad signature' } },
			{ type: 'qr', data: { code: '2@def', timeout: 60 } }
		]
	},
	{
		label: 'logged-out',
		events: [
			{ type: 'connected', data: {} },
			{ type: 'logged_out', data: { on_connect: false, reason: 'main device removed the session' } }
		]
	},
	{
		label: 'stream-replaced',
		events: [
			{ type: 'connected', data: {} },
			{ type: 'stream_replaced', data: {} }
		]
	},
	{
		label: 'auto-reconnect-disabled-drop',
		autoReconnect: false,
		events: [
			{ type: 'connected', data: {} },
			{ type: 'disconnected', data: {} }
		]
	}
]

/**
 * Minimal message the dispatcher accepts, so `LC-011` has something to order
 * against `open`. Built as a function so no scenario can mutate a shared one.
 */
function MESSAGE_FIXTURE() {
	return {
		message: { conversation: 'hi' },
		info: {
			id: 'BAE5F0000000000A',
			timestamp: 1,
			push_name: 'tester',
			source: {
				chat: { user: '5511999999999', server: 's.whatsapp.net', agent: 0, device: 0, integrator: 0 },
				is_group: false,
				is_from_me: false
			}
		}
	}
}

/**
 * The suite: the real bootstrap, then every dispatcher scenario.
 *
 * Async because the bootstrap is a real socket. It is the only invariant here
 * that no dispatcher scenario can reach, and leaving it to a literal was the
 * one place this auditor claimed coverage it did not have.
 */
export const auditLifecycleScenarios = async (
	scenarios: readonly LifecycleScenario[] = LIFECYCLE_SCENARIOS,
	options: LifecycleOptions = DEFAULT_LIFECYCLE_OPTIONS
): Promise<LifecycleReport> => evaluateLifecycle([await recordBootstrap(), ...scenarios.map(runScenario)], options)
