import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const worker = fileURLToPath(new URL('./restart-worker.ts', import.meta.url))
const testFlagsWithValue = new Set([
	'--test-concurrency',
	'--test-coverage-branches',
	'--test-coverage-exclude',
	'--test-coverage-functions',
	'--test-coverage-include',
	'--test-coverage-lines',
	'--test-name-pattern',
	'--test-reporter',
	'--test-reporter-destination',
	'--test-shard',
	'--test-skip-pattern',
	'--test-timeout'
])

const filterTestRunnerArgs = (args: string[]): string[] => {
	const runtimeArgs: string[] = []
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!
		if (arg === '--test' || arg.startsWith('--test-')) {
			if (testFlagsWithValue.has(arg) && !arg.includes('=')) index++
			continue
		}
		runtimeArgs.push(arg)
	}
	return runtimeArgs
}

async function generation(folder: string, format: string, phase: string, signal: 'SIGINT' | 'SIGKILL') {
	const runtime = process.env.BAILEYRS_RESTART_RUNTIME
	const args = runtime
		? [worker, phase, folder, format]
		: [...filterTestRunnerArgs(process.execArgv), worker, phase, folder, format]
	const child = spawn(runtime ?? process.execPath, args, {
		env: process.env,
		stdio: ['pipe', 'pipe', 'pipe']
	})
	let output = ''
	let errors = ''
	let ready: { phase: string; qrCounts: number[]; opens: number[]; stages: string[] } | undefined
	let timedOut = false
	const deadline = setTimeout(() => {
		timedOut = true
		child.kill('SIGKILL')
	}, 100_000)
	try {
		await new Promise<void>((resolve, reject) => {
			child.on('error', reject)
			child.stderr.on('data', chunk => {
				errors += chunk.toString()
			})
			child.stdout.on('data', chunk => {
				output += chunk.toString()
				const line = output.split('\n').find(value => value.startsWith('RESTART_READY ') && value.endsWith('}'))
				if (!ready && line) {
					try {
						ready = JSON.parse(line.slice('RESTART_READY '.length))
						child.kill(signal)
					} catch (error) {
						reject(error)
					}
				}
			})
			child.on('close', (code, receivedSignal) => {
				if (timedOut || !ready || (signal === 'SIGINT' ? code !== 0 : receivedSignal !== 'SIGKILL')) {
					reject(
						new Error(
							`${phase}/${format}: code=${code}, signal=${receivedSignal}, timeout=${timedOut}\n${errors}\n${output}`
						)
					)
				} else resolve()
			})
		})
		assert.ok(ready)
		assert.deepEqual(ready.opens, [1, 1, 1, 1])
		assert.deepEqual(ready.stages, Array(4).fill('traffic-ok'))
		if (phase === 'restore') assert.deepEqual(ready.qrCounts, [0, 0, 0, 0])
	} finally {
		clearTimeout(deadline)
		if (child.exitCode === null && child.signalCode === null) {
			const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
			child.kill('SIGKILL')
			await closed
		}
	}
}

describe('E2E: four sessions across process restarts', { timeout: 300_000 }, () => {
	it('inherits Node loader flags without forwarding test-runner arguments', () => {
		assert.deepEqual(
			filterTestRunnerArgs([
				'--expose-gc',
				'--test',
				'--test-concurrency',
				'1',
				'--import',
				'tsx/esm',
				'--test-reporter=spec'
			]),
			['--expose-gc', '--import', 'tsx/esm']
		)
	})

	for (const format of ['native', 'legacy']) {
		const restoreSignal = format === 'native' ? 'SIGKILL' : 'SIGINT'
		it(`restores ${format} auth without QR and decrypts traffic after ${restoreSignal}`, async () => {
			const folder = await mkdtemp(join(tmpdir(), `baileyrs-process-${format}-`))
			try {
				await generation(folder, format, 'seed', 'SIGINT')
				await generation(folder, format, 'restore', restoreSignal)
			} finally {
				await rm(folder, { recursive: true, force: true })
			}
		})
	}
	it('restores native auth after SIGKILL at a completed durability checkpoint', async () => {
		const folder = await mkdtemp(join(tmpdir(), 'baileyrs-process-kill-'))
		try {
			await generation(folder, 'native', 'seed', 'SIGKILL')
			await generation(folder, 'native', 'restore', 'SIGKILL')
		} finally {
			await rm(folder, { recursive: true, force: true })
		}
	})
})
