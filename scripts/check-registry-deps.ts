/**
 * Release guard: refuse an official npm publication while a runtime
 * dependency still pins a `pkg.pr.new` preview URL.
 *
 * Preview tarballs are only guaranteed to resolve while the preview service
 * keeps them; a published package pointing at one can stop installing at any
 * time. The guard is deliberately narrow — runtime `dependencies` only, never
 * `devDependencies` — and it runs explicitly in the release workflow (which
 * publishes with `--ignore-scripts`, so no npm hook would fire there) plus
 * through `prepublishOnly` for ad-hoc local publishes. `npm pack` runs
 * neither, so `prepack` and the pkg.pr.new preview CI stay green.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..')

export const PREVIEW_SPEC_MARK = 'pkg.pr.new'

export interface PreviewDependency {
	name: string
	spec: string
}

/** Runtime dependency specs that point at the preview service. */
export const findPreviewDependencies = (pkg: {
	dependencies?: Record<string, string> | undefined
}): PreviewDependency[] =>
	Object.entries(pkg.dependencies ?? {})
		.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].includes(PREVIEW_SPEC_MARK))
		.map(([name, spec]) => ({ name, spec }))

export const checkPackageDir = (dir: string): PreviewDependency[] => {
	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string> | undefined
	}
	return findPreviewDependencies(pkg)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const dir = process.argv[2] ? resolve(process.argv[2]) : repoRoot
	const bad = checkPackageDir(dir)
	if (bad.length > 0) {
		for (const { name, spec } of bad) {
			console.error(`check-registry-deps: ${name} still pins a preview build (${spec})`)
		}
		console.error(
			'check-registry-deps: refusing to publish; switch the dependency to the matching registry release first'
		)
		process.exit(1)
	}
	console.log('check-registry-deps: no preview URLs in runtime dependencies')
}
