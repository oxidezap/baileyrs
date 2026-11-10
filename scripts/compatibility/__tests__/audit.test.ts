import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderCompatibilityReport, runCompatibilityAudit, strictAuditFailed } from '../audit-core.ts'
import { runCli } from '../audit.ts'

const fixtures = resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const localEntry = resolve(fixtures, 'local.d.ts')
const upstreamEntry = resolve(fixtures, 'upstream.d.ts')

describe('compatibility auditor', () => {
	const report = runCompatibilityAudit({ localEntry, upstreamEntry, maxDepth: 4 })
	const hasFinding = (category: string, path: string, status: string) =>
		report.items.some(item => item.category === category && item.path === path && item.status === status)

	it('finds export, field, function, constructor and event gaps', () => {
		assert.ok(hasFinding('exports', 'UpstreamOnly', 'missing'))
		assert.ok(hasFinding('fields', 'Model.optional', 'missing'))
		assert.ok(hasFinding('functions', 'createThing', 'mismatch'))
		assert.ok(hasFinding('functions', 'new Client', 'mismatch'))
		assert.ok(hasFinding('events', 'BaileysEventMap["thing.delete"]', 'missing'))
		assert.ok(hasFinding('events', 'BaileysEventMap["thing.update"].count', 'mismatch'))
		assert.ok(hasFinding('events', 'BaileysEventMap["same-name.update"]', 'mismatch'))
	})

	it('reports bounded percentages and fails strict mode', () => {
		for (const summary of Object.values(report.summary.categories)) {
			assert.ok(summary.coverage >= 0)
			assert.ok(summary.coverage <= 100)
		}
		assert.equal(strictAuditFailed(report), true)
	})

	it('audits only public structure and collapses identical duplicate overloads', () => {
		assert.ok(hasFinding('fields', 'StoreHolder.store.visible', 'matched'))
		assert.ok(hasFinding('functions', 'StoreHolder.store.chain', 'matched'))
		assert.ok(hasFinding('functions', 'DuplicateMethod.validate', 'matched'))
		assert.ok(hasFinding('fields', 'RuntimeMode.FAST', 'matched'))
		assert.ok(hasFinding('fields', 'RuntimeMode.SAFE', 'matched'))
		assert.equal(
			report.items.some(item => item.path.startsWith('RuntimeMode.') && item.status !== 'matched'),
			false
		)
		assert.equal(
			report.items.some(item => item.path.includes('upstreamState')),
			false
		)
		assert.equal(
			report.items.some(item => item.path.includes('upstreamHook')),
			false
		)
		assert.equal(
			report.items.some(item => item.path.includes('localState')),
			false
		)
		assert.equal(
			report.items.some(item => item.path.includes('localHook')),
			false
		)
	})

	it('renders deterministic table, markdown and JSON output', () => {
		for (const format of ['table', 'markdown', 'json'] as const) {
			const first = renderCompatibilityReport(report, { format, details: true, showExtra: true })
			const second = renderCompatibilityReport(report, { format, details: true, showExtra: true })
			assert.equal(second, first)
		}
	})

	it('only-missing excludes matched and extra findings', () => {
		const parsed = JSON.parse(renderCompatibilityReport(report, { format: 'json', onlyMissing: true })) as {
			items: Array<{ status: string }>
		}
		assert.ok(parsed.items.length > 0)
		assert.ok(parsed.items.every(item => item.status === 'missing' || item.status === 'mismatch'))
	})

	it('returns strict CLI status for fixture gaps', () => {
		const stdout = mock.method(process.stdout, 'write', () => true)
		const stderr = mock.method(process.stderr, 'write', () => true)
		try {
			assert.equal(runCli(['--local', localEntry, '--upstream', upstreamEntry, '--strict']), 1)
			assert.equal(runCli(['--local', upstreamEntry, '--upstream', upstreamEntry, '--strict']), 0)
		} finally {
			stdout.mock.restore()
			stderr.mock.restore()
		}
	})
})
