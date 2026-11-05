import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runCommand } from './command.mjs'

for (const failure of ['spawn', 'signal', 'timeout']) {
	test(`command summary retains ${failure} failures before throwing`, () => {
		const out = mkdtempSync(join(tmpdir(), 'scriptc-command-'))
		try {
			const file = failure === 'spawn' ? join(out, 'missing-compiler') : process.execPath
			const args =
				failure === 'signal' ? ['-e', "process.kill(process.pid, 'SIGTERM')"] : ['-e', 'setInterval(() => {}, 1000)']
			assert.throws(() => runCommand(out, [], failure, file, args, failure === 'timeout' ? 100 : 30000))
			const [entry] = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))
			assert.equal(entry.name, failure)
			assert.equal(entry.exit, null)
			if (failure === 'spawn') assert.equal(entry.error.code, 'ENOENT')
			if (failure === 'signal') assert.equal(entry.signal, 'SIGTERM')
			if (failure === 'timeout') assert.equal(entry.error.code, 'ETIMEDOUT')
		} finally {
			rmSync(out, { recursive: true, force: true })
		}
	})
}
