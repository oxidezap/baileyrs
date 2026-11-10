/**
 * Publish guard: fails when the npm tarball would ship duplicated content or
 * sourcemaps (they point at ../../src, which is not published).
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const minDupBytes = 4096

const packed = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { cwd: root, encoding: 'utf8' }))
const files: string[] = packed[0].files.map((f: { path: string }) => f.path)

const errors: string[] = []

for (const path of files) {
	if (path.endsWith('.map')) {
		errors.push(`sourcemap in tarball: ${path}`)
	}
}

const byHash = new Map<string, string[]>()
for (const path of files) {
	const bytes = readFileSync(join(root, path))
	if (bytes.length < minDupBytes) continue
	const hash = createHash('sha256').update(bytes).digest('hex')
	byHash.set(hash, [...(byHash.get(hash) ?? []), path])
}
for (const paths of byHash.values()) {
	if (paths.length > 1) {
		errors.push(`duplicated content in tarball: ${paths.join(' == ')}`)
	}
}

if (errors.length > 0) {
	console.error(errors.map(e => `check-pack: ${e}`).join('\n'))
	process.exit(1)
}
console.log(`check-pack: ${files.length} files, no duplicates`)
