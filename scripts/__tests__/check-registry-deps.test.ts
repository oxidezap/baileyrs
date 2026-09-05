/**
 * The release guard only ever reads a package manifest and exits — it has no
 * publish path, so these tests can drive the real CLI entrypoint in a child
 * process without any risk of publishing. Each case points the guard at a
 * synthetic fixture directory, never at the repository itself.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'

import { expect } from '../../src/__tests__/expect.ts'
import { findPreviewDependencies } from '../check-registry-deps.mjs'

const guard = resolve(import.meta.dirname, '..', 'check-registry-deps.mjs')

const runGuard = (dir: string): Promise<{ code: number | null; stdout: string; stderr: string }> =>
	new Promise(resolvePromise => {
		execFile(process.execPath, [guard, dir], { timeout: 30_000 }, (error, stdout, stderr) => {
			resolvePromise({
				code: error && 'code' in error ? (error.code as number) : 0,
				stdout: String(stdout),
				stderr: String(stderr)
			})
		})
	})

const fixtureDir = async (pkg: unknown): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), 'baileyrs-guard-'))
	await writeFile(join(dir, 'package.json'), JSON.stringify(pkg))
	return dir
}

describe('check-registry-deps release guard', { timeout: 60_000 }, () => {
	it('rejects a runtime dependency pinned to a preview URL', async () => {
		const dir = await fixtureDir({
			dependencies: {
				'@oxidezap/whatsapp-rust-bridge': 'https://pkg.pr.new/@oxidezap/whatsapp-rust-bridge@4f5fbb8'
			}
		})
		try {
			const { code, stderr } = await runGuard(dir)
			expect(code).toBe(1)
			expect(stderr).toContain('@oxidezap/whatsapp-rust-bridge')
			expect(stderr).toContain('registry release')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('allows a registry version for the same dependency', async () => {
		const dir = await fixtureDir({
			dependencies: { '@oxidezap/whatsapp-rust-bridge': '0.20.1' }
		})
		try {
			const { code, stdout } = await runGuard(dir)
			expect(code).toBe(0)
			expect(stdout).toContain('no preview URLs')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('ignores preview URLs outside runtime dependencies', async () => {
		const dir = await fixtureDir({
			dependencies: { '@oxidezap/whatsapp-rust-bridge': '0.20.1' },
			devDependencies: { 'some-tool': 'https://pkg.pr.new/some-tool@12' }
		})
		try {
			const { code } = await runGuard(dir)
			expect(code).toBe(0)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('lists every preview-pinned runtime dependency', () => {
		expect(
			findPreviewDependencies({
				dependencies: {
					a: 'https://pkg.pr.new/a@1',
					b: '^2.0.0',
					c: 'https://pkg.pr.new/c@3'
				}
			}).map(entry => entry.name)
		).toEqual(['a', 'c'])
	})
})
