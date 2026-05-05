import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WhatsAppEvent } from 'whatsapp-rust-bridge'
import { makeEventHandler } from '../Socket/events.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BaileysEventMap, WAMessage } from '../Types/index.ts'
import { WAProto } from '../Types/index.ts'
import { expect, expectStubParticipant } from './expect.ts'

/**
 * Regression: upstream Baileys delivers participant-management notifications
 * (`<notification type="w:gp2">` with `<add>`/`<remove>`/`<promote>`/`<demote>`)
 * via TWO event paths simultaneously:
 *
 *   1. `group-participants.update` — high-level structured event
 *   2. `messages.upsert` — synthesized stub WAMessage(s) carrying
 *      `messageStubType` (one of WAMessageStubType.GROUP_PARTICIPANT_*) and
 *      `messageStubParameters` = the affected participant JIDs
 *
 * Many bots in the upstream-Baileys ecosystem (sung, etc.) update their
 * SQLite admin caches exclusively from path #2 and filter the bot itself out
 * of path #1's handler. Without the stub-message emission, a self-promotion
 * never reaches the consumer's `addAdminToCache` and follow-up admin checks
 * keep returning false. Earlier versions of baileyrs only emitted path #1,
 * surfacing as "Bot não é Admin" in sung after promotion.
 */

const STUB = WAProto.WebMessageInfo.StubType

interface Captured {
	upsert: BaileysEventMap['messages.upsert'][]
	participantsUpdate: BaileysEventMap['group-participants.update'][]
}

const makeCtx = (user?: { id?: string; lid?: string }) => {
	const captured: Captured = { upsert: [], participantsUpdate: [] }
	const ev = new EventEmitter()
	ev.on('messages.upsert', (data: BaileysEventMap['messages.upsert']) => captured.upsert.push(data))
	ev.on('group-participants.update', (data: BaileysEventMap['group-participants.update']) =>
		captured.participantsUpdate.push(data)
	)
	const ctx = {
		ev,
		logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child: () => ctx.logger },
		fullConfig: {} as SocketContext['fullConfig'],
		ws: new EventEmitter(),
		getUser: () => user,
		setUser: () => {},
		getClient: async () => {
			throw new Error('not used')
		},
		getClientSync: () => {
			throw new Error('not used')
		}
	} as unknown as SocketContext
	return { ctx, captured }
}

const groupJid = { user: '120363012345678901', server: 'g.us' }
const adminLid = { user: '550000000000001', server: 'lid' }
const targetLid = { user: '271060335329480', server: 'lid' }

const makeEvent = (type: 'add' | 'remove' | 'promote' | 'demote' | 'modify'): WhatsAppEvent =>
	({
		type: 'group_update',
		data: {
			group_jid: groupJid,
			participant: adminLid,
			participant_pn: null,
			timestamp: 1_734_000_000,
			is_lid_addressing_mode: true,
			action: { type, participants: [{ jid: targetLid, phone_number: null }] }
		}
	}) as unknown as WhatsAppEvent

describe('events — participant stub message synthesis', () => {
	it('emits both group-participants.update and a stub messages.upsert for promote', () => {
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)

		handle(makeEvent('promote'))

		expect(captured.participantsUpdate).toHaveLength(1)
		expect(captured.participantsUpdate[0]!.action).toBe('promote')

		expect(captured.upsert).toHaveLength(1)
		const upsert0 = captured.upsert[0]!
		const stubMsg = upsert0.messages[0]!
		expect(stubMsg.messageStubType).toBe(STUB.GROUP_PARTICIPANT_PROMOTE)
		expect(stubMsg.messageStubParameters).toHaveLength(1)
		expectStubParticipant(stubMsg.messageStubParameters?.[0], { id: '271060335329480@lid' })
		expect(stubMsg.key!.remoteJid).toBe('120363012345678901@g.us')
		expect(stubMsg.key!.participant).toBe('550000000000001@lid')
		expect(stubMsg.key!.fromMe).toBe(false)
		expect(upsert0.type).toBe('notify')
		// stub messages must not carry a real body — sung treats anything with
		// a `message` field as a real chat message
		expect(stubMsg.message ?? null).toBe(null)
	})

	it('maps each participant action onto the matching WAMessageStubType', () => {
		const cases: [Parameters<typeof makeEvent>[0], number][] = [
			['add', STUB.GROUP_PARTICIPANT_ADD],
			['remove', STUB.GROUP_PARTICIPANT_REMOVE],
			['promote', STUB.GROUP_PARTICIPANT_PROMOTE],
			['demote', STUB.GROUP_PARTICIPANT_DEMOTE],
			['modify', STUB.GROUP_PARTICIPANT_CHANGE_NUMBER]
		]
		for (const [action, expected] of cases) {
			const { ctx, captured } = makeCtx()
			const handle = makeEventHandler(ctx)
			handle(makeEvent(action))
			expect(captured.upsert[0]!.messages[0]!.messageStubType).toBe(expected)
		}
	})

	it('marks fromMe=true when the bot itself is the actor', () => {
		const { ctx, captured } = makeCtx({ id: '5511999990000@s.whatsapp.net', lid: '550000000000001@lid' })
		const handle = makeEventHandler(ctx)
		handle(makeEvent('promote'))
		expect(captured.upsert[0]!.messages[0]!.key!.fromMe).toBe(true)
	})

	it('emits one stub message per affected participant in a single batch', () => {
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)
		handle({
			type: 'group_update',
			data: {
				group_jid: groupJid,
				participant: adminLid,
				participant_pn: null,
				timestamp: 1_734_000_000,
				is_lid_addressing_mode: true,
				action: {
					type: 'add',
					participants: [
						{ jid: { user: '111', server: 'lid' }, phone_number: null },
						{ jid: { user: '222', server: 'lid' }, phone_number: null }
					]
				}
			}
		} as unknown as WhatsAppEvent)

		expect(captured.upsert).toHaveLength(1)
		const msgs = captured.upsert[0]!.messages
		expect(msgs).toHaveLength(2)
		expectStubParticipant(msgs[0]!.messageStubParameters?.[0], { id: '111@lid' })
		expectStubParticipant(msgs[1]!.messageStubParameters?.[0], { id: '222@lid' })
		// IDs must be unique within the batch — sung's iniciar.js dedups
		// `messages.upsert` by `key.id`, so duplicate ids would silently drop
		// every participant after the first.
		const ids = msgs.map(m => m.key!.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('uses the event timestamp for messageTimestamp (sung filters >60s as old)', () => {
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)
		handle(makeEvent('promote'))
		const stubMsg = captured.upsert[0]!.messages[0]! as WAMessage & { messageTimestamp?: number }
		expect(Number(stubMsg.messageTimestamp)).toBe(1_734_000_000)
	})

	it('emits a GROUP_CHANGE_SUBJECT stub for the subject action with the new subject as param', () => {
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)
		handle({
			type: 'group_update',
			data: {
				group_jid: groupJid,
				participant: adminLid,
				participant_pn: null,
				timestamp: 1_734_000_000,
				is_lid_addressing_mode: true,
				action: { type: 'subject', subject: 'new name', subject_owner: null, subject_time: null }
			}
		} as unknown as WhatsAppEvent)
		expect(captured.upsert).toHaveLength(1)
		const m = captured.upsert[0]!.messages[0]!
		expect(m.messageStubType).toBe(STUB.GROUP_CHANGE_SUBJECT)
		expect(m.messageStubParameters).toEqual(['new name'])
	})

	it('emits a GROUP_CHANGE_RESTRICT stub with on/off for locked/unlocked', () => {
		for (const [type, expected] of [
			['locked', 'on'],
			['unlocked', 'off']
		] as const) {
			const { ctx, captured } = makeCtx()
			const handle = makeEventHandler(ctx)
			handle({
				type: 'group_update',
				data: {
					group_jid: groupJid,
					participant: adminLid,
					participant_pn: null,
					timestamp: 1_734_000_000,
					is_lid_addressing_mode: true,
					action: { type }
				}
			} as unknown as WhatsAppEvent)
			const m = captured.upsert[0]!.messages[0]!
			expect(m.messageStubType).toBe(STUB.GROUP_CHANGE_RESTRICT)
			expect(m.messageStubParameters).toEqual([expected])
		}
	})

	it('emits a GROUP_CHANGE_ANNOUNCE stub with on/off for announce/not_announce', () => {
		for (const [type, expected] of [
			['announce', 'on'],
			['not_announce', 'off']
		] as const) {
			const { ctx, captured } = makeCtx()
			const handle = makeEventHandler(ctx)
			handle({
				type: 'group_update',
				data: {
					group_jid: groupJid,
					participant: adminLid,
					participant_pn: null,
					timestamp: 1_734_000_000,
					is_lid_addressing_mode: true,
					action: { type }
				}
			} as unknown as WhatsAppEvent)
			const m = captured.upsert[0]!.messages[0]!
			expect(m.messageStubType).toBe(STUB.GROUP_CHANGE_ANNOUNCE)
			expect(m.messageStubParameters).toEqual([expected])
		}
	})

	it('emits a GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE stub with on/off for membership_approval_mode', () => {
		for (const [enabled, expected] of [
			[true, 'on'],
			[false, 'off']
		] as const) {
			const { ctx, captured } = makeCtx()
			const handle = makeEventHandler(ctx)
			handle({
				type: 'group_update',
				data: {
					group_jid: groupJid,
					participant: adminLid,
					participant_pn: null,
					timestamp: 1_734_000_000,
					is_lid_addressing_mode: true,
					action: { type: 'membership_approval_mode', enabled }
				}
			} as unknown as WhatsAppEvent)
			const m = captured.upsert[0]!.messages[0]!
			expect(m.messageStubType).toBe(STUB.GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE)
			expect(m.messageStubParameters).toEqual([expected])
		}
	})

	it('emits a GROUP_MEMBER_ADD_MODE stub passing through the raw mode for member_add_mode', () => {
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)
		handle({
			type: 'group_update',
			data: {
				group_jid: groupJid,
				participant: adminLid,
				participant_pn: null,
				timestamp: 1_734_000_000,
				is_lid_addressing_mode: true,
				action: { type: 'member_add_mode', mode: 'admin_add' }
			}
		} as unknown as WhatsAppEvent)
		const m = captured.upsert[0]!.messages[0]!
		expect(m.messageStubType).toBe(STUB.GROUP_MEMBER_ADD_MODE)
		expect(m.messageStubParameters).toEqual(['admin_add'])
	})

	it('still emits the high-level groups.update for metadata changes alongside the stub', () => {
		const { ctx, captured } = makeCtx()
		// Capture the parallel groups.update emission as well.
		const groupUpdates: BaileysEventMap['groups.update'][] = []
		ctx.ev.on('groups.update', u => groupUpdates.push(u))
		const handle = makeEventHandler(ctx)
		handle({
			type: 'group_update',
			data: {
				group_jid: groupJid,
				participant: adminLid,
				participant_pn: null,
				timestamp: 1_734_000_000,
				is_lid_addressing_mode: true,
				action: { type: 'subject', subject: 'hi', subject_owner: null, subject_time: null }
			}
		} as unknown as WhatsAppEvent)
		expect(groupUpdates).toHaveLength(1)
		expect(groupUpdates[0]![0]!.subject).toBe('hi')
		expect(captured.upsert).toHaveLength(1)
	})

	it('normalizes PascalCase action.type from the bridge runtime to snake_case', () => {
		// Regression: serde-wasm-bindgen serializes the rust enum
		// `GroupNotificationAction::Demote { ... }` as `{type: "Demote", ...}`
		// even though the bridge's TS .d.ts declares it lowercase. Without
		// normalization, our action.type switches all miss and no stub fires.
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)
		handle({
			type: 'group_update',
			data: {
				group_jid: groupJid,
				participant: adminLid,
				participant_pn: null,
				timestamp: 1_734_000_000,
				is_lid_addressing_mode: true,
				// PascalCase `Demote` — what the bridge actually emits today.
				action: { type: 'Demote', participants: [{ jid: targetLid, phone_number: null }] }
			}
		} as unknown as WhatsAppEvent)
		expect(captured.upsert).toHaveLength(1)
		expect(captured.upsert[0]!.messages[0]!.messageStubType).toBe(STUB.GROUP_PARTICIPANT_DEMOTE)
		expect(captured.participantsUpdate).toHaveLength(1)
		expect(captured.participantsUpdate[0]!.action).toBe('demote')
	})

	it('does not emit a stub for actions without an upstream stub equivalent (e.g. ephemeral)', () => {
		const { ctx, captured } = makeCtx()
		const handle = makeEventHandler(ctx)
		handle({
			type: 'group_update',
			data: {
				group_jid: groupJid,
				participant: adminLid,
				participant_pn: null,
				timestamp: 1_734_000_000,
				is_lid_addressing_mode: true,
				action: { type: 'ephemeral', expiration: 86400, trigger: null }
			}
		} as unknown as WhatsAppEvent)
		expect(captured.upsert).toHaveLength(0)
	})
})
