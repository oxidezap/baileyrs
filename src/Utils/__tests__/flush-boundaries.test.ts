import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AuthenticationState } from '../../Types/index.ts'
import { useBridgeStore } from '../use-bridge-store.ts'
import { initAuthCreds } from '../generics.ts'
import { wrapLegacyStore } from '../wrap-legacy-store.ts'
import { makeTransactionalMemKeys } from './_legacy-store-fixtures.ts'

const gate = () => {
	let release!: () => void
	const promise = new Promise<void>(resolve => {
		release = resolve
	})
	return { promise, release }
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve))
const writeTmp = async (path: string, bytes: Uint8Array) => {
	const file = await open(path, 'wx', 0o600)
	try {
		await file.writeFile(bytes)
		await file.sync()
	} finally {
		await file.close()
	}
}

for (const sameKey of [false, true]) {
	test(`failed flush joins new ordinary writes, same key: ${sameKey}`, async () => {
		const folder = await mkdtemp(join(tmpdir(), 'baileyrs-flush-'))
		const first = gate(),
			releaseFirst = gate(),
			second = gate(),
			releaseSecond = gate()
		let attempts = 0
		let nextWrite: Promise<void> | undefined
		const store = await useBridgeStore(folder, {
			io: {
				writeTmp: async (path, bytes) => {
					attempts++
					if (attempts === 1) {
						first.release()
						await releaseFirst.promise
						nextWrite = store.set('msg_secret', sameKey ? 'bad' : 'good', bytes)
						throw new Error('injected first failure')
					}
					second.release()
					await releaseSecond.promise
					await writeTmp(path, bytes)
				}
			}
		})
		let flushed = false
		let error: unknown
		try {
			await store.set('msg_secret', 'bad', new Uint8Array([7]))
			const flush = store.flush!().then(
				() => {
					flushed = true
				},
				reason => {
					flushed = true
					error = reason
				}
			)
			await first.promise
			releaseFirst.release()
			await Promise.race([
				second.promise,
				new Promise<never>((_resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('new write was not drained')), 500)
					void second.promise.then(() => clearTimeout(timeout))
				})
			])
			await turn()
			assert.equal(flushed, false, 'new write must remain inside the failed flush barrier')
			releaseSecond.release()
			await flush
			await nextWrite
			assert.match(String(error), /injected first failure/)
			assert.deepEqual(await readFile(join(folder, `msg_secret-${sameKey ? 'bad' : 'good'}.bin`)), Buffer.from([7]))
			assert.equal(attempts, 2, 'the earlier failed entry is not retried automatically')
		} finally {
			releaseFirst.release()
			releaseSecond.release()
			await nextWrite
			await store.flush!()
			await rm(folder, { recursive: true, force: true })
		}
	})
}

test('legacy flush deadline leaves the backend transaction pending until its real commit', async context => {
	const keys = makeTransactionalMemKeys()
	const transaction = keys.bridgeTransaction
	const entered = gate(),
		release = gate()
	keys.bridgeTransaction = async work => {
		entered.release()
		await release.promise
		return transaction(work)
	}
	const store = await wrapLegacyStore(
		{ creds: initAuthCreds(), keys: keys as AuthenticationState['keys'] },
		async () => {}
	)
	const write = store.touchTcTokenSenderTimestamp('jid', '1')
	await entered.promise
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
	let settled = false
	let error: unknown
	const flush = store.flush().then(
		() => {
			settled = true
		},
		reason => {
			settled = true
			error = reason
		}
	)
	try {
		await turn()
		context.mock.timers.tick(30_000)
		await turn()
		assert.equal(settled, true, 'deadline must bound the awaited backend operation')
		assert.match(String(error), /30s.*remain pending/)
		assert.equal(keys.count(), 0, 'timeout must not certify or commit the transaction')
	} finally {
		release.release()
		context.mock.timers.reset()
		await write
		await flush
		context.mock.timers.reset()
		await store.flush()
	}
	assert.ok(keys.count() > 0)
})

test('file flush deadline retains per-key ownership until a blocked write finishes', async context => {
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-flush-deadline-'))
	const entered = gate(),
		release = gate()
	let attempts = 0
	const store = await useBridgeStore(folder, {
		io: {
			writeTmp: async (path, bytes) => {
				attempts++
				if (attempts === 1) {
					entered.release()
					await release.promise
				}
				await writeTmp(path, bytes)
			}
		}
	})
	const write = store.set('session', 'key', new Uint8Array([1]))
	await entered.promise
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
	let settled = false
	let error: unknown
	const flush = store.flush!().then(
		() => {
			settled = true
		},
		reason => {
			settled = true
			error = reason
		}
	)
	let nextWrite: Promise<void> | undefined
	try {
		await turn()
		context.mock.timers.tick(30_000)
		await turn()
		assert.equal(settled, true)
		assert.match(String(error), /30s.*remain pending/)
		nextWrite = store.set('session', 'key', new Uint8Array([2]))
		await turn()
		assert.equal(attempts, 1, 'timeout must not release the pending key owner')
	} finally {
		release.release()
		context.mock.timers.reset()
		await write
		await nextWrite
		await flush
		context.mock.timers.reset()
		await store.flush!()
		assert.deepEqual(await readFile(join(folder, 'session-key.bin')), Buffer.from(nextWrite ? [2] : [1]))
		await rm(folder, { recursive: true, force: true })
	}
})

test('snapshot flush deadline retains the OS transaction lock until completion', async context => {
	const { createSnapshotTransactions } = await import('../snapshot-transactions.ts')
	const { defaultSyncDir } = await import('../durable-directory.ts')
	const { rowKey } = await import('../atomic-store.ts')
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-snapshot-deadline-'))
	const snapshot = createSnapshotTransactions(
		folder,
		'state.json',
		new Set(['meta']),
		async () => new Map(),
		defaultSyncDir
	)
	const entered = gate(),
		release = gate()
	const write = snapshot.transaction(async rows => {
		entered.release()
		await release.promise
		rows.set(rowKey('meta', 'key'), new Uint8Array([1]))
	})
	await entered.promise
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
	let settled = false
	let error: unknown
	const flush = snapshot.flush().then(
		() => {
			settled = true
		},
		reason => {
			settled = true
			error = reason
		}
	)
	let nextEntered = false
	let nextWrite: Promise<void> | undefined
	try {
		await turn()
		context.mock.timers.tick(30_000)
		await turn()
		assert.equal(settled, true)
		assert.match(String(error), /30s.*remain pending/)
		// The lock retry must use real timers. Resetting a pending mocked retry
		// would discard its timer and strand the peer during test cleanup.
		context.mock.timers.reset()
		// A separate adapter must still wait on the real OS lock.
		const peer = createSnapshotTransactions(
			folder,
			'state.json',
			new Set(['meta']),
			async () => new Map(),
			defaultSyncDir
		)
		nextWrite = peer.transaction(rows => {
			nextEntered = true
			rows.set(rowKey('meta', 'key'), new Uint8Array([2]))
		})
		await new Promise(resolve => setTimeout(resolve, 25))
		assert.equal(nextEntered, false)
	} finally {
		release.release()
		context.mock.timers.reset()
		await write
		await nextWrite
		await flush
		context.mock.timers.reset()
		await snapshot.flush()
		assert.deepEqual(await snapshot.read(rows => rows.get(rowKey('meta', 'key'))), Buffer.from(nextWrite ? [2] : [1]))
		await rm(folder, { recursive: true, force: true })
	}
})

for (const alias of ['meta-%41.bin', 'meta-%2f.bin']) {
	test(`native migration rejects noncanonical filename ${alias} without publishing state`, async () => {
		const folder = await mkdtemp(join(tmpdir(), 'baileyrs-migration-alias-'))
		try {
			await writeFile(join(folder, 'meta-A.bin'), '[1]')
			await writeFile(join(folder, alias), '[2]')
			const store = await useBridgeStore(folder, { migrate: true })
			await assert.rejects(store.get('meta', 'A'), /noncanonical native auth filename/)
			await assert.rejects(store.flush!(), /noncanonical native auth filename/)
			await assert.rejects(access(join(folder, 'bridge-atomic-v1.json')), { code: 'ENOENT' })
			assert.equal(await readFile(join(folder, 'meta-A.bin'), 'utf8'), '[1]')
			assert.equal(await readFile(join(folder, alias), 'utf8'), '[2]')
		} finally {
			await rm(folder, { recursive: true, force: true })
		}
	})
}

for (const backend of ['legacy', 'snapshot', 'file'] as const) {
	for (const reasonKind of ['error', 'string'] as const) {
		for (const withTimeout of [false, true]) {
			test(`${backend}: repeated ${reasonKind} rejection retains operation count, timeout: ${withTimeout}`, async context => {
				const fault = reasonKind === 'error' ? new Error('settled backend failure') : 'settled backend failure'
				const entered = gate(),
					release = gate(),
					failEntered = gate(),
					releaseFailure = gate()
				const folder = await mkdtemp(join(tmpdir(), 'baileyrs-flush-errors-'))
				let flushStore!: () => Promise<void>
				let failed: Promise<unknown>
				let failedAgain: Promise<unknown>
				let blocked: Promise<unknown>
				if (backend === 'legacy') {
					const keys = makeTransactionalMemKeys()
					const transaction = keys.bridgeTransaction
					let remainingFailures = 2
					keys.bridgeTransaction = async work => {
						if (remainingFailures-- > 0) {
							failEntered.release()
							await releaseFailure.promise
							throw fault
						}
						entered.release()
						if (withTimeout) await release.promise
						return transaction(work)
					}
					const store = await wrapLegacyStore(
						{ creds: initAuthCreds(), keys: keys as AuthenticationState['keys'] },
						async () => {}
					)
					failed = store.touchTcTokenSenderTimestamp('bad', '1')
					failedAgain = store.touchTcTokenSenderTimestamp('bad-again', '1')
					blocked = store.touchTcTokenSenderTimestamp('good', '2')
					flushStore = () => store.flush()
				} else if (backend === 'snapshot') {
					const { createSnapshotTransactions } = await import('../snapshot-transactions.ts')
					const { defaultSyncDir } = await import('../durable-directory.ts')
					const snapshot = createSnapshotTransactions(
						folder,
						'state.json',
						new Set(['meta']),
						async () => new Map(),
						defaultSyncDir
					)
					failed = snapshot.transaction(async () => {
						failEntered.release()
						await releaseFailure.promise
						throw fault
					})
					failedAgain = snapshot.transaction(async () => {
						await releaseFailure.promise
						throw fault
					})
					blocked = snapshot.transaction(async () => {
						entered.release()
						if (withTimeout) await release.promise
					})
					flushStore = () => snapshot.flush()
				} else {
					let remainingFailures = 2
					const store = await useBridgeStore(folder, {
						io: {
							writeTmp: async (path, bytes) => {
								if (bytes[0] === 1 && remainingFailures-- > 0) {
									failEntered.release()
									await releaseFailure.promise
									throw fault
								}
								if (bytes[0] === 2) {
									entered.release()
									if (withTimeout) await release.promise
								}
								await writeTmp(path, bytes)
							}
						}
					})
					failed = store.set('session', 'bad', new Uint8Array([1]))
					failedAgain = store.set('session', 'bad-again', new Uint8Array([1]))
					blocked = store.set('session', 'good', new Uint8Array([2]))
					flushStore = () => store.flush!()
				}
				const failedObserved = Promise.all(
					[failed, failedAgain].map(operation => assert.rejects(operation, error => error === fault))
				)
				await failEntered.promise
				context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
				let settled = false
				let error: unknown
				const flush = flushStore().then(
					() => {
						settled = true
					},
					reason => {
						settled = true
						error = reason
					}
				)
				try {
					releaseFailure.release()
					await failedObserved
					await entered.promise
					await turn()
					if (withTimeout) context.mock.timers.tick(30_000)
					else await flush
					await turn()
					assert.equal(settled, true)
					assert.ok(error instanceof AggregateError)
					assert.ok(
						error.errors.filter(reason => reason === fault).length === 2,
						'each failed operation must retain its reason, even when both reuse the same reason'
					)
					assert.equal(
						error.errors.some(item => item?.code === 'ERR_STORE_FLUSH_TIMEOUT'),
						withTimeout
					)
				} finally {
					releaseFailure.release()
					release.release()
					context.mock.timers.reset()
					await failedObserved
					await blocked
					await flush
					// Timed-out drains leave failures owned until a later drain observes them.
					await flushStore().catch(() => {})
					await flushStore()
					await rm(folder, { recursive: true, force: true })
				}
			})
		}
	}
}

for (const namespace of ['meta', 'session', 'msg_secret']) {
	test(`file: one ${namespace} failure is reported once across backing and public drains`, async () => {
		const { defaultSyncDir } = await import('../durable-directory.ts')
		const folder = await mkdtemp(join(tmpdir(), 'baileyrs-flush-once-'))
		const entered = gate(),
			release = gate()
		const fault = new Error('one backend failure')
		let failOnce = true
		const fail = async () => {
			if (!failOnce) return
			failOnce = false
			entered.release()
			await release.promise
			throw fault
		}
		const store = await useBridgeStore(folder, {
			io: {
				writeTmp: async (path, bytes) => {
					if (namespace !== 'meta') await fail()
					await writeTmp(path, bytes)
				},
				syncDir: async path => {
					await defaultSyncDir(path)
					if (namespace === 'meta') await fail()
				}
			}
		})
		const write = store.set(namespace, 'key', Buffer.from('[]'))
		const observed = namespace === 'msg_secret' ? write : assert.rejects(write, error => error === fault)
		let error: unknown
		const flush = store.flush!().catch(reason => {
			error = reason
		})
		try {
			await entered.promise
			release.release()
			await observed
			await flush
			assert.equal(error, fault, 'one failed operation must preserve its original error, not an aggregate of wrappers')
		} finally {
			release.release()
			await observed
			await flush
			await store.flush!()
			await rm(folder, { recursive: true, force: true })
		}
	})
}

test('file: timeout retains distinct failed debounced writes while their backing drain remains pending', async context => {
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-flush-pending-errors-'))
	const entered = gate(),
		release = gate()
	const fault = new Error('debounced backend failure')
	let failing = true
	const store = await useBridgeStore(folder, {
		io: {
			writeTmp: async (path, bytes) => {
				if (bytes[0] === 1 && failing) throw fault
				if (bytes[0] === 2) {
					entered.release()
					await release.promise
				}
				await writeTmp(path, bytes)
			}
		}
	})
	await store.set('msg_secret', 'bad', new Uint8Array([1]))
	await store.set('msg_secret', 'bad-again', new Uint8Array([1]))
	await store.set('msg_secret', 'blocked', new Uint8Array([2]))
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
	let error: unknown
	const flush = store.flush!().catch(reason => {
		error = reason
	})
	try {
		await entered.promise
		await turn()
		context.mock.timers.tick(30_000)
		await flush
		assert.ok(error instanceof AggregateError)
		assert.equal(error.errors.filter(reason => reason === fault).length, 2)
		assert.ok(error.errors.some(reason => reason?.code === 'ERR_STORE_FLUSH_TIMEOUT'))
	} finally {
		failing = false
		release.release()
		context.mock.timers.reset()
		await flush
		await store.flush!()
		await rm(folder, { recursive: true, force: true })
	}
})
