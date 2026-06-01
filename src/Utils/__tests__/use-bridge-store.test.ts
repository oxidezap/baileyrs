import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { useBridgeStore } from '../use-bridge-store.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array | null) => (u ? new TextDecoder().decode(u) : null)

describe('useBridgeStore — batch + enumeration', () => {
	let folder: string

	before(async () => {
		folder = await mkdtemp(join(tmpdir(), 'baileyrs-bridge-store-'))
	})

	after(async () => {
		await rm(folder, { recursive: true, force: true })
	})

	it('declares full capabilities', async () => {
		const store = await useBridgeStore(await mkdtemp(join(tmpdir(), 'caps-')))
		assert.deepEqual(store.capabilities, { batch: true, enumerate: true, prefixDelete: true })
	})

	it('setMany then get round-trips for a non-critical (debounced) store', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'setmany-'))
		const store = await useBridgeStore(dir)
		// `msg_secret` is NOT a critical store → writes are debounced.
		await store.setMany!('msg_secret', [
			['chat:s:a', enc('1')],
			['chat:s:b', enc('2')]
		])
		// get is cache-aside, so it sees the pending value immediately.
		assert.equal(dec(await store.get('msg_secret', 'chat:s:a')), '1')
		assert.equal(dec(await store.get('msg_secret', 'chat:s:b')), '2')
		await rm(dir, { recursive: true, force: true })
	})

	it('listKeys sees debounced writes (flushes before reading the dir)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'listkeys-'))
		const store = await useBridgeStore(dir)
		// Debounced writes — NOT yet on disk when listKeys is called.
		await store.setMany!('msg_secret', [
			['k1', enc('a')],
			['k2', enc('b')]
		])
		// listKeys must flush first, so both keys appear despite the 50ms debounce.
		assert.deepEqual((await store.listKeys!('msg_secret')).toSorted(), ['k1', 'k2'])
		await rm(dir, { recursive: true, force: true })
	})

	it('round-trips keys with special characters via encodeURIComponent', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'special-'))
		const store = await useBridgeStore(dir)
		const weird = 'chat@g.us:5511_2:13@hosted'
		await store.set('msg_secret', weird, enc('v'))
		const listed = await store.listKeys!('msg_secret')
		assert.deepEqual(listed, [weird])
		assert.equal(dec(await store.get('msg_secret', weird)), 'v')
		await rm(dir, { recursive: true, force: true })
	})

	it('listKeys is namespace-scoped and prefix-filterable', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'scope-'))
		const store = await useBridgeStore(dir)
		await store.set('lid_mapping', 'lid:1', enc('a'))
		await store.set('lid_mapping', 'lid:2', enc('b'))
		await store.set('lid_mapping', 'pn:9', enc('c'))
		await store.set('msg_secret', 'lid:1', enc('d')) // other namespace

		assert.deepEqual((await store.listKeys!('lid_mapping')).toSorted(), ['lid:1', 'lid:2', 'pn:9'])
		assert.deepEqual((await store.listKeys!('lid_mapping', 'lid:')).toSorted(), ['lid:1', 'lid:2'])
		assert.deepEqual(await store.listKeys!('msg_secret'), ['lid:1'])
		await rm(dir, { recursive: true, force: true })
	})

	it('getMany returns only found keys', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'getmany-'))
		const store = await useBridgeStore(dir)
		await store.setMany!('msg_secret', [
			['a', enc('A')],
			['b', enc('B')]
		])
		const got = await store.getMany!('msg_secret', ['a', 'nope', 'b'])
		const asMap = new Map(got.map(([k, v]) => [k, dec(v)]))
		assert.equal(asMap.size, 2)
		assert.equal(asMap.get('a'), 'A')
		assert.equal(asMap.get('b'), 'B')
		await rm(dir, { recursive: true, force: true })
	})

	it('deleteMany removes the listed keys (and they vanish from listKeys)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'delmany-'))
		const store = await useBridgeStore(dir)
		await store.setMany!('msg_secret', [
			['a', enc('1')],
			['b', enc('2')],
			['c', enc('3')]
		])
		await store.deleteMany!('msg_secret', ['a', 'c'])
		assert.deepEqual(await store.listKeys!('msg_secret'), ['b'])
		assert.equal(await store.get('msg_secret', 'a'), null)
		await rm(dir, { recursive: true, force: true })
	})

	it('deletePrefix clears matching keys and returns the count', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'delpfx-'))
		const store = await useBridgeStore(dir)
		await store.set('sender_key_devices', 'g1', enc('a'))
		await store.set('sender_key_devices', 'g2', enc('b'))

		const removed = await store.deletePrefix!('sender_key_devices', '')
		assert.equal(removed, 2)
		assert.deepEqual(await store.listKeys!('sender_key_devices'), [])
		await rm(dir, { recursive: true, force: true })
	})

	it('persists across store instances pointed at the same folder', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'persist-'))
		const a = await useBridgeStore(dir)
		await a.setMany!('msg_secret', [['k', enc('persisted')]])
		await a.flush!() // ensure debounced write hits disk before reopening

		const b = await useBridgeStore(dir)
		assert.equal(dec(await b.get('msg_secret', 'k')), 'persisted')
		assert.deepEqual(await b.listKeys!('msg_secret'), ['k'])
		await rm(dir, { recursive: true, force: true })
	})

	// Supports the Rust get_all_lid_mappings enumerate path: it lists the
	// `lid:`-prefixed keys and strips the prefix. Verify the prefix filter
	// returns the bare keys and excludes the reverse `pn:` siblings.
	it('lid_mapping: lid: prefix enumeration excludes pn: siblings', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'lidmap-'))
		const store = await useBridgeStore(dir)
		await store.set('lid_mapping', 'lid:5511', enc('{"lid":"5511"}'))
		await store.set('lid_mapping', 'lid:5512', enc('{"lid":"5512"}'))
		await store.set('lid_mapping', 'pn:99', enc('5511'))

		const lidKeys = (await store.listKeys!('lid_mapping', 'lid:')).toSorted()
		assert.deepEqual(lidKeys, ['lid:5511', 'lid:5512'])
		// Rust strips `lid:` → ['5511','5512'].
		assert.deepEqual(
			lidKeys.map(k => k.slice('lid:'.length)),
			['5511', '5512']
		)
		await rm(dir, { recursive: true, force: true })
	})

	// Codex review: stale meta-*.bin index files from the pre-enumerate format
	// must be invisible to listKeys of real namespaces (filter is `<store>-`).
	it('stale meta-* index files do not leak into other namespaces', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'stale-meta-'))
		const store = await useBridgeStore(dir)
		// Simulate a leftover index file from the old format.
		await store.set('meta', 'msg_secret_keys', enc('["chat:s:a"]'))
		// And a real secret.
		await store.set('msg_secret', 'chat:s:a', enc('secret'))

		// listKeys('msg_secret') must see ONLY the real key, not the meta file.
		assert.deepEqual(await store.listKeys!('msg_secret'), ['chat:s:a'])
		// And the meta namespace is separately enumerable (not cross-contaminated).
		assert.deepEqual(await store.listKeys!('meta'), ['msg_secret_keys'])
		await rm(dir, { recursive: true, force: true })
	})
})
