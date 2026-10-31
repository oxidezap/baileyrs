import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { startResults, summarizeResults } from './results.mjs'

const root = resolve(import.meta.dirname, '../..')
test('a failed rerun selects fresh evidence instead of a previous verdict or binary', () => {
	const base = mkdtempSync(join(tmpdir(), 'scriptc-results-regression-'))
	try {
		const previous = startResults(base, '')
		writeFileSync(join(previous.directory, 'verdict.txt'), 'OLD SUCCESS VERDICT')
		writeFileSync(join(previous.directory, 'bridge'), 'OLD BINARY')
		previous.finish('completed')
		assert.equal(summarizeResults(previous.directory), 'OLD SUCCESS VERDICT')
		assert.match(summarizeResults(''), /did not start/)
		let last = previous.directory
		for (let attempt = 0; attempt < 2; attempt++) {
			const githubOutput = join(base, `github-output-${attempt}`)
			const run = spawnSync(process.execPath, [join(root, 'experiments/scriptc/run.mjs')], {
				cwd: root,
				encoding: 'utf8',
				timeout: 30000,
				env: { ...process.env, SCRIPTC: process.execPath, SCRIPTC_RESULTS: base, GITHUB_OUTPUT: githubOutput }
			})
			// Node's version is deliberately not scriptc 0.4.0, so startup fails.
			assert.equal(run.status, 1, run.stderr)
			const current = JSON.parse(readFileSync(join(base, 'current.json'), 'utf8')).directory
			assert.notEqual(current, last)
			assert.equal(JSON.parse(readFileSync(join(current, 'status.json'), 'utf8')).state, 'failed')
			assert.ok(existsSync(join(current, 'compiler-version.stdout')))
			assert.equal(existsSync(join(current, 'verdict.txt')), false)
			assert.equal(existsSync(join(current, 'bridge')), false)
			const outputLines = readFileSync(githubOutput, 'utf8').trimEnd().split('\n')
			assert.match(outputLines[0], /^results<</)
			assert.equal(outputLines[1], current)
			assert.equal(outputLines[2], outputLines[0].slice('results<<'.length))
			assert.match(summarizeResults(current), /did not finish \(failed\)/)
			// A stray verdict must not override the recorded failed status.
			writeFileSync(join(current, 'verdict.txt'), 'STALE VERDICT')
			assert.doesNotMatch(summarizeResults(current), /STALE VERDICT/)
			last = current
		}
		assert.equal(readFileSync(join(previous.directory, 'bridge'), 'utf8'), 'OLD BINARY')
	} finally {
		rmSync(base, { recursive: true, force: true })
	}
})
