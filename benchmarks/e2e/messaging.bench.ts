import { test, describe } from 'vitest'
import { destroyClients, probe, roundtrip, settle, warmedPair } from './fixture.ts'
import { integrationOptions } from '../options.ts'

for (const size of [64, 4096]) {
	describe(`bartender/DM/${size}B`, () => {
		for (const count of [1, 16]) {
			test(`${count} messages`, async ({ bench }) => {
				const pair = await warmedPair()
				try {
					await bench(
						'send through delivery',
						{ beforeEach: () => settle() },
						probe(`DM/${size}B/${count}`, async () => {
							for (let i = 0; i < count; i++) await roundtrip(pair[0], pair[1], size)
						})
					).run(integrationOptions)
				} finally {
					await destroyClients(pair)
				}
			})
		}
	})
}
