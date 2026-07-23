import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JsStoreCallbacks } from 'whatsapp-rust-bridge'
import { projectNativeStore } from '../legacy-store/native-projection.ts'
import { NativeStore } from '../legacy-store/constants.ts'
import { legacyKey, nativeKey } from '../legacy-store/routing.ts'
import { buildBridgeSenderKeyBytes, fill } from '../../Utils/__tests__/_legacy-store-fixtures.ts'

const makeNativeStore = () => {
	const buckets = new Map<string, Map<string, Uint8Array>>()
	const batchWrites: Array<[string, number]> = []
	const bucket = (namespace: string) => {
		let result = buckets.get(namespace)
		if (!result) {
			result = new Map()
			buckets.set(namespace, result)
		}
		return result
	}
	const store: JsStoreCallbacks = {
		get: async (namespace, key) => bucket(namespace).get(key) ?? null,
		set: async (namespace, key, value) => {
			bucket(namespace).set(key, value)
		},
		delete: async (namespace, key) => {
			bucket(namespace).delete(key)
		},
		getMany: async (namespace, keys) =>
			keys.flatMap(key => {
				const value = bucket(namespace).get(key)
				return value ? [[key, value] as [string, Uint8Array]] : []
			}),
		setMany: async (namespace, entries) => {
			batchWrites.push([namespace, entries.length])
			for (const [key, value] of entries) bucket(namespace).set(key, value)
		},
		deleteMany: async (namespace, keys) => {
			for (const key of keys) bucket(namespace).delete(key)
		},
		deletePrefix: async (namespace, prefix) => {
			let count = 0
			for (const key of bucket(namespace).keys()) {
				if (key.startsWith(prefix)) {
					bucket(namespace).delete(key)
					count++
				}
			}
			return count
		}
	}
	return { store, buckets, batchWrites, bucket }
}

describe('native store legacy projection', () => {
	it('round-trips key routing for PN, LID and hosted namespaces', () => {
		for (const [namespace, native, legacy] of [
			[NativeStore.SESSION, '5511999999999@c.us.0', '5511999999999.0'],
			[NativeStore.SESSION, '123456789:7@lid.0', '123456789_1.7'],
			[NativeStore.SESSION, '5511999999999:99@hosted.0', '5511999999999_128.99'],
			[NativeStore.IDENTITY, '123456789:99@hosted.lid.0', '123456789_129.99']
		] as const) {
			assert.equal(legacyKey(namespace, native), legacy)
			assert.equal(nativeKey(namespace, legacy), native)
		}
	})

	it('converts values with the shared codecs and batches writes per namespace', async () => {
		const { store, bucket, batchWrites } = makeNativeStore()
		const keys = projectNativeStore(store)
		const pair = { public: fill(32, 3), private: fill(32, 5) }

		await keys.set({
			'pre-key': { '7': pair },
			'lid-mapping': {
				'5511999999999': '123456789',
				'123456789_reverse': '5511999999999'
			}
		})
		assert.deepEqual(
			batchWrites.toSorted(([left], [right]) => left.localeCompare(right)),
			[
				['lid_mapping', 2],
				['prekey', 1]
			]
		)
		assert.ok(bucket('prekey').has('7'))
		assert.ok(bucket('lid_mapping').has('pn:5511999999999'))
		assert.ok(bucket('lid_mapping').has('lid:123456789'))

		const loadedPair = await keys.get('pre-key', ['7'])
		assert.ok(loadedPair['7'])
		assert.ok(loadedPair['7'].public instanceof Uint8Array)
		assert.ok(loadedPair['7'].private instanceof Uint8Array)
		assert.deepEqual([...loadedPair['7'].public], [...pair.public])
		assert.deepEqual([...loadedPair['7'].private], [...pair.private])
		const mappings = await keys.get('lid-mapping', ['5511999999999', '123456789_reverse'])
		assert.deepEqual(mappings, {
			'5511999999999': '123456789',
			'123456789_reverse': '5511999999999'
		})
	})

	it('reads and deletes sender-key state instead of silently dropping mutations', async () => {
		const { store, bucket } = makeNativeStore()
		const keys = projectNativeStore(store)
		const nativeId = '120363000000000000@g.us:123456789@lid.0'
		const legacyId = '120363000000000000@g.us::123456789_1::0'
		bucket('sender_key').set(nativeId, buildBridgeSenderKeyBytes())

		const loaded = await keys.get('sender-key', [legacyId])
		assert.ok(loaded[legacyId] instanceof Uint8Array)
		await keys.set({ 'sender-key': { [legacyId]: null } })
		assert.equal(bucket('sender_key').has(nativeId), false)
	})

	it('clears every projected namespace through native batch primitives', async () => {
		const { store, bucket } = makeNativeStore()
		const keys = projectNativeStore(store)
		bucket('session').set('5511999999999@c.us.0', Uint8Array.of(1))
		bucket('prekey').set('7', Uint8Array.of(2))
		await keys.clear?.()
		assert.equal(bucket('session').size, 0)
		assert.equal(bucket('prekey').size, 0)
	})
})
