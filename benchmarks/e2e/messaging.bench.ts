import { test, describe } from 'vitest'
import { destroyClients, roundtrip, settle, warmedPair } from './fixture.ts'
import { integrationOptions, memoryMode } from '../options.ts'

// A single 4 KiB DM is not measured: its peak memory moved between ~96 KB and
// ~167 KB on unchanged code. The 16-message row covers the same path, amortized.
const counts: Record<number, number[]> = { 64: [1, 16], 4096: [16] }
// The single 64 B DM keeps its simulation row only. Its peak memory moved
// between ~42 KB and ~48 KB on unchanged code, most likely from how many socket
// write buffers were outstanding at once. The 16-message row stays within 3%.
const skipMemory = (size: number, count: number) => memoryMode && size === 64 && count === 1

for (const size of [64, 4096]) {
	describe(`bartender/DM/${size}B`, () => {
		for (const count of counts[size]!) {
			test.skipIf(skipMemory(size, count))(`${count} messages`, async ({ bench }) => {
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
