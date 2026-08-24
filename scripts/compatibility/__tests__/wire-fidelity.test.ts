import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { PROTO_MESSAGE_SCHEMAS } from '../../../src/WAProto/compatibility-schema.ts'
import {
	auditWireFidelity,
	buildFieldCases,
	buildFuzzCases,
	divergentPaths,
	fidelityAuditFailed,
	renderFidelityReport
} from '../wire-fidelity-core.ts'
import { runCli } from '../wire-fidelity-audit.ts'

const SEED = 20260808

/**
 * `pollResultSnapshotMessageV3` sits at field 115 in the bridge proto and 114 in
 * baileys 7.0.0-rc13. Both codecs read their own bytes, so it is a schema gap
 * rather than a send-path one; pinned here so a second divergence fails.
 *
 * 115 is the conforming number: WhatsApp Web's own field table assigns it there
 * and leaves 114 unassigned — see `proto-field-number-mismatch` in
 * src/__fuzz__/harness/divergence.ts for the citation. The gap closes when
 * upstream regenerates its proto, so this stays a divergence rather than
 * something to match.
 */
const KNOWN_DIVERGENT = ['pollResultSnapshotMessageV3']

const contextInfoFields = (
	PROTO_MESSAGE_SCHEMAS.find(([path]) => path === 'MessageContextInfo')?.[1] ?? []
).map(field => field[0])

describe('send-path wire fidelity auditor', () => {
	it('finds nothing dropped or altered on the current send path', async () => {
		const report = await auditWireFidelity([...buildFieldCases(), ...buildFuzzCases(SEED, 200)])
		assert.equal(report.summary.dropped, 0, renderFidelityReport(report, true))
		assert.equal(report.summary.altered, 0, renderFidelityReport(report, true))
		assert.equal(fidelityAuditFailed(report), false)
		assert.ok(report.summary.preserved > 500)
	})

	it('exercises every messageContextInfo field', async () => {
		const report = await auditWireFidelity(buildFieldCases())
		const preserved = new Set(
			report.findings.filter(finding => finding.status === 'preserved').map(finding => finding.path)
		)
		for (const field of contextInfoFields) {
			assert.ok(preserved.has(`messageContextInfo.${field}`), `messageContextInfo.${field} was not exercised`)
		}
	})

	// The auditor exists to catch the send path deleting messageContextInfo, so
	// it has to fail when handed a sender that does exactly that.
	it('reports a sender that deletes messageContextInfo', async () => {
		const report = await auditWireFidelity(buildFieldCases(), async message => {
			const copy = structuredClone(message)
			delete copy.messageContextInfo
			return encodeProto('Message', copy)
		})
		assert.ok(fidelityAuditFailed(report))
		const dropped = new Set(
			report.findings.filter(finding => finding.status === 'dropped').map(finding => finding.path)
		)
		assert.ok(dropped.has('messageContextInfo.messageAssociation'))
		assert.ok(dropped.has('messageContextInfo.messageAddOnDurationInSecs'))
		// The container case from the Message sweep plus one case per nested field.
		const expected = ['messageContextInfo', ...contextInfoFields.map(field => `messageContextInfo.${field}`)]
		assert.deepEqual([...dropped].toSorted(), expected.toSorted())
	})

	it('fails when the send path throws instead of reporting the case as skipped', async () => {
		const report = await auditWireFidelity(buildFieldCases().slice(0, 3), async () => {
			throw new Error('relay API regression')
		})
		assert.ok(fidelityAuditFailed(report))
		assert.equal(report.summary.errored, 3)
		assert.equal(report.summary.skipped, 0)
	})

	it('separates the known codec divergence from send-path findings', async () => {
		const report = await auditWireFidelity(buildFieldCases())
		assert.deepEqual(divergentPaths(report).toSorted(), KNOWN_DIVERGENT.toSorted())
	})

	it('rejects a zero seed rather than running a different one', async () => {
		await assert.rejects(() => runCli(['--seed=0']), /non-zero integer/u)
		assert.throws(() => buildFuzzCases(0, 1), /non-zero integer/u)
	})

	it('runs clean under --strict and prints the seed', async () => {
		const written: string[] = []
		const write = process.stdout.write.bind(process.stdout)
		process.stdout.write = (chunk: string | Uint8Array) => {
			written.push(String(chunk))
			return true
		}
		try {
			assert.equal(await runCli(['--fuzz=25', `--seed=${SEED}`, '--strict']), 0)
		} finally {
			process.stdout.write = write
		}
		assert.match(written.join(''), /fuzz seed: 20260808/u)
	})
})
