/**
 * Durability contract for the file store:
 *  - failure → identical retry re-attempts and persists (set, setMany, flush)
 *  - setMany stays best-effort across keys with idempotent retry
 *  - failed flushes keep pending work and propagate the error
 *  - reads/deletes surface real errors; only absence is tolerated
 *  - concurrent ops on one key serialize (set→delete, delete→set, flush)
 *  - caller buffers and returned values are copies (no mutable aliasing)
 *  - atomic replacement keeps the previous file intact across failures
 *
 * All faults go through the real `useBridgeStore` callbacks: filesystem
 * states (ENOTDIR/ENOENT) for end-to-end failures and the
 * `__testBridgeStoreIO` seam for write/rename-stage injection.
 */

import { strict as assert } from 'node:assert'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { __testBridgeStoreIO, useBridgeStore } from '../use-bridge-store.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array | null) => (u ? new TextDecoder().decode(u) : null)

// `session` is a CRITICAL store (immediate durable write);
// `msg_secret` is not (debounced, flush makes it durable).
const CRITICAL = 'session'
const NON_CRITICAL = 'msg_secret'

const asFile = async (dir: string) => {
	await rm(dir, { recursive: true, force: true })
	await writeFile(dir, 'not a directory')
}

const asDir = async (dir: string) => {
	await rm(dir, { force: true })
	await mkdir(dir, { recursive: true })
}

const codedError = (message: string, code: string): NodeJS.ErrnoException => {
	const err = new Error(message) as NodeJS.ErrnoException
	err.code = code
	return err
}

describe('useBridgeStore — durability', () => {
	it('critical set failure → identical retry persists (no skip-after-failure)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-set-'))
		try {
			const store = await useBridgeStore(dir)
			const value = enc('ratchet-1')
			await asFile(dir)
			await assert.rejects(() => store.set(CRITICAL, 'addr', value), /ENOTDIR/)
			// No torn file left behind by the failed write (ENOTDIR: the
			// folder itself is a file here; ENOENT once it is removed).
			await assert.rejects(() => access(join(dir, `${CRITICAL}-addr.bin`)), /ENO(TDIR|ENT)/)

			await asDir(dir)
			await store.set(CRITICAL, 'addr', value)
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-addr.bin`)), Buffer.from(value))

			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(CRITICAL, 'addr')), 'ratchet-1')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('critical setMany failure → identical retry persists', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-setmany-'))
		try {
			const store = await useBridgeStore(dir)
			const entries: [string, Uint8Array][] = [
				['a', enc('1')],
				['b', enc('2')]
			]
			await asFile(dir)
			await assert.rejects(() => store.setMany!(CRITICAL, entries), /ENOTDIR/)

			await asDir(dir)
			await store.setMany!(CRITICAL, entries)
			assert.equal(dec(await store.get(CRITICAL, 'a')), '1')
			assert.equal(dec(await store.get(CRITICAL, 'b')), '2')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('setMany is best-effort across keys: one key fails, siblings persist, retry completes', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-besteffort-'))
		const origWrite = __testBridgeStoreIO.writeTmp
		try {
			const store = await useBridgeStore(dir)
			__testBridgeStoreIO.writeTmp = async (tmpPath, value) => {
				if (tmpPath.includes(`${CRITICAL}-bad`)) throw codedError('injected write failure', 'EIO')
				return origWrite(tmpPath, value)
			}

			const entries: [string, Uint8Array][] = [
				['good', enc('g')],
				['bad', enc('b')]
			]
			await assert.rejects(() => store.setMany!(CRITICAL, entries), /injected write failure/)
			// Best-effort: the sibling was still applied.
			assert.equal(dec(await store.get(CRITICAL, 'good')), 'g')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-good.bin`)), Buffer.from(enc('g')))

			__testBridgeStoreIO.writeTmp = origWrite
			// Idempotent retry: `good` is already durable (skipped), `bad` is
			// re-attempted and now persists.
			await store.setMany!(CRITICAL, entries)
			assert.equal(dec(await store.get(CRITICAL, 'bad')), 'b')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-bad.bin`)), Buffer.from(enc('b')))
		} finally {
			__testBridgeStoreIO.writeTmp = origWrite
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('failed flush keeps pending work, throws again, and persists on retry', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-flush-'))
		try {
			const store = await useBridgeStore(dir)
			await store.set(NON_CRITICAL, 'a', enc('v'))

			await asFile(dir)
			await assert.rejects(() => store.flush!(), /ENOTDIR/)
			// Retained: a second flush re-attempts instead of resolving empty.
			await assert.rejects(() => store.flush!(), /ENOTDIR/)

			await asDir(dir)
			await store.flush!()
			assert.deepEqual(await readFile(join(dir, `${NON_CRITICAL}-a.bin`)), Buffer.from(enc('v')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('non-critical set while the folder is gone queues honestly: flush reports ENOENT, later flush persists', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-queued-'))
		try {
			const store = await useBridgeStore(dir)
			await rm(dir, { recursive: true, force: true })

			// Queueing is not durability: set resolves, flush must not claim
			// the bytes reached disk.
			await store.set(NON_CRITICAL, 'a', enc('v'))
			assert.equal(dec(await store.get(NON_CRITICAL, 'a')), 'v')
			await assert.rejects(() => store.flush!(), /ENOENT/)

			await mkdir(dir, { recursive: true })
			await store.flush!()
			assert.deepEqual(await readFile(join(dir, `${NON_CRITICAL}-a.bin`)), Buffer.from(enc('v')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('reads surface real errors but return null for absent keys', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-read-'))
		try {
			const store = await useBridgeStore(dir)
			assert.equal(await store.get(CRITICAL, 'missing'), null)
			assert.deepEqual(await store.getMany!(CRITICAL, ['missing']), [])

			await asFile(dir)
			await assert.rejects(() => store.get(CRITICAL, 'k'), /ENOTDIR/)
			await assert.rejects(() => store.getMany!(CRITICAL, ['k']), /ENOTDIR/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('deletes surface real errors but tolerate absent keys', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-del-'))
		try {
			const store = await useBridgeStore(dir)
			await store.delete(CRITICAL, 'missing')
			await store.deleteMany!(CRITICAL, [])

			await asFile(dir)
			await assert.rejects(() => store.delete(CRITICAL, 'k'), /ENOTDIR/)
			await assert.rejects(() => store.deleteMany!(CRITICAL, ['k']), /ENOTDIR/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('set→delete serializes: delete waits for the in-flight write and the key stays gone', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-setdel-'))
		const origWrite = __testBridgeStoreIO.writeTmp
		let release!: () => void
		try {
			const store = await useBridgeStore(dir)
			__testBridgeStoreIO.writeTmp = async (tmpPath, value) => {
				await new Promise<void>(resolve => {
					release = resolve
				})
				return origWrite(tmpPath, value)
			}

			const first = store.set(CRITICAL, 'k', enc('one'))
			await new Promise(resolve => setTimeout(resolve, 50))
			let deleteDone = false
			const del = store.delete(CRITICAL, 'k').then(() => {
				deleteDone = true
			})
			await new Promise(resolve => setTimeout(resolve, 100))
			// The delete could not overtake the gated write.
			assert.equal(deleteDone, false)
			release()
			await first
			await del

			assert.equal(await store.get(CRITICAL, 'k'), null)
			await assert.rejects(() => access(join(dir, `${CRITICAL}-k.bin`)), /ENOENT/)
		} finally {
			__testBridgeStoreIO.writeTmp = origWrite
			release?.()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('delete→set serializes: the later write wins and is never resurrected over', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-delset-'))
		try {
			const store = await useBridgeStore(dir)
			await store.set(CRITICAL, 'k', enc('seed'))
			await store.delete(CRITICAL, 'k')
			assert.equal(await store.get(CRITICAL, 'k'), null)

			await store.set(CRITICAL, 'k', enc('new'))
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'new')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('new')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('concurrent sets on one key serialize: the last scheduled value wins', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-conc-'))
		const origWrite = __testBridgeStoreIO.writeTmp
		let release!: () => void
		try {
			const store = await useBridgeStore(dir)
			__testBridgeStoreIO.writeTmp = async (tmpPath, value) => {
				await new Promise<void>(resolve => {
					release = resolve
				})
				return origWrite(tmpPath, value)
			}

			const first = store.set(CRITICAL, 'k', enc('one'))
			await new Promise(resolve => setTimeout(resolve, 50))
			const second = store.set(CRITICAL, 'k', enc('two'))
			await new Promise(resolve => setTimeout(resolve, 50))
			release()
			await first
			__testBridgeStoreIO.writeTmp = origWrite
			await second

			assert.equal(dec(await store.get(CRITICAL, 'k')), 'two')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('two')))
		} finally {
			__testBridgeStoreIO.writeTmp = origWrite
			release?.()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('mutating the caller buffer after set does not change persisted bytes', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-snap-'))
		try {
			const store = await useBridgeStore(dir)
			const buf = enc('orig')
			await store.set(CRITICAL, 'k', buf)
			buf.fill(0)

			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(CRITICAL, 'k')), 'orig')

			// Same for debounced writes: the queued snapshot is immune too.
			const buf2 = enc('queued')
			await store.set(NON_CRITICAL, 'q', buf2)
			buf2.fill(0)
			await store.flush!()
			assert.deepEqual(await readFile(join(dir, `${NON_CRITICAL}-q.bin`)), Buffer.from(enc('queued')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('get returns a copy: mutating it neither poisons the cache nor skips the next write', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-alias-'))
		try {
			const store = await useBridgeStore(dir)
			await store.set(CRITICAL, 'k', enc('aaaa'))

			const viewed = await store.get(CRITICAL, 'k')
			assert.ok(viewed)
			viewed.fill(0)
			// Cache untouched — the next read still sees durable bytes.
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'aaaa')

			// The mutated buffer is genuinely new data → the write happens.
			await store.set(CRITICAL, 'k', viewed)
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(viewed))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('rename-stage failure leaves the previous file intact and retryable', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-atomic-'))
		const origPublish = __testBridgeStoreIO.publishTmp
		try {
			const store = await useBridgeStore(dir)
			await store.set(CRITICAL, 'k', enc('old'))

			let failOnce = true
			__testBridgeStoreIO.publishTmp = async (tmpPath, finalPath) => {
				if (failOnce) {
					failOnce = false
					throw codedError('injected rename failure', 'EIO')
				}
				return origPublish(tmpPath, finalPath)
			}
			await assert.rejects(() => store.set(CRITICAL, 'k', enc('new')), /injected rename failure/)
			// Previous intact file still on disk — never torn.
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('old')))

			__testBridgeStoreIO.publishTmp = origPublish
			await store.set(CRITICAL, 'k', enc('new'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('new')))

			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(CRITICAL, 'k')), 'new')
		} finally {
			__testBridgeStoreIO.publishTmp = origPublish
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('write-stage failure rejects, leaves no torn file, and retry persists', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-write-'))
		const origWrite = __testBridgeStoreIO.writeTmp
		try {
			const store = await useBridgeStore(dir)
			let failOnce = true
			__testBridgeStoreIO.writeTmp = async (tmpPath, value) => {
				if (failOnce) {
					failOnce = false
					throw codedError('injected sync failure', 'EIO')
				}
				return origWrite(tmpPath, value)
			}

			await assert.rejects(() => store.set(CRITICAL, 'k', enc('v')), /injected sync failure/)
			await assert.rejects(() => access(join(dir, `${CRITICAL}-k.bin`)), /ENOENT/)

			__testBridgeStoreIO.writeTmp = origWrite
			await store.set(CRITICAL, 'k', enc('v'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('v')))
		} finally {
			__testBridgeStoreIO.writeTmp = origWrite
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('pending debounced values read back immediately but are not durable until flush', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-pending-'))
		try {
			const store = await useBridgeStore(dir)
			await store.set(NON_CRITICAL, 'k', enc('pending'))
			// Read-your-write before any flush.
			assert.equal(dec(await store.get(NON_CRITICAL, 'k')), 'pending')

			const reopened = await useBridgeStore(dir)
			assert.equal(await reopened.get(NON_CRITICAL, 'k'), null)

			await store.flush!()
			const afterFlush = await useBridgeStore(dir)
			assert.equal(dec(await afterFlush.get(NON_CRITICAL, 'k')), 'pending')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('flush that never quiesces reports itself instead of dropping writes', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-quiesce-'))
		const origWrite = __testBridgeStoreIO.writeTmp
		try {
			let store!: Awaited<ReturnType<typeof useBridgeStore>>
			store = await useBridgeStore(dir)
			let n = 0
			__testBridgeStoreIO.writeTmp = async (tmpPath, value) => {
				const i = n++
				// Every flushed write is replaced by a fresh pending one, so
				// no pass can drain the queue.
				void store.set(NON_CRITICAL, `churn-${i}`, enc('x'))
				return origWrite(tmpPath, value)
			}

			await store.set(NON_CRITICAL, 'churn-start', enc('x'))
			await assert.rejects(() => store.flush!(), /did not quiesce/)
		} finally {
			__testBridgeStoreIO.writeTmp = origWrite
			await rm(dir, { recursive: true, force: true })
		}
	})
})
