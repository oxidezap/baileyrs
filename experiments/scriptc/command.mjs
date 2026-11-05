import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function runCommand(out, summary, name, file, args, timeout = 600000) {
	const run = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 })
	writeFileSync(resolve(out, `${name}.stdout`), run.stdout ?? '')
	writeFileSync(resolve(out, `${name}.stderr`), run.stderr ?? '')
	summary.push({
		name,
		exit: run.status,
		signal: run.signal,
		error: run.error ? { code: run.error.code, message: run.error.message } : null
	})
	writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2))
	assert.ifError(run.error)
	assert.equal(run.signal, null, `${name} terminated by ${run.signal}`)
	console.log(`${name}: exit ${run.status}`)
	return run
}
