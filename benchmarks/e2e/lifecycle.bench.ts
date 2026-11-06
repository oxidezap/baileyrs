import assert from 'node:assert/strict'
import { test, describe } from 'vitest'
import { createTestClient, destroyTestClient, roundtrip, settle, warmedPair, type TestClient } from './fixture.ts'
import { integrationOptions } from '../options.ts'

describe('bartender/lifecycle', () => {
	test('fresh session', async ({ bench }) => {
		let client: TestClient | undefined
		try {
			await bench(
				'pairing through startup sync',
				{
					// Let the previous client's teardown traffic finish first.
					beforeEach: () => settle(),
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
						await destroyTestClient(pair[1])
						await settle()
						pair[0].sock.setAutoReconnect(false)
						await pair[0].sock.end(undefined)
						// Resume once without measuring it. Anything the server still
						// queued for this account (late receipts, history sync, offline
						// notifications) is delivered and acknowledged here, so the
						// measured resume always starts from an empty offline queue.
						previous = await createTestClient({ label: 'bench-resume-drain', authFolder: pair[0].authFolder })
						await settle()
						previous.sock.setAutoReconnect(false)
						await previous.sock.end(undefined)
						await settle()
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
