/**
 * Error-propagation contract for the file store:
 *  - A critical-store write that fails for ANY reason (ENOTDIR, ENOENT,
 *    ENOSPC, EACCES, EIO) MUST reject — resolving without durable bytes
 *    would silently lose Signal session state while the caller believes
 *    the write succeeded.
 *  - listKeys must not turn a real readdir failure into an empty namespace.
 *    Only ENOENT on readdir (folder genuinely gone) reads as empty.
 *
 * We force deterministic, portable failures by replacing the store folder with
 * a regular FILE: then any path under it fails with ENOTDIR (≠ ENOENT), and
 * removing it entirely yields ENOENT.
 */

import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { useBridgeStore } from '../use-bridge-store.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array | null) => (u ? new TextDecoder().decode(u) : null)

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

	it('critical set REJECTS when the folder is gone (ENOENT): no bytes, no success claim', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-enoent-'))
		const store = await useBridgeStore(dir)
		await rm(dir, { recursive: true, force: true })

		// Folder removed entirely → ENOENT → must reject, not resolve.
		// Resolving here would tell the core a Signal ratchet step is
		// durable when nothing reached disk.
		await assert.rejects(() => store.set(CRITICAL, 'addr', enc('x')), /ENOENT/)
		await rm(dir, { recursive: true, force: true })
	})

	it('critical set retry after ENOENT persists once the folder exists again', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'err-enoent-retry-'))
		const store = await useBridgeStore(dir)
		await rm(dir, { recursive: true, force: true })

		const value = enc('x')
		await assert.rejects(() => store.set(CRITICAL, 'addr', value), /ENOENT/)
		// Identical retry must NOT be skipped: the failure never reached
		// the durable map, so the retry re-attempts and persists.
		await mkdir(dir, { recursive: true })
		await store.set(CRITICAL, 'addr', value)
		assert.equal(dec(await store.get(CRITICAL, 'addr')), 'x')
		await rm(dir, { recursive: true, force: true })
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
