import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeKeyedMutex, makeMutex } from '../Compatibility/internal/make-mutex.ts'

const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

describe('compatibility mutex helpers', () => {
	it('serializes work in FIFO order and releases after rejection', async () => {
		const mutex = makeMutex()
		const gate = deferred()
		const order: string[] = []
		const first = mutex.mutex(async () => {
			order.push('first:start')
			await gate.promise
			order.push('first:end')
		})
		const second = mutex.mutex(() => order.push('second'))

		await Promise.resolve()
		assert.deepEqual(order, ['first:start'])
		gate.resolve()
		await Promise.all([first, second])
		assert.deepEqual(order, ['first:start', 'first:end', 'second'])

		await assert.rejects(() => mutex.mutex(async () => Promise.reject(new Error('expected'))), /expected/)
		assert.equal(await mutex.mutex(() => 7), 7)
	})

	it('serializes equal keys while allowing distinct keys to progress', async () => {
		const keyed = makeKeyedMutex()
		const gate = deferred()
		const order: string[] = []
		const first = keyed.mutex('a', async () => {
			order.push('a:first')
			await gate.promise
		})
		const second = keyed.mutex('a', () => order.push('a:second'))
		const parallel = keyed.mutex('b', () => order.push('b:first'))

		await Promise.resolve()
		await parallel
		assert.deepEqual(order, ['a:first', 'b:first'])
		gate.resolve()
		await Promise.all([first, second])
		assert.deepEqual(order, ['a:first', 'b:first', 'a:second'])
	})
})
