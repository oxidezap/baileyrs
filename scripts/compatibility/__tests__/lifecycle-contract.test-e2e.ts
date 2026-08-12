/**
 * E2E: the lifecycle contract, judged on a real session.
 *
 * The offline suite drives the dispatcher with bridge events we choose, so it
 * proves the translation is right and nothing about what the engine actually
 * dispatches. This file records a live socket from the instant it is built and
 * hands the trace to the same invariants, which is the only place a missing
 * `Connected` from the engine can surface.
 *
 * It lives here rather than under `src/__tests__/e2e/` because compatibility
 * tooling never ships and `src` never imports it; the dependency only runs the
 * other way. `npm run test:e2e` picks up both directories.
 *
 * Needs the live mock server. An unexercised invariant is reported and not
 * failed: one session is not expected to reach every state. A violation fails.
 */

import assert from 'node:assert/strict'
import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import { createTestClient, destroyTestClient, type TestClient } from '../../../src/__tests__/e2e/test-client.ts'
import {
	evaluateLifecycle,
	recordLifecycle,
	renderLifecycleReport,
	unexercisedInvariants,
	type LifecycleRecorder
} from '../lifecycle-contract-core.ts'

/**
 * The socket authenticates, syncs and settles well inside this. It exists so a
 * session that hangs is reported as a contract break instead of as a bare
 * timeout with nothing to read.
 */
const OPEN_DEADLINE_MS = 30_000

/**
 * Violations a live session produces today, pinned so a third one fails.
 *
 * Both come from the same place: the engine leaves passive mode
 * (`client/node_io.rs:1221`) well before it dispatches `Connected`, which it
 * withholds until the critical app state sync finishes
 * (`client/node_io.rs:1467`). Everything that follows leaving passive mode
 * therefore reaches the consumer while this socket still reads as `connecting`.
 * Upstream has no such gap: `open` goes out on `<success>`
 * (`Socket/socket.ts:1138`), before the offline batch it later flushes.
 *
 * `LC-011` has a second cause on our side: upstream buffers events from
 * `process.nextTick` and flushes on `CB:ib,,offline` (`Socket/socket.ts:1206`
 * and `1224`), and this socket never calls `ev.buffer()`, so a message is
 * published the moment it decodes.
 *
 * Not silenced: the assertions below fail if one of these starts holding, so
 * the entry cannot outlive the fix.
 */
const KNOWN_VIOLATIONS = new Set(['LC-009', 'LC-011'])

describe('E2E: lifecycle contract', { timeout: 180_000 }, () => {
	let alice: TestClient | undefined
	let recorder: LifecycleRecorder | undefined
	let setupError: Error | undefined

	before(async () => {
		try {
			alice = await createTestClient({
				label: 'alice',
				folderPrefix: 'baileys-e2e-lifecycle',
				// Longer than the deadline the trace is judged by, so a socket
				// that authenticates and then goes quiet has already breached
				// LC-004 by the time the factory gives up. Matched the other way
				// round, the run would end inside the deadline and the finding
				// would report as unexercised.
				connectTimeoutMs: OPEN_DEADLINE_MS + 15_000,
				// Attached before the factory returns: the bootstrap `connecting` is
				// published from a microtask queued inside `makeWASocket`, so a
				// listener added afterwards has already missed the first state.
				onSocket: sock => {
					recorder = recordLifecycle(sock, { label: 'fresh-pair-live' })
				}
			})
		} catch (error) {
			// Kept rather than thrown. The factory waits for `open`, so the exact
			// regression this file exists to catch — authenticates, never opens —
			// would surface as its connect timeout and the trace explaining why
			// would never be read. The test body reports the finding first and
			// falls back to this only if the trace turns out to be clean.
			setupError = error instanceof Error ? error : new Error(String(error))
		}
	})

	after(async () => {
		// Before the teardown, so a trace still open at this point cannot read
		// our own disposal as the library going quiet.
		recorder?.noteConsumerEnd()
		if (alice) await destroyTestClient(alice)
	})

	test('a freshly paired session keeps every promise upstream makes', () => {
		assert.ok(recorder, `the recorder never attached${setupError ? `: ${setupError.message}` : ''}`)
		const report = evaluateLifecycle([recorder.stop()], { openDeadlineMs: OPEN_DEADLINE_MS })
		const rendered = renderLifecycleReport(report, true)
		if (process.env.LOG_LEVEL === 'debug') process.stdout.write(`${rendered}\n`)

		const violated = report.findings.filter(finding => finding.status === 'violated').map(finding => finding.invariant)
		assert.deepEqual(
			violated.filter(id => !KNOWN_VIOLATIONS.has(id)),
			[],
			rendered
		)

		// A pinned violation that now holds has been fixed, and the entry has to
		// go with it. Keyed on `holds` and not on the absence of a violation: an
		// invariant this run never exercised proves nothing either way.
		const fixed = report.findings
			.filter(finding => finding.status === 'holds' && KNOWN_VIOLATIONS.has(finding.invariant))
			.map(finding => finding.invariant)
		assert.deepEqual(fixed, [], `${rendered}\n\nfixed — remove from KNOWN_VIOLATIONS: ${fixed.join(', ')}`)

		// Only once the trace has had its say: a setup that failed for a reason
		// the contract does not describe still has to fail the run, but the
		// findings above are the better explanation when there are any.
		assert.equal(setupError, undefined, `${setupError?.message}\n\n${rendered}`)

		// The session has to have got far enough to be worth judging. `LC-004`
		// is the one that fails when a socket pairs and never announces, so a
		// run that left even that unexercised proves nothing.
		assert.equal(unexercisedInvariants(report).includes('LC-004'), false, rendered)
	})
})
