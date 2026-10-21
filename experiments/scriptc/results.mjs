import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Every attempt owns a fresh directory, including attempts that fail at startup. */
export function startResults(base, githubOutput = process.env.GITHUB_OUTPUT) {
	mkdirSync(base, { recursive: true })
	const directory = mkdtempSync(join(resolve(base), 'run-'))
	const status = { directory, startedAt: new Date().toISOString(), state: 'running' }
	writeFileSync(join(directory, 'status.json'), JSON.stringify(status, null, 2))
	const pointer = join(base, `.current-${randomUUID()}.json`)
	writeFileSync(pointer, JSON.stringify({ directory }, null, 2))
	renameSync(pointer, join(base, 'current.json'))
	if (githubOutput) {
		// GitHub's multiline format also handles unusual local directory names.
		const delimiter = `results_${randomUUID()}`
		writeFileSync(githubOutput, `results<<${delimiter}\n${directory}\n${delimiter}\n`, { flag: 'a' })
	}
	return {
		directory,
		finish(state, error) {
			writeFileSync(
				join(directory, 'status.json'),
				JSON.stringify(
					{
						...status,
						state,
						finishedAt: new Date().toISOString(),
						...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
					},
					null,
					2
				)
			)
		}
	}
}

export function summarizeResults(directory) {
	if (!directory) return 'Experiment did not start. No current results directory was recorded.'
	const status = JSON.parse(readFileSync(join(directory, 'status.json'), 'utf8'))
	if (status.state !== 'completed') {
		return `Experiment did not finish (${status.state}). Inspect the current run logs; this is not a compatibility pass.`
	}
	return readFileSync(join(directory, 'verdict.txt'), 'utf8').trim()
}
