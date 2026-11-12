import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sameExceptVersion, shouldRun } from '../ci/changes.mjs'

const pkg = { name: 'fixture', version: '1.0.0', scripts: { test: 'node --test' } }
const lock = { ...pkg, packages: { '': { version: '1.0.0' }, 'node_modules/dep': { version: '1.0.0' } } }

test('only the root package versions can skip checks', () => {
	for (const [path, value] of [
		['package.json', pkg],
		['package-lock.json', lock]
	]) {
		const changed = structuredClone(value)
		changed.version = '1.1.0'
		if (changed.packages) changed.packages[''].version = '1.1.0'
		assert.equal(sameExceptVersion(path, JSON.stringify(value), JSON.stringify(changed)), true)
		changed.scripts.test = 'echo bypass'
		assert.equal(sameExceptVersion(path, JSON.stringify(value), JSON.stringify(changed)), false)
	}
	const changed = structuredClone(lock)
	changed.packages['node_modules/dep'].version = '2.0.0'
	assert.equal(sameExceptVersion('package-lock.json', JSON.stringify(lock), JSON.stringify(changed)), false)
})

test('git matrix covers docs, releases, dependencies, renames, history and PR merge bases', () => {
	const original = process.cwd()
	const dir = mkdtempSync(join(tmpdir(), 'ci-changes-'))
	const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
	try {
		process.chdir(dir)
		git('init', '-q', '-b', 'main')
		git('config', 'user.email', 'fixture@example.invalid')
		git('config', 'user.name', 'CI fixture')
		const put = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
		put('package.json', pkg)
		put('package-lock.json', lock)
		put('README.md', 'base')
		put('code.ts', 'base')
		git('add', '.')
		git('commit', '-qm', 'base')
		const base = git('rev-parse', 'HEAD')
		const check = (path, value, expected) => {
			git('reset', '--hard', base)
			put(path, value)
			git('add', '.')
			git('commit', '-qm', 'case')
			assert.equal(shouldRun(base, 'HEAD'), expected, path)
		}
		check('README.md', 'docs', false)
		check('package.json', { ...pkg, version: '1.1.0' }, false)
		check('package.json', { ...pkg, dependencies: { dep: '2' } }, true)
		check('package-lock.json', { ...lock, packages: { ...lock.packages, 'node_modules/dep': { version: '2' } } }, true)
		check('package.json', '{broken', true)
		check('code.ts', 'new code', true)
		mkdirSync('.github/workflows', { recursive: true })
		check('.github/workflows/ci.yml', 'workflow', true)
		check('unknown.txt', 'unknown', true)
		git('reset', '--hard', base)
		git('mv', 'code.ts', 'CHANGELOG.md')
		git('commit', '-qm', 'rename code to docs')
		assert.equal(shouldRun(base, 'HEAD'), true)
		git('reset', '--hard', base)
		git('rm', 'package.json')
		git('commit', '-qm', 'delete manifest')
		assert.equal(shouldRun(base, 'HEAD'), true)
		assert.equal(shouldRun(base, base), true)
		assert.equal(shouldRun('', 'HEAD'), true)
		assert.equal(shouldRun('0000000000000000000000000000000000000000', 'HEAD'), true)
		assert.equal(shouldRun('unavailable', 'HEAD'), true)
		// Main advancing must not hide branch code behind a docs-only last commit.
		git('reset', '--hard', base)
		git('checkout', '-qb', 'topic')
		put('code.ts', 'branch code')
		git('commit', '-qam', 'code')
		put('README.md', 'branch docs')
		git('commit', '-qam', 'docs')
		git('checkout', '-q', 'main')
		put('README.md', 'main docs')
		git('commit', '-qam', 'main docs')
		assert.equal(shouldRun('main', 'topic', true), true)
		// More than the compare API limit must still inspect the entire git diff.
		git('checkout', '-q', 'topic')
		git('reset', '--hard', base)
		mkdirSync('docs', { recursive: true })
		for (let i = 0; i < 350; i++) put(`docs/file-${i}.md`, 'docs')
		git('add', '.')
		git('commit', '-qm', 'many files')
		assert.equal(shouldRun(base, 'HEAD', true), false)
		put('code.ts', 'hidden behind many docs')
		git('commit', '-qam', 'code after docs')
		assert.equal(shouldRun(base, 'HEAD', true), true)
	} finally {
		process.chdir(original)
		rmSync(dir, { recursive: true, force: true })
	}
})
