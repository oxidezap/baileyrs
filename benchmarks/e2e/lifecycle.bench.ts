import { test, describe } from 'vitest'
import { createTestClient, destroyTestClient, roundtrip, settle, type TestClient } from './fixture.ts'
import { integrationOptions, memoryMode } from '../options.ts'

describe('bartender/lifecycle', () => {
	// Simulation only. The first DM's peak memory was bimodal on unchanged code
	// (~164 KB or ~230-244 KB, same allocation count), set by how socket writes
	// and Signal session persistence happened to overlap. Simulation stays
	// within 2.5%.
	test.skipIf(memoryMode)('first DM', async ({ bench }) => {
		let sender: TestClient | undefined
		let receiver: TestClient | undefined
		const cleanup = async () => {
			if (sender) {
				await destroyTestClient(sender)
				sender = undefined
			}
			if (receiver) {
				await destroyTestClient(receiver)
				receiver = undefined
			}
		}
		try {
			await bench(
				'establish Signal session and deliver',
				{
					beforeEach: async () => {
						sender = await createTestClient({ label: 'bench-first-sender' })
						receiver = await createTestClient({ label: 'bench-first-receiver' })
						// Post-pairing uploads and notifications are not part of the first DM.
						await settle()
					},
					afterEach: cleanup
				},
				async () => {
					await roundtrip(sender!, receiver!)
				}
			).run(integrationOptions)
		} finally {
			await cleanup()
		}
	})
})
