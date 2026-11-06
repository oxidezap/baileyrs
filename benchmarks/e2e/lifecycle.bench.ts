import { test, describe } from 'vitest'
import { createTestClient, destroyTestClient, roundtrip, settle, type TestClient } from './fixture.ts'
import { integrationOptions } from '../options.ts'

describe('bartender/lifecycle', () => {
	test('first DM', async ({ bench }) => {
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
