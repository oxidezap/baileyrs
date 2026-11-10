/**
 * E2E: presence + chat-state propagation.
 *
 * Two surfaces:
 *   1. Global `sendPresenceUpdate('available' | 'unavailable')` — flows
 *      via the `presence` event adapter. Subscriber sees
 *      `presence.update.presences[from].lastKnownPresence` set
 *      accordingly.
 *   2. Chat-state `sendPresenceUpdate('composing' | 'recording' |
 *      'paused', toJid)` — flows via the `chatPresence` adapter. The
 *      `recording` ↔ `composing+media:audio` mapping is the path the
 *      recent fix in `events.ts:412-427` patched, so this suite double-
 *      acts as a regression guard for that.
 */

import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import P from 'pino'
import { jidNormalizedUser } from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { waitForEvent } from './wait.ts'

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

/**
 * Which key a presence for Alice arrives under.
 *
 * Both, depending on how the server addressed the push: WA Web's
 * `validateLidUserJid` rejects a `<presence>` that is not addressed by LID, so
 * a server following that sends the LID, while chat state still carries the
 * phone number. Neither library resolves one to the other — upstream keys the
 * event on `attrs.from` as it arrives (`Socket/chats.ts:944`) and so do we
 * (`src/Socket/events.ts:621`) — so the test has to accept either. Pinning one
 * of them made these tests fail against a mock that had moved to the other,
 * which is a fact about the mock's addressing, not about presence propagating.
 */
const presenceOf = (update: { presences: Record<string, { lastKnownPresence?: string }> }, client: TestClient) => {
	const keys = [jidNormalizedUser(client.jid), client.lid ? jidNormalizedUser(client.lid) : undefined]
	for (const key of keys) {
		if (key && update.presences[key]) return update.presences[key]
	}
	return undefined
}

describe('E2E: Presence + chat state', { timeout: 60_000 }, () => {
	let alice: TestClient
	let bob: TestClient

	before(async () => {
		alice = await createTestClient({ label: 'alice', folderPrefix: 'baileys-e2e-presence' })
		bob = await createTestClient({ label: 'bob', folderPrefix: 'baileys-e2e-presence' })
		logger.info({ alice: alice.jid, bob: bob.jid }, 'paired')

		// Bob subscribes once for the suite — global presence and chat state
		// updates flow only after the server-side subscription is registered.
		await bob.sock.presenceSubscribe(alice.jid)
	})

	after(async () => {
		await Promise.all([destroyTestClient(alice), destroyTestClient(bob)])
	})

	test("composing: Alice sends 'composing' → Bob sees presence.update with composing", async () => {
		const seen = waitForEvent(bob.sock, 'presence.update', u => presenceOf(u, alice)?.lastKnownPresence === 'composing')
		await alice.sock.sendPresenceUpdate('composing', bob.jid)
		const evt = await seen
		expect(presenceOf(evt, alice)?.lastKnownPresence).toBe('composing')
	})

	test("recording: Alice sends 'recording' → Bob sees presence.update with recording (regression: composing+media=audio collapse)", async () => {
		const seen = waitForEvent(bob.sock, 'presence.update', u => presenceOf(u, alice)?.lastKnownPresence === 'recording')
		await alice.sock.sendPresenceUpdate('recording', bob.jid)
		const evt = await seen
		expect(presenceOf(evt, alice)?.lastKnownPresence).toBe('recording')
	})

	test("paused: Alice sends 'paused' → Bob sees presence.update with paused", async () => {
		const seen = waitForEvent(bob.sock, 'presence.update', u => presenceOf(u, alice)?.lastKnownPresence === 'paused')
		await alice.sock.sendPresenceUpdate('paused', bob.jid)
		const evt = await seen
		expect(presenceOf(evt, alice)?.lastKnownPresence).toBe('paused')
	})

	test("available: Alice sends global 'available' → Bob sees presence.update with available", async () => {
		const seen = waitForEvent(bob.sock, 'presence.update', u => presenceOf(u, alice)?.lastKnownPresence === 'available')
		await alice.sock.sendPresenceUpdate('available')
		const evt = await seen
		expect(presenceOf(evt, alice)?.lastKnownPresence).toBe('available')
	})

	test("unavailable: Alice sends global 'unavailable' → Bob sees presence.update with unavailable", async () => {
		const seen = waitForEvent(
			bob.sock,
			'presence.update',
			u => presenceOf(u, alice)?.lastKnownPresence === 'unavailable'
		)
		await alice.sock.sendPresenceUpdate('unavailable')
		const evt = await seen
		expect(presenceOf(evt, alice)?.lastKnownPresence).toBe('unavailable')
	})
})
