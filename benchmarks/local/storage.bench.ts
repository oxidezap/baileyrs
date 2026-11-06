import assert from 'node:assert/strict'
import { test, describe } from 'vitest'
import { createAuthenticationState } from '../../src/Compatibility/auth-state.ts'
import { useMemoryStore } from '../../src/index.ts'
import { options } from '../options.ts'

test('auth/create fresh host state', async ({ bench }) => {
	await bench('auth/create fresh host state', async () => {
		const auth = await createAuthenticationState(useMemoryStore())
		if (!auth.creds) throw new Error('missing credentials')
	}).run(options)
})

for (const size of [256, 4096]) {
	describe(`host store/${size}B`, () => {
		const store = useMemoryStore()
		const bytes = new Uint8Array(size).fill(42)
		const keys = Array.from({ length: 32 }, (_, i) => `key-${i}`)
		const entries: [string, Uint8Array][] = keys.map(key => [key, bytes])
		test('write and read one row', async ({ bench }) => {
			await bench('write and read one row', async () => {
				await store.set('session', keys[0]!, bytes)
				const result = await store.get('session', keys[0]!)
				assert.equal(result?.byteLength, size)
			}).run(options)
		})
		test('write and read 32 rows', async ({ bench }) => {
			await bench('write and read 32 rows', async () => {
				await store.setMany!('session', entries)
				const result = await store.getMany!('session', keys)
				assert.equal(result.length, keys.length)
			}).run(options)
		})
	})
}
