import { test, describe } from 'vitest'
import { destroyClients, roundtrip, settle, warmedPair } from './fixture.ts'
import { integrationOptions } from '../options.ts'

// A single 4 KiB DM is not measured: its peak memory moved between ~96 KB and
// ~167 KB on unchanged code. The 16-message row covers the same path, amortized.
const counts: Record<number, number[]> = { 64: [1, 16], 4096: [16] }

for (const size of [64, 4096]) {
	describe(`bartender/DM/${size}B`, () => {
		for (const count of counts[size]!) {
			test(`${count} messages`, async ({ bench }) => {
				const pair = await warmedPair()
				try {
					await bench('send through delivery', { beforeEach: () => settle() }, async () => {
						for (let i = 0; i < count; i++) await roundtrip(pair[0], pair[1], size)
					}).run(integrationOptions)
				} finally {
					await destroyClients(pair)
				}
			})
		}
	})
}
