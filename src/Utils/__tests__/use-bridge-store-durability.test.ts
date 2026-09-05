/**
 * Durability contract for the file store:
 *  - caller buffers are copied at admission (Buffer and Uint8Array), even
 *    when mutated synchronously after the call behind a held prior op
 *  - failure → identical retry re-attempts and persists (set, setMany, flush)
 *  - setMany stays best-effort across keys with idempotent retry
 *  - failed flushes keep pending work and propagate the error
 *  - flush() waits for operations admitted before it (barrier) and never
 *    reports quiescence while prior admitted work is still running
 *  - reads/deletes surface real errors; only absence is tolerated
 *  - a failed delete restores preceding pending/durable state
 *  - concurrent ops on one key serialize (set→delete, delete→set, flush)
 *  - returned values are copies (no mutable aliasing)
 *  - atomic replacement keeps the previous file intact across failures and
 *    never removes a temp file it did not create
 *
 * All faults go through the real `useBridgeStore` callbacks with per-store
 * scoped I/O steps (`{ io }` option) or real filesystem states
 * (ENOTDIR/ENOENT). No shared mutable seam: each store under test owns its
 * injection, so gates and failures cannot leak across stores or tests.
 */

import { strict as assert } from 'node:assert'
import { access, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { useBridgeStore } from '../use-bridge-store.ts'

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

// Production-faithful temp write used to delegate after a gate/fault:
// exclusive create, payload, file sync.
const realWriteTmp = async (tmpPath: string, value: Uint8Array): Promise<void> => {
	const handle = await open(tmpPath, 'wx')
	try {
		await handle.writeFile(value)
		await handle.sync()
	} finally {
		await handle.close().catch(() => {})
	}
}

const realPublishTmp = async (tmpPath: string, finalPath: string): Promise<void> => {
	await rename(tmpPath, finalPath)
}

// A gate: `hold()` blocks until `release()` is called. `hits` counts
// arrivals so tests can wait for an operation to be provably blocked
// instead of racing a sleep.
const makeGate = () => {
	let release!: () => void
	let hits = 0
	const gate = new Promise<void>(resolve => {
		release = resolve
	})
	return {
		gate,
		release,
		hit() {
			hits++
		},
		get hits() {
			return hits
		}
	}
}

const waitFor = async (cond: () => boolean, what: string): Promise<void> => {
	for (let i = 0; i < 200 && !cond(); i++) {
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	assert.ok(cond(), `timed out waiting for ${what}`)
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
		try {
			const failBad = {
				writeTmp: async (tmpPath: string, value: Uint8Array) => {
					if (tmpPath.includes(`${CRITICAL}-bad`)) throw codedError('injected write failure', 'EIO')
					return realWriteTmp(tmpPath, value)
				},
				publishTmp: realPublishTmp
			}
			const store = await useBridgeStore(dir, { io: failBad })

			const entries: [string, Uint8Array][] = [
				['good', enc('g')],
				['bad', enc('b')]
			]
			await assert.rejects(() => store.setMany!(CRITICAL, entries), /injected write failure/)
			// Best-effort: the sibling was still applied.
			assert.equal(dec(await store.get(CRITICAL, 'good')), 'g')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-good.bin`)), Buffer.from(enc('g')))

			// Idempotent retry on a healthy store: `good` is already durable
			// (skipped), `bad` is re-attempted and now persists.
			const healthy = await useBridgeStore(dir)
			await healthy.setMany!(CRITICAL, entries)
			assert.equal(dec(await healthy.get(CRITICAL, 'bad')), 'b')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-bad.bin`)), Buffer.from(enc('b')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('admission copies Buffer input: synchronous mutation behind a held op cannot change it', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-admit-buf-'))
		try {
			const gate = makeGate()
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			const first = store.set(CRITICAL, 'k', enc('first'))
			await waitFor(() => gate.hits >= 1, 'first write to reach the gate')

			// Admitted while the prior op holds the key lock; mutated in the
			// same tick, before any await. Only an admission-time copy of a
			// Buffer (whose .slice() would alias!) persists 'second-secret'.
			const buf = Buffer.from('second-secret')
			const second = store.set(CRITICAL, 'k', buf)
			buf.fill(0)
			gate.release()
			await first
			await second

			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from('second-secret'))
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'second-secret')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('admission copies Uint8Array input: synchronous mutation behind a held op cannot change it', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-admit-u8-'))
		try {
			const gate = makeGate()
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			const first = store.set(CRITICAL, 'k', enc('first'))
			await waitFor(() => gate.hits >= 1, 'first write to reach the gate')

			const buf: Uint8Array = enc('second-secret')
			const second = store.set(CRITICAL, 'k', buf)
			buf.fill(0)
			gate.release()
			await first
			await second

			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from('second-secret'))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('setMany admission-copies every entry: caller mutation before await cannot change them', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-admit-many-'))
		try {
			const gate = makeGate()
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			const first = store.set(CRITICAL, 'blocker', enc('first'))
			await waitFor(() => gate.hits >= 1, 'blocker write to reach the gate')

			const bufA = Buffer.from('alpha')
			const bufB: Uint8Array = enc('beta')
			const batch = store.setMany!(CRITICAL, [
				['a', bufA],
				['b', bufB]
			])
			bufA.fill(0)
			bufB.fill(0)
			gate.release()
			await first
			await batch

			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-a.bin`)), Buffer.from('alpha'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-b.bin`)), Buffer.from('beta'))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('flush waits for an admitted in-flight critical write instead of reporting quiescence', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-barrier-'))
		try {
			const gate = makeGate()
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			const pending = store.set(CRITICAL, 'k', enc('v'))
			await waitFor(() => gate.hits >= 1, 'write to reach the gate')

			let flushed = false
			let flushError: unknown
			const flushing = store.flush!()
				.then(() => {
					flushed = true
				})
				.catch(e => {
					flushError = e
				})
			await new Promise(resolve => setTimeout(resolve, 100))
			// The admitted write is blocked: flush must neither resolve nor
			// falsely claim success while prior work is outstanding.
			assert.equal(flushed, false)
			assert.equal(flushError, undefined)

			gate.release()
			await pending
			await flushing
			assert.equal(flushed, true)
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('v')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('flush observes a set queued just before it, even before the set reaches the queue', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-barrier-q-'))
		try {
			const store = await useBridgeStore(dir)
			// Deliberately not awaited: flush() is called in the same tick,
			// before the set's key-lock callback can run.
			const queued = store.set(NON_CRITICAL, 'k', enc('v'))
			await store.flush!()
			await queued
			assert.deepEqual(await readFile(join(dir, `${NON_CRITICAL}-k.bin`)), Buffer.from(enc('v')))
		} finally {
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

	it('failed delete keeps the acknowledged debounced value readable and flushable', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-delfail-'))
		try {
			const store = await useBridgeStore(dir)
			await store.set(NON_CRITICAL, 'k', enc('v'))

			await asFile(dir)
			await assert.rejects(() => store.delete(NON_CRITICAL, 'k'), /ENOTDIR/)

			// Preceding pending state recovered: still readable, still queued.
			assert.equal(dec(await store.get(NON_CRITICAL, 'k')), 'v')
			await assert.rejects(() => store.flush!(), /ENOTDIR/)

			await asDir(dir)
			await store.flush!()
			assert.deepEqual(await readFile(join(dir, `${NON_CRITICAL}-k.bin`)), Buffer.from(enc('v')))

			// A later delete on a healthy folder succeeds at its own point.
			await store.delete(NON_CRITICAL, 'k')
			assert.equal(await store.get(NON_CRITICAL, 'k'), null)
			await assert.rejects(() => access(join(dir, `${NON_CRITICAL}-k.bin`)), /ENOENT/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('failed delete keeps the acknowledged durable value; interleaved writes still win', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-delfail2-'))
		try {
			const store = await useBridgeStore(dir)
			await store.set(CRITICAL, 'k', enc('old'))

			await asFile(dir)
			await assert.rejects(() => store.delete(CRITICAL, 'k'), /ENOTDIR/)
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'old')

			await asDir(dir)
			// Interleaved write after the failed delete persists normally.
			await store.set(CRITICAL, 'k', enc('new'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('new')))
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
		try {
			const gate = makeGate()
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			const first = store.set(CRITICAL, 'k', enc('one'))
			await waitFor(() => gate.hits >= 1, 'write to reach the gate')
			let deleteDone = false
			const del = store.delete(CRITICAL, 'k').then(() => {
				deleteDone = true
			})
			await new Promise(resolve => setTimeout(resolve, 100))
			// The delete could not overtake the gated write.
			assert.equal(deleteDone, false)
			gate.release()
			await first
			await del

			assert.equal(await store.get(CRITICAL, 'k'), null)
			await assert.rejects(() => access(join(dir, `${CRITICAL}-k.bin`)), /ENOENT/)
		} finally {
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
		try {
			const gate = makeGate()
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			const first = store.set(CRITICAL, 'k', enc('one'))
			await waitFor(() => gate.hits >= 1, 'first write to reach the gate')
			const second = store.set(CRITICAL, 'k', enc('two'))
			await new Promise(resolve => setTimeout(resolve, 50))
			gate.release()
			await first
			await second

			assert.equal(dec(await store.get(CRITICAL, 'k')), 'two')
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('two')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('mutating the caller buffer after an awaited set does not change persisted bytes', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-snap-'))
		try {
			const store = await useBridgeStore(dir)
			const buf = enc('orig')
			await store.set(CRITICAL, 'k', buf)
			buf.fill(0)

			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(CRITICAL, 'k')), 'orig')

			// Same for debounced writes: the queued copy is immune too.
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
		try {
			const healthy = await useBridgeStore(dir)
			await healthy.set(CRITICAL, 'k', enc('old'))

			let failOnce = true
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: realWriteTmp,
					publishTmp: async (tmpPath, finalPath) => {
						if (failOnce) {
							failOnce = false
							throw codedError('injected rename failure', 'EIO')
						}
						return realPublishTmp(tmpPath, finalPath)
					}
				}
			})
			await assert.rejects(() => store.set(CRITICAL, 'k', enc('new')), /injected rename failure/)
			// Previous intact file still on disk — never torn.
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('old')))

			await healthy.set(CRITICAL, 'k', enc('new'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('new')))

			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(CRITICAL, 'k')), 'new')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('write-stage failure rejects, leaves no torn file, and retry persists', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-write-'))
		try {
			let failOnce = true
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						if (failOnce) {
							failOnce = false
							throw codedError('injected sync failure', 'EIO')
						}
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			await assert.rejects(() => store.set(CRITICAL, 'k', enc('v')), /injected sync failure/)
			await assert.rejects(() => access(join(dir, `${CRITICAL}-k.bin`)), /ENOENT/)

			const healthy = await useBridgeStore(dir)
			await healthy.set(CRITICAL, 'k', enc('v'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('v')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('concurrent writes claim distinct temps and a failed publish never removes a foreign temp', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-tmp-'))
		try {
			const seen = new Set<string>()
			let failPublish = true
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						seen.add(tmpPath)
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: async (tmpPath, finalPath) => {
						if (failPublish) {
							failPublish = false
							throw codedError('injected publish failure', 'EIO')
						}
						return realPublishTmp(tmpPath, finalPath)
					}
				}
			})

			// A foreign temp-looking file this operation did not create.
			const foreign = join(dir, `${CRITICAL}-k.bin.99999.0.deadbeef.tmp`)
			await writeFile(foreign, enc('foreign'))

			await assert.rejects(() => store.set(CRITICAL, 'k', enc('v')), /injected publish failure/)
			await store.set(CRITICAL, 'a', enc('1'))
			await store.set(CRITICAL, 'b', enc('2'))

			assert.ok(seen.size >= 3, `expected distinct temps per attempt, saw ${seen.size}`)
			assert.deepEqual(await readFile(foreign), Buffer.from(enc('foreign')))
		} finally {
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
		try {
			let store!: Awaited<ReturnType<typeof useBridgeStore>>
			let n = 0
			store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						const i = n++
						// Every flushed write is replaced by a fresh pending
						// one, so no pass can drain the queue.
						void store.set(NON_CRITICAL, `churn-${i}`, enc('x'))
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp
				}
			})

			await store.set(NON_CRITICAL, 'churn-start', enc('x'))
			await assert.rejects(() => store.flush!(), /did not quiesce/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
