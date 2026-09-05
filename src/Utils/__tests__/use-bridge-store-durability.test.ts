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
import { access, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { useBridgeStore, isUnsupportedDirSync } from '../use-bridge-store.ts'

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

// Production-faithful directory barrier for delegating stubs (Linux path:
// open + sync; platform fallback lives in the module under test).
const realSyncDir = async (dir: string): Promise<void> => {
	const handle = await open(dir, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close().catch(() => {})
	}
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
				writeTmp: realWriteTmp,
				// Temp basenames are decoupled from keys by design, so the
				// fault targets the final path (which carries the key).
				publishTmp: async (tmpPath: string, finalPath: string) => {
					if (finalPath.includes(`${CRITICAL}-bad`)) throw codedError('injected write failure', 'EIO')
					return realPublishTmp(tmpPath, finalPath)
				},
				syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					},
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
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
					},
					syncDir: realSyncDir
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
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
				}
			})

			await store.set(NON_CRITICAL, 'churn-start', enc('x'))
			await assert.rejects(() => store.flush!(), /did not quiesce/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('flush propagates a barrier-observed critical-write failure; later flushes are clean', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-barrier-err-'))
		try {
			const gate = makeGate()
			let failWrite = true
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: async (tmpPath, value) => {
						gate.hit()
						await gate.gate
						if (failWrite) throw codedError('injected gated failure', 'EIO')
						return realWriteTmp(tmpPath, value)
					},
					publishTmp: realPublishTmp,
					syncDir: realSyncDir
				}
			})

			let setSettled = false
			let setError: unknown
			const pending = store.set(CRITICAL, 'k', enc('v')).then(
				() => {
					setSettled = true
				},
				e => {
					setSettled = true
					setError = e
				}
			)
			await waitFor(() => gate.hits >= 1, 'write to reach the gate')

			let flushSettled = false
			let flushError: unknown
			const flushing = store.flush!().then(
				() => {
					flushSettled = true
				},
				e => {
					flushSettled = true
					flushError = e
				}
			)
			await new Promise(resolve => setTimeout(resolve, 100))
			// The admitted write is blocked: neither call may settle yet.
			assert.equal(setSettled, false)
			assert.equal(flushSettled, false)

			gate.release()
			await pending
			await flushing
			assert.match(String(setError), /injected gated failure/)
			// The barrier observed the failure: flush rejects instead of
			// resolving successfully.
			assert.match(String(flushError), /injected gated failure/)

			// Settled history never poisons later flushes.
			failWrite = false
			await store.flush!()

			// A healthy retry certifies the key.
			const healthy = await useBridgeStore(dir)
			await healthy.set(CRITICAL, 'k', enc('v'))
			await healthy.flush!()
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('v')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('post-rename barrier failure invalidates certification; identical sets re-attempt', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-uncertain-'))
		try {
			let failBarrier = false
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: realWriteTmp,
					// Real rename-then-error boundary: the bytes reach the
					// target, but the barrier never certifies them.
					publishTmp: async (tmpPath, finalPath) => {
						await rename(tmpPath, finalPath)
						if (failBarrier) throw codedError('injected post-rename barrier failure', 'EIO')
					},
					syncDir: realSyncDir
				}
			})

			await store.set(CRITICAL, 'k', enc('A'))
			failBarrier = true
			await assert.rejects(() => store.set(CRITICAL, 'k', enc('B')), /post-rename barrier failure/)
			// The rename really happened: disk holds B while the cache must
			// no longer claim A for the key.
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('B')))

			// Reads serve best-available B without re-certifying it: retry B
			// still runs its still-required barrier.
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'B')
			await assert.rejects(() => store.set(CRITICAL, 'k', enc('B')), /post-rename barrier failure/)
			// Identical set of A must re-attempt, not skip on stale cache.
			// Its rename lands A on disk before the barrier fails again.
			await assert.rejects(() => store.set(CRITICAL, 'k', enc('A')), /post-rename barrier failure/)
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('A')))
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'A')

			failBarrier = false
			await store.set(CRITICAL, 'k', enc('B'))
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'B')
			await store.set(CRITICAL, 'k', enc('A'))
			assert.deepEqual(await readFile(join(dir, `${CRITICAL}-k.bin`)), Buffer.from(enc('A')))
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('failed post-unlink barrier is retried, not swallowed as idempotent absence', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-delbarrier-'))
		try {
			let failSync = false
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: realWriteTmp,
					publishTmp: realPublishTmp,
					syncDir: async (d: string) => {
						if (failSync) throw codedError('injected post-unlink barrier failure', 'EIO')
						return realSyncDir(d)
					}
				}
			})

			await store.set(CRITICAL, 'k', enc('v'))
			failSync = true
			await assert.rejects(() => store.delete(CRITICAL, 'k'), /post-unlink barrier failure/)
			// The unlink really happened.
			await assert.rejects(() => access(join(dir, `${CRITICAL}-k.bin`)), /ENOENT/)
			assert.equal(await store.get(CRITICAL, 'k'), null)
			// Retry while still failing rejects again — never swallowed.
			await assert.rejects(() => store.delete(CRITICAL, 'k'), /post-unlink barrier failure/)

			failSync = false
			// ENOENT on disk, but the prior barrier was uncertified: the
			// retry re-runs the barrier and then resolves.
			await store.delete(CRITICAL, 'k')
			assert.equal(await store.get(CRITICAL, 'k'), null)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('uncertain delete with the directory removed externally surfaces ENOENT', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-delgone-'))
		try {
			let failSync = false
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: realWriteTmp,
					publishTmp: realPublishTmp,
					syncDir: async (d: string) => {
						if (failSync) throw codedError('injected post-unlink barrier failure', 'EIO')
						return realSyncDir(d)
					}
				}
			})

			await store.set(CRITICAL, 'k', enc('v'))
			failSync = true
			await assert.rejects(() => store.delete(CRITICAL, 'k'), /post-unlink barrier failure/)

			// Explicit scoped policy: an externally removed directory is not
			// silently treated as certified absence while uncertain.
			failSync = false
			await rm(dir, { recursive: true, force: true })
			await assert.rejects(() => store.delete(CRITICAL, 'k'), /ENOENT/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('isUnsupportedDirSync classifies directory-barrier errors per platform', () => {
		const cases: [code: string, platform: NodeJS.Platform, expected: boolean][] = [
			['ENOSYS', 'linux', true],
			['ENOSYS', 'win32', true],
			['ENOSYS', 'darwin', true],
			['ENOTSUP', 'linux', true],
			['ENOTSUP', 'win32', true],
			['EINVAL', 'win32', true],
			['EINVAL', 'linux', false],
			['EINVAL', 'darwin', false],
			['EPERM', 'win32', true],
			['EPERM', 'linux', false],
			['EISDIR', 'win32', true],
			['EISDIR', 'linux', false],
			['EIO', 'linux', false],
			['EIO', 'win32', false],
			['ENOSPC', 'linux', false],
			['ENOSPC', 'win32', false],
			['EACCES', 'linux', false],
			['EACCES', 'win32', false],
			['ENOENT', 'linux', false],
			['ENOENT', 'win32', false],
			['EBADF', 'linux', false],
			['EBADF', 'win32', false]
		]
		for (const [code, platform, expected] of cases) {
			assert.equal(isUnsupportedDirSync(codedError('x', code), platform), expected, `${code}/${platform}`)
		}
		// Default platform binding works without an explicit argument.
		assert.equal(isUnsupportedDirSync(codedError('x', 'ENOSYS')), true)
		assert.equal(isUnsupportedDirSync(codedError('x', 'EIO')), false)
	})

	it('uncertain delete retry with failing barrier preserves admitted pending data (Greptile 3939491652)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-delpending-'))
		try {
			let failSync = false
			const store = await useBridgeStore(dir, {
				io: {
					writeTmp: realWriteTmp,
					publishTmp: realPublishTmp,
					syncDir: async (d: string) => {
						if (failSync) throw codedError('injected barrier failure', 'EIO')
						return realSyncDir(d)
					}
				}
			})

			await store.set(NON_CRITICAL, 'k', enc('v1'))
			await store.flush!()
			failSync = true
			// Unlink succeeds, barrier fails: uncertainty with an absent file.
			await assert.rejects(() => store.delete(NON_CRITICAL, 'k'), /barrier failure/)

			// Admit a debounced value on the uncertain absent key.
			await store.set(NON_CRITICAL, 'k', enc('v2'))
			assert.equal(dec(await store.get(NON_CRITICAL, 'k')), 'v2')

			// Retry delete: unlink hits ENOENT while uncertain, barrier fails
			// again — the admitted pending value must survive the failure.
			await assert.rejects(() => store.delete(NON_CRITICAL, 'k'), /barrier failure/)
			assert.equal(dec(await store.get(NON_CRITICAL, 'k')), 'v2')
			// Uncertainty is kept, not resolved: a further retry still fails.
			await assert.rejects(() => store.delete(NON_CRITICAL, 'k'), /barrier failure/)
			// And the pending work is still flushable, not silently dropped.
			await assert.rejects(() => store.flush!(), /barrier failure/)

			failSync = false
			await store.flush!()
			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(NON_CRITICAL, 'k')), 'v2')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('writes a key whose encoded filename is long but valid (Greptile 3939501789)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-longname-'))
		try {
			const store = await useBridgeStore(dir)
			// `session-` (8) + 228 + `.bin` (4) = 240 bytes: valid under the
			// 255-byte component limit, but any temp name derived by
			// extending it exceeds the limit.
			const key = 'a'.repeat(228)
			assert.ok(Buffer.byteLength(`${CRITICAL}-${key}.bin`) < 255)
			await store.set(CRITICAL, key, enc('long'))
			assert.equal(dec(await store.get(CRITICAL, key)), 'long')
			assert.deepEqual(await store.listKeys!(CRITICAL), [key])
			const reopened = await useBridgeStore(dir)
			assert.equal(dec(await reopened.get(CRITICAL, key)), 'long')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('creates and replaces auth files with restrictive modes under a typical umask (Greptile 3939501791)', async () => {
		// POSIX mode semantics only; on Windows modes are largely ignored,
		// so only the round-trip is asserted there.
		const posix = process.platform !== 'win32'
		const dir = await mkdtemp(join(tmpdir(), 'dur-modes-'))
		const prevUmask = process.umask(0o022)
		try {
			const store = await useBridgeStore(dir)
			await store.set(CRITICAL, 'k', enc('v'))
			if (posix) {
				assert.equal((await stat(join(dir, `${CRITICAL}-k.bin`))).mode & 0o777, 0o600)
			}
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'v')

			// A hardened pre-existing file must never be widened by replace.
			const hardened = join(dir, `${CRITICAL}-h.bin`)
			await writeFile(hardened, enc('seed'), { mode: 0o600 })
			await store.set(CRITICAL, 'h', enc('new'))
			if (posix) {
				assert.equal((await stat(hardened)).mode & 0o777, 0o600)
			}
			assert.equal(dec(await store.get(CRITICAL, 'h')), 'new')
		} finally {
			process.umask(prevUmask)
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('default-writer close failure cleans its owned temp and surfaces the original error (Greptile 3939501793)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dur-closefail-'))
		try {
			let failClose = true
			let removeBeforeThrow = false
			const store = await useBridgeStore(dir, {
				// Only the temp-creation step is replaced; write, sync,
				// close-cleanup and publish run the real default code.
				io: {
					openTmp: async (tmpPath: string) => {
						const handle = await open(tmpPath, 'wx')
						let closed = false
						return {
							writeFile: (value: Uint8Array) => handle.writeFile(value),
							sync: () => handle.sync(),
							close: async () => {
								if (closed) return
								closed = true
								if (failClose) {
									if (removeBeforeThrow) await rm(tmpPath, { force: true })
									throw codedError('injected close failure', 'EIO')
								}
								await handle.close()
							}
						}
					}
				}
			})

			await assert.rejects(() => store.set(CRITICAL, 'k', enc('v')), /injected close failure/)
			// Owned temp cleaned: no secret-carrying leftovers remain.
			assert.deepEqual(
				(await readdir(dir)).filter(f => f.endsWith('.tmp')),
				[]
			)

			// A cleanup racing a vanished temp still reports the original.
			removeBeforeThrow = true
			await assert.rejects(() => store.set(CRITICAL, 'k', enc('v')), /injected close failure/)

			// Retries accumulate nothing: exactly the target file remains.
			failClose = false
			await store.set(CRITICAL, 'k', enc('v'))
			assert.deepEqual(await readdir(dir), [`${CRITICAL}-k.bin`])
			assert.equal(dec(await store.get(CRITICAL, 'k')), 'v')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
