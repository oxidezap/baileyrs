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
		const store = await useBridgeStore(folder)
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
