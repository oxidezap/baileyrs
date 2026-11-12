import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

const git = (...args) =>
	execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
const docs = path =>
	/^(README|CHANGELOG|CONTRIBUTING|AGENTS|SECURITY|CODE_OF_CONDUCT)\.md$/.test(path) ||
	/^docs\/.*\.md$/.test(path) ||
	path === '.release-please-manifest.json'

// Only the package's own version may disappear from the comparison. In particular,
// a transitive package version in the lockfile is a dependency change.
export function sameExceptVersion(path, before, after) {
	const strip = text => {
		const value = JSON.parse(text)
		if (typeof value.version !== 'string') throw new Error('Missing package version')
		delete value.version
		if (path === 'package-lock.json') {
			if (typeof value.packages?.['']?.version !== 'string') throw new Error('Missing lock root version')
			delete value.packages[''].version
		}
		return value
	}
	return isDeepStrictEqual(strip(before), strip(after))
}

export function shouldRun(base, head, pullRequest = false) {
	if (!base || /^0+$/.test(base)) return true
	try {
		const start = pullRequest ? git('merge-base', base, head).trim() : base
		const paths = git('diff', '--no-renames', '--name-only', '-z', start, head).split('\0').filter(Boolean)
		if (!paths.length) return true
		return paths.some(path => {
			if (docs(path)) return false
			if (path !== 'package.json' && path !== 'package-lock.json') return true
			return !sameExceptVersion(path, git('show', `${start}:${path}`), git('show', `${head}:${path}`))
		})
	} catch {
		// Missing history, invalid JSON, deleted manifests and any unreadable diff run all jobs.
		return true
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const run =
		process.env.FULL === 'true' ||
		process.env.EVENT === 'workflow_dispatch' ||
		shouldRun(process.env.BASE, process.env.HEAD, process.env.EVENT === 'pull_request')
	const result = `run=${run}\n`
	appendFileSync(process.env.GITHUB_OUTPUT, result)
	appendFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		`Checks required: ${run}. Only documentation and package version metadata can skip jobs.\n`
	)
	process.stdout.write(result)
}
