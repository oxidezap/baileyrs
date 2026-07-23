import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, it } from 'node:test'
import { AsyncMutex, SerialQueue } from '../internal/async-primitives.ts'
import { ExpiringLruMap } from '../internal/expiring-lru-map.ts'

describe('compatibility internal primitives', () => {
	it('serializes mutex and queue work and remains usable after rejection', async () => {
		for (const primitive of [new AsyncMutex(), new SerialQueue()]) {
			const order: string[] = []
			const run = (work: () => Promise<void>) =>
				primitive instanceof AsyncMutex ? primitive.runExclusive(work) : primitive.add(work)
			const first = run(async () => {
				order.push('first:start')
				await delay(5)
				order.push('first:end')
				throw new Error('expected')
			})
			const second = run(async () => {
				order.push('second')
			})
			await assert.rejects(first, /expected/)
			await second
			assert.deepEqual(order, ['first:start', 'first:end', 'second'])
		}
	})

	it('expires entries, refreshes TTL and evicts the least-recently-used key', async () => {
		const disposed: string[] = []
		const cache = new ExpiringLruMap<string, number>({
			ttl: 20,
			max: 2,
			updateAgeOnGet: true,
			dispose: (_value, key) => disposed.push(key)
		})
		cache.set('a', 1)
		cache.set('b', 2)
		assert.equal(cache.get('a'), 1)
		cache.set('c', 3)
		assert.equal(cache.get('b'), undefined)
		assert.deepEqual(disposed, ['b'])

		await delay(12)
		assert.equal(cache.get('a'), 1)
		await delay(12)
		assert.equal(cache.get('a'), 1)
		await delay(25)
		assert.equal(cache.get('a'), undefined)
		assert.ok(disposed.includes('a'))
		cache.clear()
	})
})
