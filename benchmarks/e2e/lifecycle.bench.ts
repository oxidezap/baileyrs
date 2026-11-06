import assert from 'node:assert/strict'
import { test, describe } from 'vitest'
import { createTestClient, destroyTestClient, roundtrip, warmedPair, type TestClient } from './fixture.ts'
import { integrationOptions } from '../options.ts'

describe('bartender/lifecycle', () => {
	test('fresh session', async ({ bench }) => {
		let client: TestClient | undefined
		try {
			await bench(
				'pairing through startup sync',
				{
					afterEach: async () => {
						if (client) {
							await destroyTestClient(client)
							client = undefined
						}
					}
				},
				async () => {
					client = await createTestClient({ label: 'bench-fresh' })
				}
			).run(integrationOptions)
		} finally {
			if (client) await destroyTestClient(client)
		}
	})
	test('resume session', async ({ bench }) => {
		let previous: TestClient | undefined
		let resumed: TestClient | undefined
		const cleanup = async () => {
			if (resumed) {
				await destroyTestClient(resumed)
				resumed = undefined
			}
			if (previous) {
				await destroyTestClient(previous)
				previous = undefined
			}
		}
		try {
			await bench(
				'persisted auth through startup sync',
				{
					beforeEach: async () => {
						// Finish real traffic before shutdown so pairing's initial history
						// notifications do not become a variable offline backlog on resume.
						const pair = await warmedPair()
						previous = pair[0]
						await destroyTestClient(pair[1])
						previous.sock.setAutoReconnect(false)
						await previous.sock.end(undefined)
					},
					afterEach: cleanup
				},
				async () => {
					let requestedPairing = false
					resumed = await createTestClient({
						label: 'bench-resume',
						authFolder: previous!.authFolder,
						onSocket: sock =>
							sock.ev.on('connection.update', update => {
								if (update.qr) requestedPairing = true
							})
					})
					assert.equal(requestedPairing, false, 'resume unexpectedly requested pairing')
					assert.equal(resumed.jid, previous!.jid, 'resume changed account identity')
				}
			).run(integrationOptions)
		} finally {
			await cleanup()
		}
	})
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
