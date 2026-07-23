/**
 * E2E: a paired client survives a full disconnect → re-create cycle.
 *
 * Production bots reconnect after WS hiccups; the on-disk auth folder
 * must be sufficient to re-establish the session WITHOUT re-pairing,
 * preserve `auth.creds.me`, and pick up wire traffic without bridge-side
 * confusion. This guards `wrapLegacyStore.flush()`, `flushAll()`,
 * and `sock.end()` drain — any of which can silently truncate state on
 * shutdown and only show up as a missing message after reconnect.
 */

import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import P from 'pino'
import { jidNormalizedUser, type WAMessage } from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { waitForMessage } from './wait.ts'

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

function getTextContent(msg: WAMessage): string | undefined {
	return msg.message?.extendedTextMessage?.text || msg.message?.conversation || undefined
}

describe('E2E: Reconnect with persisted auth', { timeout: 90_000 }, () => {
	let alice: TestClient
	let bob: TestClient
	let aliceFolder: string
	let aliceJidBefore: string

	before(async () => {
		alice = await createTestClient({ label: 'alice', folderPrefix: 'baileys-e2e-reconnect' })
		bob = await createTestClient({ label: 'bob', folderPrefix: 'baileys-e2e-reconnect' })
		aliceFolder = alice.authFolder
		aliceJidBefore = alice.jid
		logger.info({ alice: alice.jid, bob: bob.jid }, 'paired')
	})

	after(async () => {
		// `alice` may have been swapped for the reconnected instance.
		await Promise.all([destroyTestClient(alice), destroyTestClient(bob)])
	})

	test('pre-reconnect roundtrip establishes pairwise session on disk', async () => {
		const text = `pre-${Date.now()}`
		const bobReceives = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await alice.sock.sendMessage(bob.jid, { text })
		const got = await bobReceives
		expect(getTextContent(got)).toBe(text)

		// Bob → Alice closes the ratchet in both directions, so the
		// post-reconnect path tests a session that's actually advanced.
		const reverse = `pre-rev-${Date.now()}`
		const aliceReceives = waitForMessage(alice.sock, m => getTextContent(m) === reverse && !m.key?.fromMe)
		await bob.sock.sendMessage(alice.jid, { text: reverse })
		const back = await aliceReceives
		expect(getTextContent(back)).toBe(reverse)
	})

	test('disconnect → re-create with same auth folder preserves alice.user.id', async () => {
		alice.sock.setAutoReconnect(false)
		await alice.sock.end(undefined)

		const reborn = await createTestClient({
			label: 'alice',
			folderPrefix: 'baileys-e2e-reconnect',
			authFolder: aliceFolder
		})

		// Identity round-trips: same JID, same auth folder, no re-pairing.
		expect(jidNormalizedUser(reborn.jid)).toBe(jidNormalizedUser(aliceJidBefore))
		// authFolder is reused — `createTestClient` must NOT have made a
		// fresh tmpdir.
		expect(reborn.authFolder).toBe(aliceFolder)

		// Swap so subsequent tests + teardown act on the reconnected sock.
		alice = reborn
	})

	test('post-reconnect: alice → bob delivers — session loaded from disk', async () => {
		const text = `post-${Date.now()}`
		const bobReceives = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await alice.sock.sendMessage(bob.jid, { text })
		const got = await bobReceives
		expect(getTextContent(got)).toBe(text)
	})

	test('post-reconnect: bob → alice delivers — bob still trusts alice device after rebirth', async () => {
		const text = `post-rev-${Date.now()}`
		const aliceReceives = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await bob.sock.sendMessage(alice.jid, { text })
		const got = await aliceReceives
		expect(getTextContent(got)).toBe(text)
	})

	test('post-reconnect second roundtrip: ratchet keeps advancing without re-handshake', async () => {
		const text1 = `r2-1-${Date.now()}`
		const text2 = `r2-2-${Date.now()}`
		const bobGets = waitForMessage(bob.sock, m => getTextContent(m) === text1 && !m.key?.fromMe)
		const aliceGets = waitForMessage(alice.sock, m => getTextContent(m) === text2 && !m.key?.fromMe)
		await alice.sock.sendMessage(bob.jid, { text: text1 })
		await bob.sock.sendMessage(alice.jid, { text: text2 })
		await Promise.all([bobGets, aliceGets])
	})
})
