import assert from 'node:assert/strict'
import { test, describe } from 'vitest'
import { createAuthenticationState } from '../../src/Compatibility/auth-state.ts'
import { useMemoryStore } from '../../src/index.ts'
import { options, repeatAsync } from '../options.ts'

test('auth/create fresh host state', async ({ bench }) => {
	await bench('auth/create fresh host state', async () => {
		const auth = await createAuthenticationState(useMemoryStore())
		if (!auth.creds) throw new Error('missing credentials')
	}).run(options)
})

// One-row operations repeat 100 times and 32-row batches 10 times, so each
// measured call covers enough work to amortize one-off GC and page costs.
const rowRepeats = 100
const batchRepeats = 10

for (const size of [256, 4096]) {
	describe(`host store/${size}B`, () => {
		const store = useMemoryStore()
		const bytes = new Uint8Array(size).fill(42)
		const keys = Array.from({ length: 32 }, (_, i) => `key-${i}`)
		const entries: [string, Uint8Array][] = keys.map(key => [key, bytes])
		test(`write and read one row x${rowRepeats}`, async ({ bench }) => {
			await bench(`write and read one row x${rowRepeats}`, async () => {
				await repeatAsync(async () => {
					await store.set('session', keys[0]!, bytes)
					const result = await store.get('session', keys[0]!)
					assert.equal(result?.byteLength, size)
				}, rowRepeats)
			}).run(options)
		})
		test(`write and read 32 rows x${batchRepeats}`, async ({ bench }) => {
			await bench(`write and read 32 rows x${batchRepeats}`, async () => {
				await repeatAsync(async () => {
					await store.setMany!('session', entries)
					const result = await store.getMany!('session', keys)
					assert.equal(result.length, keys.length)
				}, batchRepeats)
			}).run(options)
		})
	})
}

// Atomic callbacks (tc-token updates, app-state patches) run per message on a
// store that already holds the whole session: pre-keys, sessions and sender keys.
describe('host store/atomic', () => {
	const store = useMemoryStore()
	const storedRows = 2048
	test(`tc-token update with ${storedRows} stored rows x${rowRepeats}`, async ({ bench }) => {
		const row = new Uint8Array(256).fill(7)
		await store.setMany!(
			'session',
			Array.from({ length: storedRows }, (_, i): [string, Uint8Array] => [`${100_000 + i}.0`, row])
		)
		let timestamp = 1_700_000_000
		await bench(`tc-token update with ${storedRows} stored rows x${rowRepeats}`, async () => {
			await repeatAsync(async () => {
				await store.touchTcTokenSenderTimestamp('5511900000001@s.whatsapp.net', String(timestamp++))
			}, rowRepeats)
		}).run(options)
	})
})
