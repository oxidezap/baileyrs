import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	auditLifecycleScenarios,
	evaluateLifecycle,
	LIFECYCLE_INVARIANTS,
	lifecycleAuditFailed,
	normalizeUpdate,
	renderLifecycleReport,
	runScenario,
	unexercisedInvariants,
	type LifecycleEvent,
	type LifecycleTrace,
	type LifecycleUpdate
} from '../lifecycle-contract-core.ts'
import { runCli } from '../lifecycle-contract-audit.ts'
import { Boom } from '../../../src/Utils/boom.ts'
import { DisconnectReason } from '../../../src/Types/index.ts'

const update = (partial: Partial<LifecycleUpdate>): LifecycleUpdate => ({
	qr: 'absent',
	lastDisconnect: 'absent',
	...partial
})

const conn = (at: number, partial: Partial<LifecycleUpdate>): LifecycleEvent => ({
	at,
	name: 'connection.update',
	update: update(partial)
})

const authenticated = (at: number): LifecycleEvent => ({ at, name: 'creds.update', authenticated: true })

const trace = (label: string, events: LifecycleEvent[], extra: Partial<LifecycleTrace> = {}): LifecycleTrace => ({
	label,
	fromSocketStart: true,
	settled: true,
	observedUntil: events.length ? events[events.length - 1]!.at : 0,
	events,
	...extra
})

const connecting = (at: number) =>
	conn(at, { connection: 'connecting', qr: 'cleared', receivedPendingNotifications: false })
const closed = (at: number, status = DisconnectReason.loggedOut) =>
	conn(at, { connection: 'close', lastDisconnect: 'present', lastDisconnectStatus: status })

/** A session that keeps every promise, used as the false-positive baseline. */
const CONFORMING = trace('conforming', [
	connecting(0),
	conn(1, { qr: 'code' }),
	authenticated(2),
	conn(3, { connection: 'open' }),
	conn(4, { receivedPendingNotifications: true }),
	{ at: 5, name: 'messages.upsert' },
	connecting(6),
	conn(7, { connection: 'open' }),
	closed(8)
])

const violationsOf = (subject: LifecycleTrace) =>
	new Set(
		evaluateLifecycle([subject])
			.findings.filter(finding => finding.status === 'violated')
			.map(finding => finding.invariant)
	)

/**
 * One trace per invariant that breaks exactly that promise.
 *
 * `also` lists the invariants the same trace legitimately breaks, because some
 * violations are not separable: a second `close` is also a state published
 * after a close. Anything outside `id` and `also` is a false positive and fails
 * the run.
 */
const VIOLATIONS: Array<{ id: string; subject: LifecycleTrace; also?: string[] }> = [
	{
		id: 'LC-001',
		subject: trace('opens-without-connecting', [conn(0, { connection: 'open' })])
	},
	{
		id: 'LC-002',
		subject: trace('connecting-keeps-the-qr', [
			conn(0, { connection: 'connecting', qr: 'absent', receivedPendingNotifications: false })
		])
	},
	{
		id: 'LC-002',
		subject: trace('connecting-keeps-pending-notifications', [conn(0, { connection: 'connecting', qr: 'cleared' })])
	},
	{
		id: 'LC-003',
		subject: trace('opens-twice', [connecting(0), conn(1, { connection: 'open' }), conn(2, { connection: 'open' })])
	},
	{
		id: 'LC-004',
		subject: trace('authenticates-and-goes-quiet', [connecting(0), authenticated(1)])
	},
	{
		id: 'LC-005',
		subject: trace('speaks-after-close', [connecting(0), closed(1), connecting(2)])
	},
	{
		id: 'LC-006',
		subject: trace('closes-twice', [connecting(0), closed(1), closed(2)]),
		also: ['LC-005']
	},
	{
		id: 'LC-007',
		subject: trace('last-disconnect-on-connecting', [
			conn(0, {
				connection: 'connecting',
				qr: 'cleared',
				receivedPendingNotifications: false,
				lastDisconnect: 'present'
			})
		])
	},
	{
		id: 'LC-008',
		subject: trace('close-without-status', [connecting(0), conn(1, { connection: 'close' })])
	},
	{
		id: 'LC-009',
		subject: trace('pending-before-open', [connecting(0), conn(1, { receivedPendingNotifications: true })])
	},
	{
		id: 'LC-010',
		subject: trace('qr-after-open', [connecting(0), conn(1, { connection: 'open' }), conn(2, { qr: 'code' })])
	},
	{
		id: 'LC-011',
		subject: trace('messages-before-open', [connecting(0), { at: 1, name: 'messages.upsert' }])
	}
]

describe('lifecycle contract auditor', () => {
	it('reports no violation for a conforming session', () => {
		const report = evaluateLifecycle([CONFORMING])
		assert.equal(report.summary.violated, 0, renderLifecycleReport(report, true))
		assert.equal(lifecycleAuditFailed(report), false)
	})

	it('exercises every invariant on the conforming session', () => {
		// A baseline that skips an invariant would let a false positive there go
		// unnoticed, so the false-positive test above is only worth as much as
		// this one.
		assert.deepEqual(unexercisedInvariants(evaluateLifecycle([CONFORMING])), [])
	})

	for (const { id, subject, also } of VIOLATIONS) {
		it(`catches ${id} on \`${subject.label}\``, () => {
			const violated = violationsOf(subject)
			assert.ok(
				violated.has(id),
				`${id} not reported for ${subject.label}: got ${[...violated].join(', ') || 'nothing'}`
			)
			const allowed = new Set([id, ...(also ?? [])])
			const extra = [...violated].filter(entry => !allowed.has(entry))
			assert.deepEqual(extra, [], `${subject.label} produced false positives`)
		})
	}

	it('covers every invariant with a violation case', () => {
		// Adding an invariant without a failing case would ship a check nobody
		// has ever seen fail.
		const covered = new Set(VIOLATIONS.map(entry => entry.id))
		const uncovered = LIFECYCLE_INVARIANTS.filter(invariant => !covered.has(invariant.id)).map(
			invariant => invariant.id
		)
		assert.deepEqual(uncovered, [])
	})

	it('treats an unexercised premise as coverage, never as a violation', () => {
		const report = evaluateLifecycle([trace('nothing-happened', [])])
		assert.equal(report.summary.violated, 0, renderLifecycleReport(report, true))
		assert.equal(report.summary.holds, 0)
		assert.equal(report.summary['not-exercised'], LIFECYCLE_INVARIANTS.length)
	})

	it('does not judge ordering on a recording that started late', () => {
		const late = trace('attached-late', [conn(0, { connection: 'open' })], { fromSocketStart: false })
		assert.equal(violationsOf(late).has('LC-001'), false)
	})

	it('waits out the deadline before calling a live socket silent', () => {
		const live = trace('still-connecting', [connecting(0), authenticated(1)], { settled: false, observedUntil: 5_000 })
		assert.equal(violationsOf(live).has('LC-004'), false)
		const expired = { ...live, observedUntil: 60_000 }
		assert.ok(violationsOf(expired).has('LC-004'))
	})

	it('does not blame the library for a socket the consumer put down first', () => {
		// `sock.end()` publishes nothing by design, so this trace has the same
		// shape as the engine going quiet. Only the recording knows who stopped.
		const disposed = trace('ended-right-after-pairing', [connecting(0), authenticated(1)], {
			settled: false,
			observedUntil: 60_000,
			consumerEndedAt: 100
		})
		assert.equal(violationsOf(disposed).has('LC-004'), false)
	})

	it('still blames the library when the socket stayed up past the deadline', () => {
		const late = trace('quiet-then-disposed', [connecting(0), authenticated(1)], {
			settled: false,
			observedUntil: 60_000,
			consumerEndedAt: 45_000
		})
		assert.ok(violationsOf(late).has('LC-004'))
	})

	it('rejects a trace whose clock runs backwards', () => {
		const scrambled = trace('backwards', [connecting(5), connecting(1)])
		assert.throws(() => evaluateLifecycle([scrambled]), /clock went backwards/)
	})

	it('normalizes the three states of the `qr` key', () => {
		assert.equal(normalizeUpdate({ connection: 'open' }).qr, 'absent')
		assert.equal(normalizeUpdate({ qr: undefined }).qr, 'cleared')
		assert.equal(normalizeUpdate({ qr: '2@abc' }).qr, 'code')
	})

	it('reads the Boom status a close carries', () => {
		const normalized = normalizeUpdate({
			connection: 'close',
			lastDisconnect: { error: new Boom('gone', { statusCode: DisconnectReason.loggedOut }), date: new Date() }
		})
		assert.equal(normalized.lastDisconnect, 'present')
		assert.equal(normalized.lastDisconnectStatus, DisconnectReason.loggedOut)
	})
})

describe('lifecycle contract scenarios', () => {
	it('holds for every session the engine produces', () => {
		const report = auditLifecycleScenarios()
		assert.equal(report.summary.violated, 0, renderLifecycleReport(report, true))
	})

	it('exercises every invariant', () => {
		assert.deepEqual(unexercisedInvariants(auditLifecycleScenarios()), [])
	})

	/**
	 * The session that started all this: the engine pairs, the consumer is told
	 * it paired, and no `Connected` ever follows. Upstream publishes `open` off
	 * `<success>` with nothing in between (`Socket/socket.ts:1138`), so a socket
	 * that authenticates and then goes quiet is a contract break, not a slow
	 * connect.
	 */
	it('catches a pairing that never reaches `open`', () => {
		const paired = runScenario({
			label: 'pair-success-without-connected',
			events: [
				{ type: 'qr', data: { code: '2@abc', timeout: 60 } },
				{
					type: 'pair_success',
					data: { id: '5511999999999@s.whatsapp.net', lid: '1@lid', business_name: '', platform: 'android' }
				}
			]
		})
		const report = evaluateLifecycle([paired])
		const violated = report.findings.filter(finding => finding.status === 'violated').map(finding => finding.invariant)
		assert.deepEqual(violated, ['LC-004'], renderLifecycleReport(report, true))
	})

	it('accepts the same pairing once `connected` arrives', () => {
		const paired = runScenario({
			label: 'pair-success-with-connected',
			events: [
				{ type: 'qr', data: { code: '2@abc', timeout: 60 } },
				{
					type: 'pair_success',
					data: { id: '5511999999999@s.whatsapp.net', lid: '1@lid', business_name: '', platform: 'android' }
				},
				{ type: 'connected', data: {} }
			]
		})
		assert.equal(evaluateLifecycle([paired]).summary.violated, 0)
	})
})

describe('lifecycle contract CLI', () => {
	it('passes on the built-in suite under --strict', () => {
		assert.equal(runCli(['--strict']), 0)
	})

	it('fails on a recorded trace that breaks the contract', () => {
		const folder = mkdtempSync(join(tmpdir(), 'lifecycle-contract-'))
		try {
			const file = join(folder, 'trace.json')
			writeFileSync(file, JSON.stringify([VIOLATIONS[0]!.subject]))
			assert.equal(runCli(['--trace', file, '--strict']), 1)
		} finally {
			rmSync(folder, { recursive: true, force: true })
		}
	})

	it('rejects a non-positive deadline instead of judging with it', () => {
		assert.throws(() => runCli(['--open-deadline', '0']), /--open-deadline/)
	})
})
