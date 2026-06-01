/**
 * Error-propagation contract for the file store (Codex review fixes):
 *  - A critical-store write that fails for a REAL reason (not the folder being
 *    gone) MUST reject — swallowing it silently loses Signal session state.
 *  - The folder genuinely being gone (ENOENT, shutdown race) is tolerated.
 *  - listKeys must not turn a real readdir failure into an empty namespace.
 *
 * We force deterministic, portable failures by replacing the store folder with
 * a regular FILE: then any path under it fails with ENOTDIR (≠ ENOENT), and
 * removing it entirely yields ENOENT.
 */

import { strict as assert } from 'node:assert'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { useBridgeStore } from '../use-bridge-store.ts'

const enc = (s: string) => new TextEncoder().encode(s)

// `session` is a CRITICAL store (immediate write); `msg_secret` is not.
const CRITICAL = 'session'

describe('useBridgeStore — error propagation', () => {
	it('critical set REJECTS on a real write failure (ENOTDIR)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-set-'))
		const store = await useBridgeStore(dir)
		// Turn the folder into a file → writes under it fail with ENOTDIR.
		await rm(dir, { recursive: true, force: true })
		await writeFile(dir, 'not a dir')

		await assert.rejects(() => store.set(CRITICAL, 'addr', enc('ratchet')), /ENOTDIR/)
		await rm(dir, { force: true })
	})

	it('critical setMany REJECTS on a real write failure (ENOTDIR)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-setmany-'))
		const store = await useBridgeStore(dir)
		await rm(dir, { recursive: true, force: true })
		await writeFile(dir, 'not a dir')

		await assert.rejects(
			() =>
				store.setMany!(CRITICAL, [
					['a', enc('1')],
					['b', enc('2')]
				]),
			/ENOTDIR/
		)
		await rm(dir, { force: true })
	})

	it('critical set TOLERATES the folder being gone (ENOENT, shutdown race)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-enoent-'))
		const store = await useBridgeStore(dir)
		await rm(dir, { recursive: true, force: true })

		// Folder removed entirely → ENOENT → must resolve, not throw.
		await store.set(CRITICAL, 'addr', enc('x'))
	})

	it('listKeys PROPAGATES a real readdir failure (ENOTDIR), not empty', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-list-'))
		const store = await useBridgeStore(dir)
		await rm(dir, { recursive: true, force: true })
		await writeFile(dir, 'not a dir')

		await assert.rejects(() => store.listKeys!('msg_secret'), /ENOTDIR/)
		await rm(dir, { force: true })
	})

	it('listKeys returns empty when the folder is simply gone (ENOENT)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-list-enoent-'))
		const store = await useBridgeStore(dir)
		await rm(dir, { recursive: true, force: true })

		assert.deepEqual(await store.listKeys!('msg_secret'), [])
	})
})
