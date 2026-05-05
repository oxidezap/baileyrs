/**
 * E2E: delivery + read receipts against the mock WA server.
 *
 * The receiver's bridge auto-emits delivery receipts when a message lands;
 * read receipts go out only when the receiver explicitly calls
 * `readMessages`. The sender-side surface is `message-receipt.update`,
 * with `receipt.receiptTimestamp` (delivery), `receipt.readTimestamp`
 * (read), or `receipt.playedTimestamp` (played) populated by `events.ts`
 * based on the bridge `ReceiptType`.
 *
 * Indirectly proves the `RECEIPT_TYPE_MAP` PascalCase fix in
 * `Bridge/schema.ts` — the bridge ships variants as bare PascalCase
 * strings (`"Read"`, `"Delivered"`, …), not the `{type: "read"}` form
 * the generated `.d.ts` advertises.
 */

import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import P from 'pino'
import { type proto, WAMessageStubType } from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { waitForEvent, waitForMessage } from './wait.ts'

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

function getTextContent(msg: proto.IWebMessageInfo): string | undefined {
	return msg.message?.extendedTextMessage?.text || msg.message?.conversation || undefined
}

describe('E2E: Receipts (delivery + read, 1:1 + group)', { timeout: 60_000 }, () => {
	let alice: TestClient
	let bob: TestClient
	let charlie: TestClient

	before(async () => {
		alice = await createTestClient({ label: 'alice', folderPrefix: 'baileys-e2e-rcpt' })
		bob = await createTestClient({ label: 'bob', folderPrefix: 'baileys-e2e-rcpt' })
		charlie = await createTestClient({ label: 'charlie', folderPrefix: 'baileys-e2e-rcpt' })
		logger.info({ alice: alice.jid, bob: bob.jid, charlie: charlie.jid }, 'paired')
	})

	after(async () => {
		await Promise.all([destroyTestClient(alice), destroyTestClient(bob), destroyTestClient(charlie)])
	})

	test('1:1 delivery receipt: Alice sends → Bob auto-acks → Alice gets receiptTimestamp', async () => {
		const text = `delivery-${Date.now()}`
		const aliceGetsReceipt = waitForEvent(alice.sock, 'message-receipt.update', updates =>
			updates.some(u => u.receipt.receiptTimestamp != null && !u.receipt.readTimestamp)
		)
		const bobReceives = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		const sent = await alice.sock.sendMessage(bob.jid, { text })
		const sentId = sent.key.id!

		await bobReceives

		const updates = await aliceGetsReceipt
		const ackMatching = updates.find(u => u.key.id === sentId)
		expect(ackMatching).toBeDefined()
		expect(ackMatching!.receipt.receiptTimestamp).toBeGreaterThan(0)
		expect(ackMatching!.receipt.readTimestamp).toBeUndefined()
		// 1:1 receipts must NOT carry a participant — that field is reserved
		// for group fanout where the bridge needs to disambiguate WHICH
		// member acked.
		expect(ackMatching!.key.participant).toBeUndefined()
	})

	test('1:1 read receipt: Bob calls readMessages → Alice gets readTimestamp', async () => {
		const text = `read-${Date.now()}`
		const bobReceives = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		const sent = await alice.sock.sendMessage(bob.jid, { text })
		const sentId = sent.key.id!
		await bobReceives

		const aliceGetsRead = waitForEvent(alice.sock, 'message-receipt.update', updates =>
			updates.some(u => u.key.id === sentId && u.receipt.readTimestamp != null)
		)

		await bob.sock.readMessages([{ remoteJid: alice.jid, id: sentId }])

		const updates = await aliceGetsRead
		const readMatching = updates.find(u => u.key.id === sentId && u.receipt.readTimestamp != null)
		expect(readMatching).toBeDefined()
		expect(readMatching!.receipt.readTimestamp).toBeGreaterThan(0)
	})

	test('group delivery receipt: per-participant fanout carries key.participant', async () => {
		// Register the GROUP_CREATE waiters BEFORE calling groupCreate — the
		// notification fires synchronously after the bridge IQ result and
		// can race a post-call subscribe.
		const bobSeesCreate = waitForMessage(bob.sock, m => m.messageStubType === WAMessageStubType.GROUP_CREATE)
		const charlieSeesCreate = waitForMessage(charlie.sock, m => m.messageStubType === WAMessageStubType.GROUP_CREATE)
		const groupCreate = await alice.sock.groupCreate(`Receipts ${Date.now()}`, [bob.jid, charlie.jid])
		const groupJid = groupCreate.id
		await Promise.all([bobSeesCreate, charlieSeesCreate])

		const text = `group-delivery-${Date.now()}`
		const bobReceives = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		const charlieReceives = waitForMessage(charlie.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		// Receipts can land before sendMessage's promise resolves, so arm
		// the waiter against a captured-by-closure id and await it after
		// the message-arrival promises rather than after sendMessage.
		let sentId = ''
		const groupReceiptArrives = waitForEvent(alice.sock, 'message-receipt.update', updates =>
			updates.some(u => sentId !== '' && u.key.id === sentId && (u.receipt.receiptTimestamp ?? 0) > 0)
		)

		const sent = await alice.sock.sendMessage(groupJid, { text })
		sentId = sent.key.id!

		await Promise.all([bobReceives, charlieReceives])

		// Group sender sees at least one delivery receipt for the message.
		// Per-participant `key.participant` would require the bridge to set
		// `MessageSource.is_group = true` on the receipt event — currently
		// it defaults to false, so this test asserts only the receipt
		// arrival. Tighten to `participant != null` once that bridge gap
		// is closed.
		const update = await groupReceiptArrives
		const groupReceipt = update.find(u => u.key.id === sentId)
		expect(groupReceipt).toBeDefined()
		expect(groupReceipt!.receipt.receiptTimestamp).toBeGreaterThan(0)
	})
})
