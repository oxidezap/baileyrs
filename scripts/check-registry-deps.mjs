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
 *
 * Plain JavaScript on purpose: `prepublishOnly` must run on every Node.js the
 * package `engines` allow (currently >=22.0.0), and direct `.ts` execution
 * needs type stripping that only became default in 22.18.0.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PREVIEW_SPEC_MARK = 'pkg.pr.new'

/**
 * @typedef {{ name: string, spec: string }} PreviewDependency
 */

/**
 * Runtime dependency specs that point at the preview service.
 * @param {{ dependencies?: Record<string, string> | undefined }} pkg
 * @returns {PreviewDependency[]}
 */
export const findPreviewDependencies = (pkg) =>
	Object.entries(pkg.dependencies ?? {})
		.filter((entry) => typeof entry[1] === 'string' && entry[1].includes(PREVIEW_SPEC_MARK))
		.map(([name, spec]) => ({ name, spec }))

/**
 * @param {string} dir directory holding the package.json to check
 * @returns {PreviewDependency[]}
 */
export const checkPackageDir = (dir) => {
	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
	return findPreviewDependencies(pkg)
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
	const dir = process.argv[2] !== undefined ? resolve(process.argv[2]) : resolve(fileURLToPath(import.meta.url), '..', '..')
	const bad = checkPackageDir(dir)
	if (bad.length > 0) {
		for (const { name, spec } of bad) {
			console.error(`check-registry-deps: ${name} still pins a preview build (${spec})`)
		}
		console.error('check-registry-deps: refusing to publish; switch the dependency to the matching registry release first')
		process.exit(1)
	}
	console.log('check-registry-deps: no preview URLs in runtime dependencies')
}
