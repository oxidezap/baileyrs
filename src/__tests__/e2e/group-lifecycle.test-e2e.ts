/**
 * E2E: Group lifecycle against the mock WA server.
 *
 * Three pairings (alice, bob, charlie). Alice creates a group with both
 * others, the trio messages, alice promotes bob → demotes bob → kicks
 * charlie. For every group action we assert that:
 *
 *   - the high-level event (`group-participants.update`) lands with the
 *     expected `action` and participant list, AND
 *   - the synthesized stub `messages.upsert` lands with the matching
 *     `WAMessageStubType.GROUP_PARTICIPANT_*` and `messageStubParameters`.
 *
 * The stub-message path is the one upstream-Baileys consumers (sung, etc.)
 * use to update their persisted admin state — without it `verificarBotAdmin`
 * stays stale across promotion. Covering it from a real wire roundtrip
 * (mock server → core → bridge → events.ts → consumer) protects against
 * regressions that proto-level unit tests would miss.
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

/** Mock-server JIDs include a device suffix `phone:N@s.whatsapp.net`; strip it. */
function plainPnJid(jid: string): string {
	return jid.replace(/:\d+@/, '@')
}

/**
 * Build the LID-form JID string the mock server publishes for a paired
 * client. The notifications carry participant JIDs in `@lid` form when the
 * group is LID-addressed (which is the mock's default).
 */
function lidJid(client: TestClient): string {
	if (!client.lid) throw new Error(`${client.label} has no LID — was it paired?`)
	return plainPnJid(client.lid)
}

describe('E2E: Group lifecycle (create → message → promote → demote → kick)', { timeout: 90_000 }, () => {
	let alice: TestClient
	let bob: TestClient
	let charlie: TestClient
	let groupJid: string

	before(async () => {
		;[alice, bob, charlie] = await Promise.all([
			createTestClient({ label: 'alice', folderPrefix: 'baileys-grp' }),
			createTestClient({ label: 'bob', folderPrefix: 'baileys-grp' }),
			createTestClient({ label: 'charlie', folderPrefix: 'baileys-grp' })
		])
		logger.info({ alice: alice.jid, bob: bob.jid, charlie: charlie.jid }, 'Trio paired')
	})

	after(async () => {
		await Promise.all([destroyTestClient(alice), destroyTestClient(bob), destroyTestClient(charlie)])
	})

	test('Alice creates the group with bob+charlie → all three see the create notification (groups.update + GROUP_CREATE stub)', async () => {
		const subject = `Trio ${Date.now()}`

		// Mock-server (and real WhatsApp) fan a single `<notification
		// type="w:gp2"><create>...` to every member, including the creator.
		// There is no `<add>` action for a brand-new group — the existing
		// members got nothing because there were none. So we wait for
		// `groups.update` (which our `case 'create'` produces, id-only) and
		// the synthesized `GROUP_CREATE` stub on every client.
		const aliceGroupsUpdate = waitForEvent(alice.sock, 'groups.update')
		const bobGroupsUpdate = waitForEvent(bob.sock, 'groups.update')
		const charlieGroupsUpdate = waitForEvent(charlie.sock, 'groups.update')
		const aliceStubCreate = waitForMessage(alice.sock, m => m.messageStubType === WAMessageStubType.GROUP_CREATE)
		const bobStubCreate = waitForMessage(bob.sock, m => m.messageStubType === WAMessageStubType.GROUP_CREATE)
		const charlieStubCreate = waitForMessage(charlie.sock, m => m.messageStubType === WAMessageStubType.GROUP_CREATE)

		const result = await alice.sock.groupCreate(subject, [bob.jid, charlie.jid])
		expect(result.gid).toBeTruthy()
		expect(result.gid.endsWith('@g.us')).toBe(true)
		groupJid = result.gid

		const [aliceUpdate, bobUpdate, charlieUpdate] = await Promise.all([
			aliceGroupsUpdate,
			bobGroupsUpdate,
			charlieGroupsUpdate
		])
		// Each client gets exactly one groups.update with the new group's id.
		expect(aliceUpdate[0]?.id).toBe(groupJid)
		expect(bobUpdate[0]?.id).toBe(groupJid)
		expect(charlieUpdate[0]?.id).toBe(groupJid)

		const [aliceStub, bobStub, charlieStub] = await Promise.all([aliceStubCreate, bobStubCreate, charlieStubCreate])
		// Synthesized stub body — what upstream-Baileys consumers (sung's
		// `_handleGroupCreate`, etc.) hook on to refresh the group's
		// participants column from the API.
		for (const stub of [aliceStub, bobStub, charlieStub]) {
			expect(stub.key?.remoteJid).toBe(groupJid)
			expect(stub.messageStubType).toBe(WAMessageStubType.GROUP_CREATE)
			expect(stub.message ?? null).toBe(null) // body-less by design
		}
	})

	test('Alice fetches groupMetadata → bot is admin (creator), bob+charlie are members', async () => {
		const meta = await alice.sock.groupMetadata(groupJid)
		expect(meta.id).toBe(groupJid)
		expect(meta.participants.length).toBeGreaterThanOrEqual(3)

		// Find alice as creator/admin
		const aliceLidUser = alice.lid?.split('@')[0]?.split(':')[0]
		const aliceParticipant = meta.participants.find(p => p.id.startsWith(aliceLidUser ?? '__nope__'))
		expect(aliceParticipant).toBeDefined()
		expect(aliceParticipant?.admin === 'admin' || aliceParticipant?.admin === 'superadmin').toBe(true)
	})

	test('Alice → group → bob+charlie both receive the text', async () => {
		const text = `Hello group from alice ${Date.now()}`
		const bobGetsText = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		const charlieGetsText = waitForMessage(charlie.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		const sent = await alice.sock.sendMessage(groupJid, { text })
		expect(sent).toBeDefined()
		expect(sent!.key.remoteJid).toBe(groupJid)

		const [bobMsg, charlieMsg] = await Promise.all([bobGetsText, charlieGetsText])
		expect(getTextContent(bobMsg)).toBe(text)
		expect(getTextContent(charlieMsg)).toBe(text)
		expect(bobMsg.key?.id).toBe(sent!.key.id)
		expect(charlieMsg.key?.id).toBe(sent!.key.id)
	})

	test('Bob → group → alice+charlie both receive the text', async () => {
		const text = `Reply from bob ${Date.now()}`
		const aliceGets = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		const charlieGets = waitForMessage(charlie.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		const sent = await bob.sock.sendMessage(groupJid, { text })
		expect(sent!.key.remoteJid).toBe(groupJid)

		const [aMsg, cMsg] = await Promise.all([aliceGets, charlieGets])
		expect(getTextContent(aMsg)).toBe(text)
		expect(getTextContent(cMsg)).toBe(text)
	})

	test('Alice promotes bob → all three see promote (event + stub with admin=admin)', async () => {
		const aliceSeesPromote = waitForEvent(alice.sock, 'group-participants.update', u => u.action === 'promote')
		const bobSeesPromote = waitForEvent(bob.sock, 'group-participants.update', u => u.action === 'promote')
		const charlieSeesPromote = waitForEvent(charlie.sock, 'group-participants.update', u => u.action === 'promote')
		const bobStubPromote = waitForMessage(
			bob.sock,
			m => m.messageStubType === WAMessageStubType.GROUP_PARTICIPANT_PROMOTE
		)
		const charlieStubPromote = waitForMessage(
			charlie.sock,
			m => m.messageStubType === WAMessageStubType.GROUP_PARTICIPANT_PROMOTE
		)

		// Bridge's `groupParticipantsUpdate` returns `[]` for promote/demote
		// (the IQ response carries per-participant status, but the core's
		// `promote_participants` discards it — see whatsapp-rust-bridge
		// `wasm_client.rs:1066-1082`). Verify the side effect via the
		// notification fan-out instead of the immediate return value.
		await alice.sock.groupParticipantsUpdate(groupJid, [bob.jid], 'promote')

		const [aliceEvt, bobEvt, charlieEvt] = await Promise.all([aliceSeesPromote, bobSeesPromote, charlieSeesPromote])
		// Domain event carries the new role inferred from the action.
		for (const evt of [aliceEvt, bobEvt, charlieEvt]) {
			expect(evt.action).toBe('promote')
			expect(evt.participants.length).toBe(1)
			expect(evt.participants[0]!.admin).toBe('admin')
			// Bob's LID should be the promoted participant.
			expect(evt.participants[0]!.id).toBe(lidJid(bob))
		}

		// Stub message — what sung's anti-system handler reads from.
		const [bobStub, charlieStub] = await Promise.all([bobStubPromote, charlieStubPromote])
		// `messageStubParameters[0]` must equal the promoted participant JID,
		// because that's the field sung's `handleAntiTheftPromote` passes to
		// `atualizarParticipantes('promote', ...)`.
		expect(bobStub.messageStubParameters?.[0]).toBe(lidJid(bob))
		expect(charlieStub.messageStubParameters?.[0]).toBe(lidJid(bob))
	})

	test('Bob (now admin) sends to group → alice+charlie receive', async () => {
		const text = `Bob the admin speaks ${Date.now()}`
		const aliceGets = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		const charlieGets = waitForMessage(charlie.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await bob.sock.sendMessage(groupJid, { text })
		await Promise.all([aliceGets, charlieGets])
	})

	test('Alice demotes bob → all three see demote (event admin=null + stub GROUP_PARTICIPANT_DEMOTE)', async () => {
		const aliceSeesDemote = waitForEvent(alice.sock, 'group-participants.update', u => u.action === 'demote')
		const bobSeesDemote = waitForEvent(bob.sock, 'group-participants.update', u => u.action === 'demote')
		const charlieSeesDemote = waitForEvent(charlie.sock, 'group-participants.update', u => u.action === 'demote')
		const bobStubDemote = waitForMessage(
			bob.sock,
			m => m.messageStubType === WAMessageStubType.GROUP_PARTICIPANT_DEMOTE
		)

		await alice.sock.groupParticipantsUpdate(groupJid, [bob.jid], 'demote')

		const [aliceEvt, bobEvt, charlieEvt] = await Promise.all([aliceSeesDemote, bobSeesDemote, charlieSeesDemote])
		for (const evt of [aliceEvt, bobEvt, charlieEvt]) {
			expect(evt.action).toBe('demote')
			expect(evt.participants[0]!.admin).toBe(null)
			expect(evt.participants[0]!.id).toBe(lidJid(bob))
		}

		const bobStub = await bobStubDemote
		expect(bobStub.messageStubType).toBe(WAMessageStubType.GROUP_PARTICIPANT_DEMOTE)
		expect(bobStub.messageStubParameters?.[0]).toBe(lidJid(bob))
	})

	test('Alice removes charlie → alice+bob see remove + stub; charlie sees its own removal', async () => {
		const aliceSeesRemove = waitForEvent(alice.sock, 'group-participants.update', u => u.action === 'remove')
		const bobSeesRemove = waitForEvent(bob.sock, 'group-participants.update', u => u.action === 'remove')
		// The kicked user also receives the remove notification (mock server
		// dispatches w:gp2 remove to ALL members, including the kicked one,
		// before they are dropped from the routing table).
		const charlieSeesRemove = waitForEvent(charlie.sock, 'group-participants.update', u => u.action === 'remove')
		const bobStubRemove = waitForMessage(
			bob.sock,
			m => m.messageStubType === WAMessageStubType.GROUP_PARTICIPANT_REMOVE
		)

		await alice.sock.groupParticipantsUpdate(groupJid, [charlie.jid], 'remove')

		const [aliceEvt, bobEvt, charlieEvt] = await Promise.all([aliceSeesRemove, bobSeesRemove, charlieSeesRemove])
		for (const evt of [aliceEvt, bobEvt, charlieEvt]) {
			expect(evt.action).toBe('remove')
			expect(evt.participants[0]!.id).toBe(lidJid(charlie))
		}

		const bobStub = await bobStubRemove
		expect(bobStub.messageStubType).toBe(WAMessageStubType.GROUP_PARTICIPANT_REMOVE)
		expect(bobStub.messageStubParameters?.[0]).toBe(lidJid(charlie))
	})

	test('After kick: alice+bob can still message each other in the group', async () => {
		const text = `Post-kick chatter ${Date.now()}`
		const bobGets = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await alice.sock.sendMessage(groupJid, { text })
		const got = await bobGets
		expect(getTextContent(got)).toBe(text)
	})
})
