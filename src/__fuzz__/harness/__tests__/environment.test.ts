import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'

it('keeps harness self-tests independent of the fuzz job environment', () => {
	const originalEnvironment = { ...process.env }
	const directory = mkdtempSync(join(tmpdir(), 'baileyrs-harness-'))
	try {
		// Recording must be safe even before isolation works. Copy only the inert
		// harness; its corpus path will resolve inside this temporary directory.
		cpSync(new URL('../', import.meta.url), join(directory, 'harness'), { recursive: true })
		const environment = Object.fromEntries(
			Object.entries(process.env).filter(([name]) => !name.startsWith('FUZZ_') && name !== 'NODE_TEST_CONTEXT')
		)
		const cases: NodeJS.ProcessEnv[] = [
			{}, // Reporting alone must not leak synthetic findings from passing tests.
			{ FUZZ_MODE: 'deep' },
			{ FUZZ_RUNS: '2', FUZZ_SEED: 'self-test-seed' },
			{ FUZZ_ONLY: 'a-real-target-not-the-self-tests' },
			{ FUZZ_RECORD: '1' },
			{ FUZZ_STRICT_ALLOWLIST: '1' },
			{ FUZZ_MODE: 'invalid', FUZZ_DEEP_FACTOR: 'invalid', FUZZ_TIME_BUDGET_MS: 'invalid' }
		]
		const failures: string[] = []
		for (const [index, overrides] of cases.entries()) {
			rmSync(join(directory, 'corpus'), { recursive: true, force: true })
			const reports = join(directory, `reports-${index}`)
			mkdirSync(reports)
			const result = spawnSync(
				process.execPath,
				[
					'--test',
					'--test-reporter=tap',
					'--test-name-pattern=minimising is for findings',
					join(directory, 'harness/__tests__/harness.test.ts')
				],
				{
					env: { ...environment, ...overrides, FUZZ_REPORT_DIR: reports },
					encoding: 'utf8',
					timeout: 30_000
				}
			)
			try {
				assert.ifError(result.error)
				assert.equal(result.status, 0, result.stdout + result.stderr)
				assert.match(result.stdout, /# tests 2\b/u, 'both runner self-tests must execute')
				assert.deepEqual(readdirSync(reports), [], 'self-tests must not write job reports')
				assert.deepEqual(
					readdirSync(directory).filter(name => name === 'corpus'),
					[],
					'self-tests must not record a corpus'
				)
			} catch (error) {
				failures.push(`${JSON.stringify(overrides)}: ${String(error)}`)
			}
		}
		assert.ok(
			Object.keys(process.env).length === Object.keys(originalEnvironment).length &&
				Object.entries(originalEnvironment).every(([name, value]) => process.env[name] === value),
			'the parent environment must not change'
		)
		assert.deepEqual(failures, [])
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
