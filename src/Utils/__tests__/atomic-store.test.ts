import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { useMemoryStore } from '../use-memory-store.ts'
import { useBridgeStore } from '../use-bridge-store.ts'
import { decodeTokenRow, rowKey } from '../atomic-store.ts'

const enc = (value: unknown) => Buffer.from(JSON.stringify(value))
const parse = (value: Uint8Array | null) => value && JSON.parse(Buffer.from(value).toString())
const exec = promisify(execFile)
const withFolder = async (work: (folder: string) => Promise<void>) => {
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-atomic-'))
	try {
		await work(folder)
	} finally {
		await rm(folder, { recursive: true, force: true })
	}
}

for (const backend of ['memory', 'file'] as const) {
	test(`${backend}: patch replacement includes MACs, version and index, with removal before addition`, () =>
		withFolder(async folder => {
			const store = backend === 'memory' ? useMemoryStore() : await useBridgeStore(folder)
			await store.commitPatch('regular', enc({ version: 1 }), [], [['regular:old', enc([1])]], true)
			await store.commitPatch(
				'regular',
				enc({ version: 2 }),
				['regular:old'],
				[
					['regular:old', enc([2])],
					['regular:new', enc([3])]
				],
				true
			)
			assert.deepEqual(parse(await store.get('sync_version', 'regular')), { version: 2 })
			assert.deepEqual(parse(await store.get('mutation_mac', 'regular:old')), [2])
			assert.deepEqual(parse(await store.get('meta', 'mutation_mac_keys')), ['regular:old', 'regular:new'])
			await store.commitPatch('regular', enc({ version: 3 }), ['regular:old'], [], true)
			assert.equal(await store.get('mutation_mac', 'regular:old'), null)
			assert.deepEqual(parse(await store.get('meta', 'mutation_mac_keys')), ['regular:new'])
		}))
	test(`${backend}: signed i64 token merges preserve both timestamp buckets and equal-time replacement`, () =>
		withFolder(async folder => {
			const store = backend === 'memory' ? useMemoryStore() : await useBridgeStore(folder)
			await store.touchTcTokenSenderTimestamp('jid', '9223372036854775807')
			await store.storeReceivedTcToken('jid', new Uint8Array([4]), '-9223372036854775808')
			await store.storeReceivedTcToken('jid', new Uint8Array([5]), '-9223372036854775808')
			await store.touchTcTokenSenderTimestamp('jid', '-9223372036854775808')
			assert.deepEqual(decodeTokenRow((await store.get('tc_token', 'jid'))!), {
				token: [5],
				token_timestamp: -(1n << 63n),
				sender_timestamp: (1n << 63n) - 1n
			})
			await store.storeReceivedTcToken('jid', new Uint8Array([6]), '0')
			await store.storeReceivedTcToken('jid', new Uint8Array([7]), '-1')
			assert.deepEqual(decodeTokenRow((await store.get('tc_token', 'jid'))!).token, [6])
			assert.deepEqual(parse(await store.get('meta', 'tc_token_jids')), ['jid'])
		}))
	test(`${backend}: malformed index aborts the complete patch`, () =>
		withFolder(async folder => {
			const store = backend === 'memory' ? useMemoryStore() : await useBridgeStore(folder)
			await store.set('meta', 'mutation_mac_keys', enc({ invalid: true }))
			await assert.rejects(store.commitPatch('regular', enc({ version: 2 }), [], [['regular:new', enc([3])]], true))
			assert.equal(await store.get('sync_version', 'regular'), null)
			assert.equal(await store.get('mutation_mac', 'regular:new'), null)
		}))
}

test('file: import old binary records once, preserve source backups and survive reopen/delete', () =>
	withFolder(async folder => {
		await writeFile(join(folder, 'sync_version-regular.bin'), enc({ version: 1 }))
		await writeFile(join(folder, 'mutation_mac-regular%3Aold.bin'), enc([1]))
		await writeFile(join(folder, 'meta-mutation_mac_keys.bin'), enc(['regular:old']))
		await assert.rejects(useBridgeStore(folder), /offline migration/)
		const store = await useBridgeStore(folder, { migrate: true })
		await store.commitPatch('regular', enc({ version: 2 }), ['regular:old'], [['regular:new', enc([2])]], true)
		const reopened = await useBridgeStore(folder)
		assert.deepEqual(parse(await reopened.get('sync_version', 'regular')), { version: 2 })
		assert.equal(await reopened.get('mutation_mac', 'regular:old'), null)
		assert.deepEqual(JSON.parse(await readFile(join(folder, 'sync_version-regular.bin'), 'utf8')), { version: 1 })
		await reopened.delete('sync_version', 'regular')
		assert.equal(await (await useBridgeStore(folder)).get('sync_version', 'regular'), null)
	}))

test('file: post-commit barrier failure rejects and reopen sees complete patch', () =>
	withFolder(async folder => {
		const store = await useBridgeStore(folder, {
			io: {
				syncDir: async () => {
					throw new Error('injected barrier failure')
				}
			}
		})
		await assert.rejects(
			store.commitPatch('regular', enc({ version: 2 }), [], [['regular:new', enc([2])]], true),
			/injected barrier/
		)
		const reopened = await useBridgeStore(folder)
		assert.deepEqual(parse(await reopened.get('sync_version', 'regular')), { version: 2 })
		assert.deepEqual(parse(await reopened.get('mutation_mac', 'regular:new')), [2])
		assert.deepEqual(parse(await reopened.get('meta', 'mutation_mac_keys')), ['regular:new'])
	}))

test('file: separate processes share token merges and ordinary writers', () =>
	withFolder(async folder => {
		const moduleUrl = new URL('../use-bridge-store.ts', import.meta.url).href
		const run = (code: string) =>
			exec(process.execPath, [
				'--input-type=module',
				'-e',
				`import { useBridgeStore } from ${JSON.stringify(moduleUrl)}; const store = await useBridgeStore(${JSON.stringify(folder)}); ${code}`
			])
		await Promise.all([
			run("for (let i=0;i<15;i++) await store.touchTcTokenSenderTimestamp('jid', String(i));"),
			run("for (let i=0;i<15;i++) await store.storeReceivedTcToken('jid', new Uint8Array([i]), String(i));"),
			run("for (let i=0;i<15;i++) await store.set('tc_token', 'other'+i, new TextEncoder().encode('raw'));"),
			run(
				"for (let i=0;i<15;i++) { await store.set('tc_token', 'deleted', new Uint8Array([1])); await store.delete('tc_token', 'deleted'); }"
			)
		])
		const store = await useBridgeStore(folder)
		assert.deepEqual(decodeTokenRow((await store.get('tc_token', 'jid'))!), {
			token: [14],
			token_timestamp: 14n,
			sender_timestamp: 14n
		})
		assert.equal((await store.listKeys!('tc_token')).length, 16)
		const snapshot = JSON.parse(await readFile(join(folder, 'bridge-atomic-v1.json'), 'utf8'))
		assert.ok(snapshot.some(([key]: [string, string]) => key === rowKey('tc_token', 'jid')))
	}))

test('legacy JSON migration: patch and exact i64 token projections survive reopening', () =>
	withFolder(async folder => {
		const { initAuthCreds, BufferJSON } = await import('../generics.ts')
		const { useLegacyMultiFileAuthState, wrapLegacyStore } = await import('../wrap-legacy-store.ts')
		await writeFile(join(folder, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer))
		await writeFile(
			join(folder, 'tctoken-jid.json'),
			JSON.stringify({ token: Buffer.from([1]), timestamp: '12' }, BufferJSON.replacer)
		)
		await assert.rejects(useLegacyMultiFileAuthState(folder), /offline migration/)
		const auth = await useLegacyMultiFileAuthState(folder, { migrate: true })
		const store = await wrapLegacyStore(auth.state, auth.saveCreds)
		await store.touchTcTokenSenderTimestamp('jid', '9223372036854775807')
		await store.storeReceivedTcToken('jid', new Uint8Array([2]), '13')
		const version = { version: 2, hash: Array.from({ length: 128 }, () => 0), index_value_map: {} }
		await store.commitPatch('regular', enc(version), [], [['regular:key', enc([3])]], true)
		const nextAuth = await useLegacyMultiFileAuthState(folder)
		const reopened = await wrapLegacyStore(nextAuth.state, nextAuth.saveCreds)
		assert.deepEqual(decodeTokenRow((await reopened.get('tc_token', 'jid'))!), {
			token: [2],
			token_timestamp: 13n,
			sender_timestamp: (1n << 63n) - 1n
		})
		assert.deepEqual(parse(await reopened.get('sync_version', 'regular')), version)
		assert.deepEqual(parse(await reopened.get('meta', 'mutation_mac_keys')), ['regular:key'])
		await reopened.set('meta', 'mutation_mac_keys', enc({ invalid: true }))
		await assert.rejects(reopened.commitPatch('regular', enc({ ...version, version: 3 }), ['regular:key'], [], true))
		assert.deepEqual(parse(await reopened.get('sync_version', 'regular')), version)
		assert.deepEqual(parse(await reopened.get('mutation_mac', 'regular:key')), [3])
		assert.deepEqual(
			JSON.parse(await readFile(join(folder, 'tctoken-jid.json'), 'utf8'), BufferJSON.reviver).token,
			Buffer.from([1])
		)
	}))

test('file: flush observes an admitted atomic transaction and its durability failure', () =>
	withFolder(async folder => {
		let entered!: () => void
		let release!: () => void
		const arrived = new Promise<void>(resolve => {
			entered = resolve
		})
		const gate = new Promise<void>(resolve => {
			release = resolve
		})
		const store = await useBridgeStore(folder, {
			io: {
				syncDir: async () => {
					entered()
					await gate
					throw new Error('atomic barrier failed')
				}
			}
		})
		const write = store.storeReceivedTcToken('jid', new Uint8Array([1]), '1')
		void write.catch(() => {})
		await arrived
		const flush = store.flush!()
		void flush.catch(() => {})
		release()
		await assert.rejects(write, /atomic barrier failed/)
		await assert.rejects(flush, /atomic barrier failed/)
	}))

test('file: a SIGKILL inside a published transaction recovers the exited owner and complete snapshot', () =>
	withFolder(async folder => {
		const { spawn } = await import('node:child_process')
		const { once } = await import('node:events')
		const moduleUrl = new URL('../use-bridge-store.ts', import.meta.url).href
		const child = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`
		import { useBridgeStore } from ${JSON.stringify(moduleUrl)};
		const store = await useBridgeStore(${JSON.stringify(folder)}, { io: { syncDir: async () => {
			process.stdout.write('PUBLISHED\\n'); await new Promise(() => {});
		} } });
		setInterval(() => {}, 1000);
		await store.commitPatch('regular', new TextEncoder().encode('{"version":2}'), [], [['regular:key', new Uint8Array([3])]], true);
	`
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		)
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('child did not publish snapshot')), 10000)
				child.once('error', reject)
				child.stdout.on('data', bytes => {
					if (String(bytes).includes('PUBLISHED')) {
						clearTimeout(timer)
						resolve()
					}
				})
				child.once('exit', code => {
					clearTimeout(timer)
					if (code !== null) reject(new Error(`child exited ${code}`))
				})
			})
			const exited = once(child, 'exit')
			child.kill('SIGKILL')
			await exited
			const store = await useBridgeStore(folder)
			assert.deepEqual(parse(await store.get('sync_version', 'regular')), { version: 2 })
			assert.deepEqual(Array.from((await store.get('mutation_mac', 'regular:key'))!), [3])
			assert.deepEqual(parse(await store.get('meta', 'mutation_mac_keys')), ['regular:key'])
		} finally {
			child.kill('SIGKILL')
		}
	}))

test('file: getMany/deleteMany snapshot key arrays synchronously at admission', () =>
	withFolder(async folder => {
		const store = await useBridgeStore(folder)
		await store.set('meta', 'first', enc(1))
		await store.set('meta', 'second', enc(2))
		const reads = ['first']
		const reading = store.getMany!('meta', reads)
		reads[0] = 'second'
		assert.deepEqual(
			(await reading).map(([key]) => key),
			['first']
		)
		const deletes = ['first']
		const deleting = store.deleteMany!('meta', deletes)
		deletes[0] = 'second'
		await deleting
		assert.equal(await store.get('meta', 'first'), null)
		assert.deepEqual(parse(await store.get('meta', 'second')), 2)
	}))

test('native migration requires an explicit offline handoff and imports only after opt-in', () =>
	withFolder(async folder => {
		await writeFile(join(folder, 'sync_version-regular.bin'), enc({ version: 7 }))
		await assert.rejects(useBridgeStore(folder), /offline migration/)
		const store = await useBridgeStore(folder, { migrate: true })
		await store.commitPatch('regular', enc({ version: 8 }), [], [], true)
		assert.deepEqual(parse(await (await useBridgeStore(folder)).get('sync_version', 'regular')), { version: 8 })
	}))

test('legacy rollback exports current JSON, applies deletions, archives the snapshot and requires a new handoff', () =>
	withFolder(async folder => {
		const { initAuthCreds, BufferJSON } = await import('../generics.ts')
		const { useLegacyMultiFileAuthState, wrapLegacyStore, prepareLegacyAuthRollback } =
			await import('../wrap-legacy-store.ts')
		await writeFile(join(folder, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer))
		await writeFile(
			join(folder, 'tctoken-removed.json'),
			JSON.stringify({ token: Buffer.from([1]), timestamp: '1' }, BufferJSON.replacer)
		)
		const auth = await useLegacyMultiFileAuthState(folder, { migrate: true })
		const store = await wrapLegacyStore(auth.state, auth.saveCreds)
		await store.storeReceivedTcToken('current', new Uint8Array([9]), '9223372036854775807')
		await store.touchTcTokenSenderTimestamp('current', '-9223372036854775808')
		await store.delete('tc_token', 'removed')
		await prepareLegacyAuthRollback(folder, { offline: true })
		const exported = JSON.parse(await readFile(join(folder, 'tctoken-current.json'), 'utf8'), BufferJSON.reviver)
		assert.deepEqual(exported, {
			token: Buffer.from([9]),
			timestamp: '9223372036854775807',
			senderTimestamp: '-9223372036854775808'
		})
		await assert.rejects(readFile(join(folder, 'tctoken-removed.json')), { code: 'ENOENT' })
		await assert.rejects(readFile(join(folder, 'bridge-legacy-v1.json')), { code: 'ENOENT' })
		await assert.rejects(useLegacyMultiFileAuthState(folder), /offline migration/)
		const next = await useLegacyMultiFileAuthState(folder, { migrate: true })
		const restored = await wrapLegacyStore(next.state, next.saveCreds)
		assert.deepEqual(decodeTokenRow((await restored.get('tc_token', 'current'))!), {
			token: [9],
			token_timestamp: (1n << 63n) - 1n,
			sender_timestamp: -(1n << 63n)
		})
	}))

test('legacy transactional views revive persisted protobuf bytes exactly like ordinary reads', () =>
	withFolder(async folder => {
		const { initAuthCreds, BufferJSON } = await import('../generics.ts')
		const { proto } = await import('../../WAProto/runtime.ts')
		const { useLegacyMultiFileAuthState, wrapLegacyStore } = await import('../wrap-legacy-store.ts')
		await writeFile(join(folder, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer))
		const auth = await useLegacyMultiFileAuthState(folder)
		const keyData = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
		await auth.state.keys.set({
			'app-state-sync-key': {
				'AQ==': proto.Message.AppStateSyncKeyData.fromObject({
					keyData,
					timestamp: 123,
					fingerprint: { rawId: 7, currentIndex: 0, deviceIndexes: [0] }
				})
			}
		})
		const ordinary = await auth.state.keys.get('app-state-sync-key', ['AQ=='])
		await auth.state.keys.bridgeTransaction!(async keys => {
			const value = (await keys.get('app-state-sync-key', ['AQ==']))['AQ=='] as { keyData: Uint8Array }
			assert.deepEqual(Array.from(value.keyData), Array.from(keyData))
			assert.deepEqual(value, ordinary['AQ=='])
		})
		const store = await wrapLegacyStore(auth.state, auth.saveCreds)
		const native = parse(await store.get('sync_key', '01'))
		assert.deepEqual(native.key_data, Array.from(keyData))
		assert.equal(native.timestamp, 123)
		const next = await useLegacyMultiFileAuthState(folder)
		const reopened = await wrapLegacyStore(next.state, next.saveCreds)
		assert.deepEqual(await reopened.get('sync_key', '01'), await store.get('sync_key', '01'))
	}))

test('legacy transaction views may retain their backend hook without recursive re-entry', () =>
	withFolder(async folder => {
		const { initAuthCreds, BufferJSON } = await import('../generics.ts')
		const { useLegacyMultiFileAuthState, wrapLegacyStore } = await import('../wrap-legacy-store.ts')
		await writeFile(join(folder, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer))
		const auth = await useLegacyMultiFileAuthState(folder)
		const transaction = auth.state.keys.bridgeTransaction!
		let nested = 0
		auth.state.keys.bridgeTransaction = work =>
			transaction(keys =>
				work({
					...keys,
					bridgeTransaction: async () => {
						nested++
						throw new Error('a transaction view must not be re-entered')
					}
				})
			)
		const store = await wrapLegacyStore(auth.state, auth.saveCreds)
		await store.storeReceivedTcToken('jid', new Uint8Array([7]), '10')
		await store.touchTcTokenSenderTimestamp('jid', '20')
		await store.set('meta', 'test', enc(true))
		assert.deepEqual(decodeTokenRow((await store.get('tc_token', 'jid'))!), {
			token: [7],
			token_timestamp: 10n,
			sender_timestamp: 20n
		})
		assert.equal(nested, 0)
	}))

test('snapshot flush joins callbacks admitted by completion of an outstanding operation', () =>
	withFolder(async folder => {
		const { defaultSyncDir } = await import('../durable-directory.ts')
		let entered!: () => void
		let release!: () => void
		const arrived = new Promise<void>(resolve => {
			entered = resolve
		})
		const gate = new Promise<void>(resolve => {
			release = resolve
		})
		let first = true
		const store = await useBridgeStore(folder, {
			io: {
				syncDir: async path => {
					if (first) {
						first = false
						entered()
						await gate
					}
					await defaultSyncDir(path)
				}
			}
		})
		const initial = store.set('meta', 'first', enc(1))
		let finished = false
		const next = initial.then(async () => {
			for (let index = 0; index < 80; index++) await store.set('meta', 'next', enc(index))
			finished = true
		})
		await arrived
		const flushed = store.flush!()
		release()
		await flushed
		assert.equal(finished, true)
		await next
	}))

test('malformed native token rows reject without rewriting the row or its index', () =>
	withFolder(async folder => {
		for (const store of [useMemoryStore(), await useBridgeStore(folder)]) {
			for (const malformed of [
				{ token: ['1'], token_timestamp: 1, sender_timestamp: null },
				{ token: [1], token_timestamp: '1', sender_timestamp: null }
			]) {
				const bytes = enc(malformed)
				await store.set('tc_token', 'invalid', bytes)
				await assert.rejects(store.touchTcTokenSenderTimestamp('invalid', '2'), /invalid TC token row/)
				assert.deepEqual(Array.from((await store.get('tc_token', 'invalid'))!), Array.from(bytes))
				assert.equal(await store.get('meta', 'tc_token_jids'), null)
			}
		}
	}))

test('OS locks ignore stale PID metadata and abandoned recovery directories', () =>
	withFolder(async folder => {
		const { mkdir } = await import('node:fs/promises')
		await writeFile(join(folder, '.bridge-atomic-v1.json.lock'), JSON.stringify({ pid: process.pid }))
		await mkdir(join(folder, '.bridge-atomic-v1.json.lock.recovery'))
		const store = await useBridgeStore(folder)
		await store.storeReceivedTcToken('jid', new Uint8Array([1]), '1')
		assert.deepEqual(decodeTokenRow((await store.get('tc_token', 'jid'))!).token, [1])
	}))

test('OS locks serialize separate adapters in the same process', () =>
	withFolder(async folder => {
		const stores = await Promise.all([useBridgeStore(folder), useBridgeStore(folder)])
		await Promise.all(
			Array.from({ length: 20 }, (_, i) => stores[i % 2]!.touchTcTokenSenderTimestamp('jid', String(i)))
		)
		assert.equal(decodeTokenRow((await stores[0]!.get('tc_token', 'jid'))!).sender_timestamp, 19n)
	}))

test('legacy undefined buckets are no-ops and valid mirror reads do not publish snapshots', () =>
	withFolder(async folder => {
		const { chmod, stat } = await import('node:fs/promises')
		const { initAuthCreds, BufferJSON } = await import('../generics.ts')
		const { useLegacyMultiFileAuthState, wrapLegacyStore } = await import('../wrap-legacy-store.ts')
		await writeFile(join(folder, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer))
		const auth = await useLegacyMultiFileAuthState(folder)
		await auth.state.keys.set({ session: undefined })
		await assert.rejects(readFile(join(folder, 'bridge-legacy-v1.json')), { code: 'ENOENT' })
		const store = await wrapLegacyStore(auth.state, auth.saveCreds)
		await store.storeReceivedTcToken('jid', new Uint8Array([7]), '7')
		const path = join(folder, 'bridge-legacy-v1.json')
		const before = await stat(path, { bigint: true })
		if (process.platform !== 'win32') await chmod(folder, 0o500)
		try {
			assert.deepEqual(decodeTokenRow((await store.get('tc_token', 'jid'))!).token, [7])
			assert.equal(await store.get('session', '551100@s.whatsapp.net.0'), null)
			assert.equal(await store.get('identity', '551100@s.whatsapp.net.0'), null)
			await auth.state.keys.set({ session: undefined })
			const after = await stat(path, { bigint: true })
			assert.equal(after.ino, before.ino)
			assert.equal(after.mtimeNs, before.mtimeNs)
		} finally {
			if (process.platform !== 'win32') await chmod(folder, 0o700)
		}
	}))

test('legacy flush waits for admitted atomic transactions and propagates their failure', async () => {
	const { initAuthCreds } = await import('../generics.ts')
	const { wrapLegacyStore } = await import('../wrap-legacy-store.ts')
	let rejectCommit!: (error: Error) => void
	const barrier = new Promise<never>((_resolve, reject) => {
		rejectCommit = reject
	})
	const store = await wrapLegacyStore(
		{
			creds: initAuthCreds(),
			keys: {
				get: async () => ({}),
				set: async () => {},
				bridgeTransaction: async () => barrier
			}
		},
		async () => {}
	)
	const write = store.touchTcTokenSenderTimestamp('jid', '1')
	const writeRejected = assert.rejects(write, /commit barrier failed/)
	let flushed = false
	const flush = store.flush().then(() => {
		flushed = true
	})
	await new Promise<void>(resolve => setImmediate(resolve))
	assert.equal(flushed, false)
	const flushRejected = assert.rejects(flush, /commit barrier failed/)
	rejectCommit(new Error('commit barrier failed'))
	await Promise.all([writeRejected, flushRejected])
})

test('legacy flush retains fast failures admitted by a completing callback', async () => {
	const { initAuthCreds } = await import('../generics.ts')
	const { wrapLegacyStore } = await import('../wrap-legacy-store.ts')
	let release!: () => void
	const barrier = new Promise<void>(resolve => {
		release = resolve
	})
	let calls = 0
	const store = await wrapLegacyStore(
		{
			creds: initAuthCreds(),
			keys: {
				get: async () => ({}),
				set: async () => {},
				bridgeTransaction: async () => {
					if (++calls === 1) {
						await barrier
						return undefined as never
					}
					throw new Error('chained commit failed')
				}
			}
		},
		async () => {}
	)
	const first = store.touchTcTokenSenderTimestamp('jid', '1')
	const chained = first.then(() =>
		assert.rejects(store.touchTcTokenSenderTimestamp('jid', '2'), /chained commit failed/)
	)
	const flushed = assert.rejects(store.flush(), /chained commit failed/)
	release()
	await Promise.all([chained, flushed])
	await store.flush()
})

test('file flush retains a settled durability failure until it is observed', () =>
	withFolder(async folder => {
		const store = await useBridgeStore(folder, {
			io: {
				syncDir: async () => {
					throw new Error('retained barrier failure')
				}
			}
		})
		await assert.rejects(store.touchTcTokenSenderTimestamp('jid', '1'), /retained barrier failure/)
		await assert.rejects(store.flush!(), /retained barrier failure/)
		await store.flush!()
	}))

for (const backend of ['legacy', 'snapshot'] as const) {
	test(`${backend} flush drains rejection-handler admissions before reporting errors`, () =>
		withFolder(async folder => {
			let releaseFirst!: () => void
			let releaseSecond!: () => void
			let enteredSecond!: () => void
			const firstGate = new Promise<void>(resolve => {
				releaseFirst = resolve
			})
			const secondGate = new Promise<void>(resolve => {
				releaseSecond = resolve
			})
			const secondEntered = new Promise<void>(resolve => {
				enteredSecond = resolve
			})
			let calls = 0
			const work = async () => {
				if (++calls === 1) {
					await firstGate
					throw new Error('initial failure')
				}
				enteredSecond()
				await secondGate
			}
			let operation: () => Promise<unknown>
			let flush: () => Promise<void>
			if (backend === 'legacy') {
				const { initAuthCreds } = await import('../generics.ts')
				const { wrapLegacyStore } = await import('../wrap-legacy-store.ts')
				const store = await wrapLegacyStore(
					{
						creds: initAuthCreds(),
						keys: {
							get: async () => ({}),
							set: async () => {},
							bridgeTransaction: async () => {
								await work()
								return undefined as never
							}
						}
					},
					async () => {}
				)
				operation = () => store.touchTcTokenSenderTimestamp('jid', '1')
				flush = () => store.flush()
			} else {
				const { createSnapshotTransactions } = await import('../snapshot-transactions.ts')
				const store = createSnapshotTransactions(
					folder,
					'test.json',
					new Set(),
					async () => new Map(),
					async () => {}
				)
				operation = () => store.transaction(work)
				flush = () => store.flush()
			}
			const first = operation()
			const chained = first.catch(() => operation())
			let settled = false
			const draining = flush().finally(() => {
				settled = true
			})
			const rejected = assert.rejects(draining, /initial failure/)
			releaseFirst()
			await secondEntered
			await new Promise<void>(resolve => setImmediate(resolve))
			assert.equal(settled, false)
			releaseSecond()
			await Promise.all([chained, rejected])
		}))
}

for (const firstStore of ['session', 'meta']) {
	test(`combined file flush joins ${firstStore} completion admitting the other backend`, () =>
		withFolder(async folder => {
			let firstEntered!: () => void
			let secondEntered!: () => void
			let releaseFirst!: () => void
			let releaseSecond!: () => void
			const firstArrival = new Promise<void>(resolve => {
				firstEntered = resolve
			})
			const secondArrival = new Promise<void>(resolve => {
				secondEntered = resolve
			})
			const firstGate = new Promise<void>(resolve => {
				releaseFirst = resolve
			})
			const secondGate = new Promise<void>(resolve => {
				releaseSecond = resolve
			})
			let barriers = 0
			const store = await useBridgeStore(folder, {
				io: {
					syncDir: async () => {
						if (++barriers === 1) {
							firstEntered()
							await firstGate
						} else if (barriers === 2) {
							secondEntered()
							await secondGate
						}
					}
				}
			})
			const first = store.set(firstStore, 'first', enc(1))
			const chained = first.then(() => store.set(firstStore === 'meta' ? 'session' : 'meta', 'second', enc(2)))
			await firstArrival
			let settled = false
			const flushed = store.flush!().finally(() => {
				settled = true
			})
			await new Promise<void>(resolve => setImmediate(resolve))
			await new Promise<void>(resolve => setImmediate(resolve))
			releaseFirst()
			await secondArrival
			await new Promise<void>(resolve => setImmediate(resolve))
			try {
				assert.equal(settled, false)
			} finally {
				releaseSecond()
				await Promise.all([chained, flushed])
			}
			assert.deepEqual(parse(await store.get(firstStore === 'meta' ? 'session' : 'meta', 'second')), 2)
		}))
}

test('legacy migration and rollback leave unrelated JSON files untouched, including old snapshot rows', () =>
	withFolder(async folder => {
		const { initAuthCreds, BufferJSON } = await import('../generics.ts')
		const { useLegacyMultiFileAuthState, wrapLegacyStore, prepareLegacyAuthRollback } =
			await import('../wrap-legacy-store.ts')
		await writeFile(join(folder, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer))
		await writeFile(join(folder, 'settings.json'), '{"theme":"old"}')
		const auth = await useLegacyMultiFileAuthState(folder)
		const store = await wrapLegacyStore(auth.state, auth.saveCreds)
		await store.touchTcTokenSenderTimestamp('jid', '1')
		const path = join(folder, 'bridge-legacy-v1.json')
		const rows = JSON.parse(await readFile(path, 'utf8'))
		assert.equal(
			rows.some(([key]: [string, string]) => key === rowKey('legacy', 'settings.json')),
			false
		)
		// Older snapshots may already contain an unrelated file; never export it.
		rows.push([rowKey('legacy', 'settings.json'), Buffer.from('{"theme":"stale"}').toString('base64')])
		await writeFile(path, JSON.stringify(rows))
		await writeFile(join(folder, 'settings.json'), '{"theme":"current"}')
		await prepareLegacyAuthRollback(folder, { offline: true })
		assert.equal(await readFile(join(folder, 'settings.json'), 'utf8'), '{"theme":"current"}')
	}))

test('native offline rollback exports current rows, deletes removed records and preserves other files', () =>
	withFolder(async folder => {
		const { prepareNativeAuthRollback } = await import('../../node-surface.ts')
		const { readdir } = await import('node:fs/promises')
		await writeFile(join(folder, 'sync_version-regular.bin'), enc({ version: 1 }))
		await writeFile(join(folder, 'meta-removed.bin'), enc('obsolete'))
		await writeFile(join(folder, 'session-other.bin'), enc('session'))
		await writeFile(join(folder, 'settings.bin'), enc('foreign'))
		const store = await useBridgeStore(folder, { migrate: true })
		await store.commitPatch('regular', enc({ version: 2 }), [], [['regular:new', enc([7])]], true)
		await store.delete('meta', 'removed')
		await store.touchTcTokenSenderTimestamp('jid', '9223372036854775807')
		await store.storeReceivedTcToken('jid', new Uint8Array([8]), '-9223372036854775808')
		await store.flush!()
		await assert.rejects(
			() => Reflect.apply(prepareNativeAuthRollback, undefined, [folder, { offline: false }]),
			/offline/
		)
		await prepareNativeAuthRollback(folder, { offline: true })
		assert.deepEqual(JSON.parse(await readFile(join(folder, 'sync_version-regular.bin'), 'utf8')), { version: 2 })
		assert.deepEqual(JSON.parse(await readFile(join(folder, 'mutation_mac-regular%3Anew.bin'), 'utf8')), [7])
		assert.deepEqual(JSON.parse(await readFile(join(folder, 'meta-mutation_mac_keys.bin'), 'utf8')), ['regular:new'])
		assert.deepEqual(decodeTokenRow(await readFile(join(folder, 'tc_token-jid.bin'))), {
			token: [8],
			token_timestamp: -(1n << 63n),
			sender_timestamp: (1n << 63n) - 1n
		})
		await assert.rejects(readFile(join(folder, 'meta-removed.bin')), { code: 'ENOENT' })
		assert.equal(await readFile(join(folder, 'session-other.bin'), 'utf8'), JSON.stringify('session'))
		assert.equal(await readFile(join(folder, 'settings.bin'), 'utf8'), JSON.stringify('foreign'))
		const files = await readdir(folder)
		assert.equal(files.includes('bridge-atomic-v1.json'), false)
		assert.ok(files.some(file => file.startsWith('bridge-atomic-v1.json.rollback-')))
		await assert.rejects(useBridgeStore(folder), /offline migration/)
		assert.deepEqual(parse(await (await useBridgeStore(folder, { migrate: true })).get('sync_version', 'regular')), {
			version: 2
		})
	}))

test('native rollback publication failure keeps the authoritative snapshot until a successful retry', () =>
	withFolder(async folder => {
		const { mkdir } = await import('node:fs/promises')
		const { prepareNativeAuthRollback } = await import('../native-auth-rollback.ts')
		const store = await useBridgeStore(folder)
		await store.commitPatch('regular', enc({ version: 3 }), [], [], true)
		const snapshot = await readFile(join(folder, 'bridge-atomic-v1.json'))
		await mkdir(join(folder, 'sync_version-regular.bin'))
		await assert.rejects(prepareNativeAuthRollback(folder, { offline: true }))
		assert.deepEqual(await readFile(join(folder, 'bridge-atomic-v1.json')), snapshot)
		await rm(join(folder, 'sync_version-regular.bin'), { recursive: true })
		await prepareNativeAuthRollback(folder, { offline: true })
		assert.deepEqual(JSON.parse(await readFile(join(folder, 'sync_version-regular.bin'), 'utf8')), { version: 3 })
	}))

test('offline rollback retries the directory barrier after an archival barrier failure', () =>
	withFolder(async folder => {
		const { exportAuthSnapshot } = await import('../snapshot-rollback.ts')
		const { nativeAtomicNamespaces, isNativeAtomicRecordFile } = await import('../native-auth-rollback.ts')
		const { defaultSyncDir } = await import('../durable-directory.ts')
		const store = await useBridgeStore(folder)
		await store.set('meta', 'value', enc('current'))
		let barriers = 0
		const syncDir = async (path: string) => {
			if (++barriers === 2) throw new Error('archival barrier failed')
			await defaultSyncDir(path)
		}
		const rollback = () =>
			exportAuthSnapshot(
				folder,
				'bridge-atomic-v1.json',
				nativeAtomicNamespaces,
				(namespace, id) => `${namespace}-${encodeURIComponent(id)}.bin`,
				isNativeAtomicRecordFile,
				syncDir
			)
		await assert.rejects(rollback(), /archival barrier failed/)
		await assert.rejects(readFile(join(folder, 'bridge-atomic-v1.json')), { code: 'ENOENT' })
		await rollback()
		assert.equal(barriers, 3)
		assert.equal(await readFile(join(folder, 'meta-value.bin'), 'utf8'), JSON.stringify('current'))
	}))

test('legacy rollback rejects unsafe snapshot filenames without archiving or discarding auth rows', () =>
	withFolder(async folder => {
		const { prepareLegacyAuthRollback } = await import('../wrap-legacy-store.ts')
		const path = join(folder, 'bridge-legacy-v1.json')
		const bytes = enc([[rowKey('legacy', 'session-../escape.json'), Buffer.from('{}').toString('base64')]])
		await writeFile(path, bytes)
		await assert.rejects(prepareLegacyAuthRollback(folder, { offline: true }), /filename/)
		assert.deepEqual(await readFile(path), bytes)
	}))
