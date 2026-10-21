import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
test('full example initializes real bridge and persists synthetic bytes without network or user auth', () => {
	const cwd = mkdtempSync(join(tmpdir(), 'baileyrs-scriptc-test-'))
	try {
		writeFileSync(join(cwd, 'baileys_auth_info'), 'must never be opened')
		const run = spawnSync(
			process.execPath,
			[
				'--import',
				join(root, 'experiments/scriptc/network-guard.mjs'),
				join(root, 'Example/example.ts'),
				'--offline-smoke'
			],
			{
				cwd,
				encoding: 'utf8',
				timeout: 30000,
				env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TMPDIR: cwd, TMP: cwd, TEMP: cwd }
			}
		)
		assert.equal(run.status, 0, run.stderr.slice(-3000))
		assert.match(run.stdout, /BAILEYRS_OFFLINE_SMOKE_OK.*session and atomic meta/)
		assert.deepEqual(readdirSync(cwd), ['baileys_auth_info'])
		assert.equal(readFileSync(join(cwd, 'baileys_auth_info'), 'utf8'), 'must never be opened')
		for (const option of ['--use-pairing-code', '--use-legacy-store', '--offline-migrate-auth']) {
			const invalid = spawnSync(process.execPath, [join(root, 'Example/example.ts'), '--offline-smoke', option], {
				cwd,
				encoding: 'utf8',
				timeout: 30000
			})
			assert.notEqual(invalid.status, 0)
			assert.match(invalid.stderr, /cannot be combined/)
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true })
	}
})

test('offline smoke fails when the native snapshot lock cannot load', () => {
	const cwd = mkdtempSync(join(tmpdir(), 'baileyrs-scriptc-lock-'))
	try {
		const guard = join(root, 'experiments/scriptc/fixtures/deny-native-lock.mjs')
		const control = spawnSync(
			process.execPath,
			['--import', guard, '--input-type=module', '-e', "await import('fs-native-extensions')"],
			{ cwd: root, encoding: 'utf8', timeout: 30000 }
		)
		assert.notEqual(control.status, 0)
		assert.match(control.stderr, /TEST_NATIVE_LOCK_LOAD_DENIED/)
		const run = spawnSync(
			process.execPath,
			[
				'--import',
				join(root, 'experiments/scriptc/network-guard.mjs'),
				'--import',
				guard,
				join(root, 'Example/example.ts'),
				'--offline-smoke'
			],
			{
				cwd,
				encoding: 'utf8',
				timeout: 30000,
				env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TMPDIR: cwd, TMP: cwd, TEMP: cwd }
			}
		)
		assert.notEqual(run.status, 0)
		assert.match(run.stderr, /TEST_NATIVE_LOCK_LOAD_DENIED/)
		assert.doesNotMatch(run.stdout, /BAILEYRS_OFFLINE_SMOKE_OK/)
		assert.deepEqual(readdirSync(cwd), [])
	} finally {
		rmSync(cwd, { recursive: true, force: true })
	}
})
