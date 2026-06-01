import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { useMemoryStore } from '../use-memory-store.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array | null) => (u ? new TextDecoder().decode(u) : null)

describe('useMemoryStore — batch + enumeration', () => {
	it('declares full capabilities', () => {
		const store = useMemoryStore()
		assert.deepEqual(store.capabilities, { batch: true, enumerate: true, prefixDelete: true })
	})

	it('setMany writes every entry; get reads them back', async () => {
		const store = useMemoryStore()
		await store.setMany!('msg_secret', [
			['a', enc('1')],
			['b', enc('2')],
			['c', enc('3')]
		])
		assert.equal(dec(await store.get('msg_secret', 'a')), '1')
		assert.equal(dec(await store.get('msg_secret', 'b')), '2')
		assert.equal(dec(await store.get('msg_secret', 'c')), '3')
	})

	it('setMany with empty array is a no-op', async () => {
		const store = useMemoryStore()
		await store.setMany!('msg_secret', [])
		assert.deepEqual(await store.listKeys!('msg_secret'), [])
	})

	it('getMany returns only found keys, in any order', async () => {
		const store = useMemoryStore()
		await store.setMany!('s', [
			['x', enc('X')],
			['y', enc('Y')]
		])
		const got = await store.getMany!('s', ['x', 'missing', 'y'])
		const asMap = new Map(got.map(([k, v]) => [k, dec(v)]))
		assert.equal(asMap.size, 2)
		assert.equal(asMap.get('x'), 'X')
		assert.equal(asMap.get('y'), 'Y')
		assert.equal(asMap.has('missing'), false)
	})

	it('listKeys is namespace-scoped and prefix-filterable', async () => {
		const store = useMemoryStore()
		await store.set('s1', 'lid:1', enc('a'))
		await store.set('s1', 'lid:2', enc('b'))
		await store.set('s1', 'pn:9', enc('c'))
		await store.set('s2', 'lid:1', enc('d')) // different namespace, must not leak

		assert.deepEqual((await store.listKeys!('s1')).toSorted(), ['lid:1', 'lid:2', 'pn:9'])
		assert.deepEqual((await store.listKeys!('s1', 'lid:')).toSorted(), ['lid:1', 'lid:2'])
		assert.deepEqual(await store.listKeys!('s2'), ['lid:1'])
	})

	it('deleteMany removes the given keys only', async () => {
		const store = useMemoryStore()
		await store.setMany!('s', [
			['a', enc('1')],
			['b', enc('2')],
			['c', enc('3')]
		])
		await store.deleteMany!('s', ['a', 'c'])
		assert.deepEqual(await store.listKeys!('s'), ['b'])
	})

	it('deletePrefix clears matching keys and returns the count', async () => {
		const store = useMemoryStore()
		await store.set('s', 'lid:1', enc('a'))
		await store.set('s', 'lid:2', enc('b'))
		await store.set('s', 'pn:9', enc('c'))

		const removed = await store.deletePrefix!('s', 'lid:')
		assert.equal(removed, 2)
		assert.deepEqual(await store.listKeys!('s'), ['pn:9'])
	})

	it('deletePrefix with empty prefix clears the whole namespace', async () => {
		const store = useMemoryStore()
		await store.set('s', 'a', enc('1'))
		await store.set('s', 'b', enc('2'))
		await store.set('other', 'c', enc('3'))

		const removed = await store.deletePrefix!('s', '')
		assert.equal(removed, 2)
		assert.deepEqual(await store.listKeys!('s'), [])
		assert.deepEqual(await store.listKeys!('other'), ['c'])
	})

	it('getMany on empty input is a no-op', async () => {
		const store = useMemoryStore()
		assert.deepEqual(await store.getMany!('s', []), [])
	})

	it('lid_mapping: lid: prefix enumeration excludes pn: siblings', async () => {
		const store = useMemoryStore()
		await store.set('lid_mapping', 'lid:5511', enc('a'))
		await store.set('lid_mapping', 'lid:5512', enc('b'))
		await store.set('lid_mapping', 'pn:99', enc('c'))
		assert.deepEqual((await store.listKeys!('lid_mapping', 'lid:')).toSorted(), ['lid:5511', 'lid:5512'])
	})
})
