import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import type { proto as protoTypes } from 'whatsapp-rust-bridge/proto-types'
import { proto } from 'whatsapp-rust-bridge/proto-types'

import { adaptBridgeEvent } from '../Bridge/adapt.ts'
import type { CanonicalEvent } from '../Bridge/types.ts'
import { buildGroupNotificationDomainEvent, buildGroupNotificationStubMessages } from '../Socket/group-notifications.ts'
import { makeEventHandler } from '../Socket/events.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BaileysEventMap } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { useBridgeStore } from '../Utils/use-bridge-store.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { assertNodeErrorFree } from '../WABinary/generic-utils.ts'
import { expect } from './expect.ts'

const HSType = proto.HistorySync.HistorySyncType
const ProtocolMessageType = proto.Message.ProtocolMessage.Type
const StubType = proto.WebMessageInfo.StubType

const jid = (user: string, server = 's.whatsapp.net') => ({ user, server, agent: 0, device: 0, integrator: 0 })

const noopLogger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return noopLogger
	}
}

const makeCtx = () => {
	const ev = new EventEmitter()
	const ws = new EventEmitter()
	const ctx: SocketContext = {
		ev: ev as unknown as SocketContext['ev'],
		logger: noopLogger as never,
		fullConfig: {} as never,
		ws,
		getUser: () => undefined,
		setUser: () => {},
		getClient: () => Promise.reject(new Error('not used')),
		getClientSync: () => {
			throw new Error('not used')
		}
	}
	return { ctx, ev, ws }
}

/** Run a bridge event through the dispatcher and return the events emitted under `name`. */
const collect = <K extends keyof BaileysEventMap>(
	bridgeEvent: { type: string; data?: unknown },
	name: K
): BaileysEventMap[K][] => {
	const { ctx, ev } = makeCtx()
	const captured: BaileysEventMap[K][] = []
	ev.on(name, payload => captured.push(payload as BaileysEventMap[K]))
	makeEventHandler(ctx)(bridgeEvent as never)
	return captured
}

/** Run a bridge event and capture multiple channels in one pass. */
const collectMany = <Names extends readonly (keyof BaileysEventMap)[]>(
	bridgeEvent: { type: string; data?: unknown },
	...names: Names
): { [K in Names[number]]: BaileysEventMap[K][] } => {
	const { ctx, ev } = makeCtx()
	const buckets = Object.fromEntries(names.map(n => [n, [] as unknown[]])) as {
		[K in Names[number]]: BaileysEventMap[K][]
	}
	for (const name of names) ev.on(name, payload => (buckets[name as Names[number]] as unknown[]).push(payload))
	makeEventHandler(ctx)(bridgeEvent as never)
	return buckets
}

/** Adapt and assert the event narrows to the given type. */
const adapt = <T extends CanonicalEvent['type']>(
	bridgeEvent: { type: string; data?: unknown },
	type: T
): Extract<CanonicalEvent, { type: T }> => {
	const result = adaptBridgeEvent(bridgeEvent as never)
	if (!result || result.type !== type) throw new Error(`expected canonical type "${type}", got "${result?.type}"`)
	return result as Extract<CanonicalEvent, { type: T }>
}

const baseMessageInfo = {
	source: { chat: jid('5511'), is_group: false, is_from_me: false } as Record<string, unknown>,
	id: 'MSG-1',
	timestamp: 1730000000,
	push_name: 'Foo',
	is_view_once: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge adapter — sync actions
// ─────────────────────────────────────────────────────────────────────────────

describe('adapter: pin_update', () => {
	const evt = (action: Record<string, unknown> | undefined) => ({
		type: 'pin_update',
		data: { jid: jid('5511'), timestamp: 1730000000, action, from_full_sync: false }
	})

	it('propagates pinned=true', () => {
		expect(adapt(evt({ pinned: true }), 'pinUpdate').pinned).toBe(true)
	})

	it('propagates pinned=false on unpin', () => {
		expect(adapt(evt({ pinned: false }), 'pinUpdate').pinned).toBe(false)
	})

	it('defaults to pinned=true when action is absent (legacy bridge)', () => {
		expect(adapt(evt(undefined), 'pinUpdate').pinned).toBe(true)
	})
})

describe('adapter: mute_update', () => {
	const evt = (action: Record<string, unknown> | undefined, ts = 1730000000) => ({
		type: 'mute_update',
		data: { jid: jid('5511'), timestamp: ts, action, from_full_sync: false }
	})

	it('preserves muteEndTimestamp distinct from notification timestamp', () => {
		const muteEnd = 1730028800
		const c = adapt(evt({ muted: true, muteEndTimestamp: muteEnd }), 'muteUpdate')
		expect(c.muted).toBe(true)
		expect(c.muteEndTimestamp).toBe(muteEnd)
		expect(c.timestamp).toBe(1730000000)
	})

	it('distinguishes unmute (muted=false) from mute', () => {
		const c = adapt(evt({ muted: false }), 'muteUpdate')
		expect(c.muted).toBe(false)
		expect(c.muteEndTimestamp).toBeUndefined()
	})

	it('defaults to muted=true when action is absent', () => {
		expect(adapt(evt(undefined), 'muteUpdate').muted).toBe(true)
	})
})

describe('adapter: archive_update', () => {
	const evt = (archived: boolean) => ({
		type: 'archive_update',
		data: { jid: jid('5511'), timestamp: 1730000000, action: { archived }, from_full_sync: false }
	})

	it('propagates archived=true', () => {
		expect(adapt(evt(true), 'archiveUpdate').archived).toBe(true)
	})

	it('propagates archived=false on unarchive', () => {
		expect(adapt(evt(false), 'archiveUpdate').archived).toBe(false)
	})
})

describe('adapter: mark_chat_as_read_update', () => {
	const evt = (read: boolean) => ({
		type: 'mark_chat_as_read_update',
		data: { jid: jid('5511'), timestamp: 1730000000, action: { read }, from_full_sync: false }
	})

	it('propagates read=true', () => {
		expect(adapt(evt(true), 'markChatAsReadUpdate').read).toBe(true)
	})

	it('propagates read=false on mark-as-unread', () => {
		expect(adapt(evt(false), 'markChatAsReadUpdate').read).toBe(false)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Bridge adapter — picture / receipt / message info
// ─────────────────────────────────────────────────────────────────────────────

describe('adapter: picture_update', () => {
	it('preserves removed=true and author', () => {
		const c = adapt(
			{ type: 'picture_update', data: { jid: jid('5511'), removed: true, picture_id: null, author: jid('5599') } },
			'pictureUpdate'
		)
		expect(c.removed).toBe(true)
		expect(c.author).toBe('5599@s.whatsapp.net')
	})

	it('preserves pictureId when avatar was set', () => {
		const c = adapt(
			{ type: 'picture_update', data: { jid: jid('5511'), removed: false, picture_id: 'abc123' } },
			'pictureUpdate'
		)
		expect(c.removed).toBe(false)
		expect(c.pictureId).toBe('abc123')
	})
})

describe('adapter: receipt', () => {
	const evt = (type: unknown, ids: string[] = ['M1']) => ({
		type: 'receipt',
		data: {
			source: { chat: jid('5511'), is_group: false, is_from_me: false },
			message_ids: ids,
			type,
			timestamp: 1730000000
		}
	})

	it('preserves the full messageIds array', () => {
		expect(adapt(evt('read', ['MSG1', 'MSG2', 'MSG3']), 'receipt').messageIds).toEqual(['MSG1', 'MSG2', 'MSG3'])
	})

	it('parses receiptType from bare-string serde form', () => {
		expect(adapt(evt('read'), 'receipt').receiptType).toBe('read')
	})

	it('parses receiptType from tagged serde form', () => {
		expect(adapt(evt({ type: 'read' }), 'receipt').receiptType).toBe('read')
	})

	it('disambiguates read vs played', () => {
		expect(adapt(evt('read'), 'receipt').receiptType).toBe('read')
		expect(adapt(evt('played'), 'receipt').receiptType).toBe('played')
	})

	it('maps peer_msg / history_sync / server_error to distinct sub-variants', () => {
		expect(adapt(evt('peer_msg'), 'receipt').receiptType).toBe('peer-msg')
		expect(adapt(evt('history_sync'), 'receipt').receiptType).toBe('history-sync')
		expect(adapt(evt('server_error'), 'receipt').receiptType).toBe('server-error')
	})

	it('separates enc_rekey_retry from plain retry', () => {
		expect(adapt(evt('retry'), 'receipt').receiptType).toBe('retry')
		expect(adapt(evt('enc_rekey_retry'), 'receipt').receiptType).toBe('enc-rekey-retry')
	})
})

describe('adapter: message info', () => {
	const evt = (info: Record<string, unknown>) => ({
		type: 'message',
		data: { info: { ...baseMessageInfo, ...info }, message: { conversation: 'oi' } }
	})

	it('propagates is_offline as canonical isOffline', () => {
		expect(adapt(evt({ is_offline: true }), 'message').isOffline).toBe(true)
	})

	it('propagates unavailable_request_id', () => {
		expect(adapt(evt({ unavailable_request_id: 'PDO-X' }), 'message').unavailableRequestId).toBe('PDO-X')
	})

	it('narrows editAttribute to the wire literal set', () => {
		for (const value of ['1', '2', '3', '7', '8'] as const) {
			expect(adapt(evt({ edit: value }), 'message').editAttribute).toBe(value)
		}
	})

	it('drops empty-string editAttribute', () => {
		expect(adapt(evt({ edit: '' }), 'message').editAttribute).toBeUndefined()
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Bridge adapter — connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('adapter: pair_error', () => {
	it('preserves id / lid / businessName / platform alongside error', () => {
		const c = adapt(
			{
				type: 'pair_error',
				data: { id: jid('5511'), lid: jid('236', 'lid'), business_name: 'Biz', platform: 'web', error: 'Conflict' }
			},
			'pairError'
		)
		expect(c).toEqual({
			type: 'pairError',
			error: 'Conflict',
			id: '5511@s.whatsapp.net',
			lid: '236@lid',
			businessName: 'Biz',
			platform: 'web'
		})
	})
})

describe('adapter: connect_failure', () => {
	it('captures the numeric reason code', () => {
		expect(
			adapt({ type: 'connect_failure', data: { reason: 405, message: 'outdated' } }, 'connectFailure').reason
		).toBe(405)
	})
})

describe('adapter: temporary_ban', () => {
	it('captures code and expire', () => {
		const c = adapt({ type: 'temporary_ban', data: { code: 102, expire: 1730086400 } }, 'temporaryBan')
		expect(c.code).toBe(102)
		expect(c.expire).toBe(1730086400)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Bridge adapter — group actions
// ─────────────────────────────────────────────────────────────────────────────

const groupEvt = (action: Record<string, unknown>) => ({
	type: 'group_update',
	data: { group_jid: { user: '120', server: 'g.us' }, timestamp: 0, is_lid_addressing_mode: false, action }
})

describe('adapter: group_update actions', () => {
	it('narrows growth_locked with expiration and lockType', () => {
		const c = adapt(
			groupEvt({ type: 'growth_locked', expiration: 999, lock_type: 'inviter_blocklisted' }),
			'groupUpdate'
		)
		if (c.action.type !== 'growthLocked') throw new Error('narrowing')
		expect(c.action.expiration).toBe(999)
		expect(c.action.lockType).toBe('inviter_blocklisted')
	})

	it('narrows growth_unlocked', () => {
		const c = adapt(groupEvt({ type: 'growth_unlocked' }), 'groupUpdate')
		expect(c.action.type).toBe('growthUnlocked')
	})

	it('narrows membership_approval_request', () => {
		const c = adapt(groupEvt({ type: 'membership_approval_request', request_method: 'invite_link' }), 'groupUpdate')
		if (c.action.type !== 'membershipApprovalRequest') throw new Error('narrowing')
		expect(c.action.requestMethod).toBe('invite_link')
	})

	it('narrows created_membership_requests with the requests array', () => {
		const c = adapt(
			groupEvt({
				type: 'created_membership_requests',
				request_method: 'linked_group_join',
				requests: [{ jid: jid('111', 'lid') }]
			}),
			'groupUpdate'
		)
		if (c.action.type !== 'createdMembershipRequests') throw new Error('narrowing')
		expect(c.action.requests).toEqual([{ jid: '111@lid', phoneNumber: undefined }])
	})

	it('narrows revoked_membership_requests', () => {
		const c = adapt(
			groupEvt({ type: 'revoked_membership_requests', participants: [jid('111', 'lid'), jid('222', 'lid')] }),
			'groupUpdate'
		)
		if (c.action.type !== 'revokedMembershipRequests') throw new Error('narrowing')
		expect(c.action.participants.map(p => p.jid)).toEqual(['111@lid', '222@lid'])
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Bridge adapter — history_sync
// ─────────────────────────────────────────────────────────────────────────────

describe('adapter: history_sync', () => {
	it('returns empty buckets for an empty payload', () => {
		expect(adapt({ type: 'history_sync', data: {} }, 'historySync')).toEqual({
			type: 'historySync',
			chats: [],
			contacts: [],
			messages: [],
			lidPnMappings: [],
			syncType: undefined,
			progress: undefined,
			chunkOrder: undefined,
			peerDataRequestSessionId: undefined
		})
	})

	it('propagates peerDataRequestSessionId from the bridge overlay', () => {
		const c = adapt(
			{ type: 'history_sync', data: { syncType: HSType.ON_DEMAND, peerDataRequestSessionId: 'PDO-XYZ' } },
			'historySync'
		)
		expect(c.peerDataRequestSessionId).toBe('PDO-XYZ')
		expect(c.syncType).toBe(HSType.ON_DEMAND)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — chats.update emissions
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: pin_update → chats.update', () => {
	const run = (pinned: boolean) =>
		collect(
			{ type: 'pin_update', data: { jid: jid('5511'), timestamp: 1730000000, action: { pinned } } },
			'chats.update'
		)

	it('pin emits pinned: timestamp', () => {
		expect(run(true)[0]).toEqual([{ id: '5511@s.whatsapp.net', pinned: 1730000000 }])
	})

	it('unpin emits pinned: null (parity with upstream)', () => {
		expect(run(false)[0]).toEqual([{ id: '5511@s.whatsapp.net', pinned: null }])
	})
})

describe('dispatch: mute_update → chats.update', () => {
	it('mute emits muteEndTime from MuteAction.muteEndTimestamp', () => {
		const updates = collect(
			{
				type: 'mute_update',
				data: { jid: jid('5511'), timestamp: 1730000000, action: { muted: true, muteEndTimestamp: 1730028800 } }
			},
			'chats.update'
		)
		expect(updates[0]?.[0]?.muteEndTime).toBe(1730028800)
	})

	it('unmute emits muteEndTime: null', () => {
		const updates = collect(
			{ type: 'mute_update', data: { jid: jid('5511'), timestamp: 1730000000, action: { muted: false } } },
			'chats.update'
		)
		expect(updates[0]?.[0]?.muteEndTime).toBe(null)
	})
})

describe('dispatch: archive_update → chats.update', () => {
	it('emits archived flag verbatim', () => {
		const archived = collect(
			{ type: 'archive_update', data: { jid: jid('5511'), action: { archived: true } } },
			'chats.update'
		)
		const unarchived = collect(
			{ type: 'archive_update', data: { jid: jid('5511'), action: { archived: false } } },
			'chats.update'
		)
		expect(archived[0]?.[0]?.archived).toBe(true)
		expect(unarchived[0]?.[0]?.archived).toBe(false)
	})
})

describe('dispatch: mark_chat_as_read_update → chats.update', () => {
	it('read=true emits unreadCount: 0', () => {
		const updates = collect(
			{ type: 'mark_chat_as_read_update', data: { jid: jid('5511'), action: { read: true } } },
			'chats.update'
		)
		expect(updates[0]?.[0]?.unreadCount).toBe(0)
	})

	it('read=false emits unreadCount: -1 (mark-as-unread sentinel)', () => {
		const updates = collect(
			{ type: 'mark_chat_as_read_update', data: { jid: jid('5511'), action: { read: false } } },
			'chats.update'
		)
		expect(updates[0]?.[0]?.unreadCount).toBe(-1)
	})
})

describe('dispatch: disappearing_mode_changed → chats.update', () => {
	it('emits ephemeralExpiration when enabled', () => {
		const updates = collect(
			{ type: 'disappearing_mode_changed', data: { from: jid('5511'), duration: 86400, setting_timestamp: 1 } },
			'chats.update'
		)
		expect(updates[0]?.[0]?.ephemeralExpiration).toBe(86400)
	})

	it('emits ephemeralExpiration: null when disabled', () => {
		const updates = collect(
			{ type: 'disappearing_mode_changed', data: { from: jid('5511'), duration: 0 } },
			'chats.update'
		)
		expect(updates[0]?.[0]?.ephemeralExpiration).toBe(null)
	})
})

describe('dispatch: picture_update → contacts.update', () => {
	it('emits imgUrl: null on removal', () => {
		const updates = collect({ type: 'picture_update', data: { jid: jid('5511'), removed: true } }, 'contacts.update')
		expect(updates[0]?.[0]).toEqual({ id: '5511@s.whatsapp.net', imgUrl: null })
	})

	it("emits imgUrl: 'changed' on update", () => {
		const updates = collect(
			{ type: 'picture_update', data: { jid: jid('5511'), removed: false, picture_id: 'a' } },
			'contacts.update'
		)
		expect(updates[0]?.[0]?.imgUrl).toBe('changed')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — receipts (fan-out + type slot)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: receipt fan-out', () => {
	const run = (type: string, ids: string[]) =>
		collect(
			{
				type: 'receipt',
				data: {
					source: { chat: jid('5511'), is_group: false, is_from_me: false },
					message_ids: ids,
					type,
					timestamp: 1730000000
				}
			},
			'message-receipt.update'
		)[0] ?? []

	it('emits one update per messageId', () => {
		const updates = run('read', ['A', 'B', 'C'])
		expect(updates.map(u => u.key.id)).toEqual(['A', 'B', 'C'])
	})

	it('routes type=read into receipt.readTimestamp', () => {
		expect(run('read', ['A'])[0]?.receipt.readTimestamp).toBe(1730000000)
	})

	it('routes type=played into receipt.playedTimestamp', () => {
		expect(run('played', ['A'])[0]?.receipt.playedTimestamp).toBe(1730000000)
	})

	it('falls back to receiptTimestamp for delivered', () => {
		expect(run('delivered', ['A'])[0]?.receipt.receiptTimestamp).toBe(1730000000)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — messages (reactions, REVOKE, EDIT, undecryptable)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: messages.reaction', () => {
	it('emits reaction with target key when proto carries reactionMessage', () => {
		const target = { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'TARGET' }
		const reactions = collect(
			{
				type: 'message',
				data: {
					info: { ...baseMessageInfo, id: 'REACTION-ENV' },
					message: { reactionMessage: { key: target, text: '👍' } }
				}
			},
			'messages.reaction'
		)
		expect(reactions[0]?.length).toBe(1)
		expect(reactions[0]?.[0]?.key).toEqual(target)
		expect(reactions[0]?.[0]?.reaction.text).toBe('👍')
	})

	it('does not emit when proto carries no reactionMessage', () => {
		const reactions = collect(
			{ type: 'message', data: { info: baseMessageInfo, message: { conversation: 'oi' } } },
			'messages.reaction'
		)
		expect(reactions.length).toBe(0)
	})
})

describe('dispatch: REVOKE protocolMessage → messages.update', () => {
	it('emits null message + REVOKE stub for the target id', () => {
		const updates = collect(
			{
				type: 'message',
				data: {
					info: { ...baseMessageInfo, id: 'REVOKE-ENV' },
					message: {
						protocolMessage: {
							type: ProtocolMessageType.REVOKE,
							key: { remoteJid: '5511@s.whatsapp.net', fromMe: true, id: 'TARGET' }
						}
					}
				}
			},
			'messages.update'
		)
		const update = updates[0]?.[0]
		expect(update?.key.id).toBe('TARGET')
		expect(update?.update.message).toBe(null)
		expect(update?.update.messageStubType).toBe(StubType.REVOKE)
	})
})

describe('dispatch: MESSAGE_EDIT protocolMessage → messages.update', () => {
	it('emits editedMessage with the converted timestamp', () => {
		const updates = collect(
			{
				type: 'message',
				data: {
					info: { ...baseMessageInfo, id: 'EDIT-ENV' },
					message: {
						protocolMessage: {
							type: ProtocolMessageType.MESSAGE_EDIT,
							key: { remoteJid: '5511@s.whatsapp.net', fromMe: true, id: 'TARGET' },
							editedMessage: { conversation: 'novo' },
							timestampMs: 1730000005000
						}
					}
				}
			},
			'messages.update'
		)
		const update = updates[0]?.[0] as
			| {
					key: { id: string }
					update: { messageTimestamp?: number; message?: { editedMessage?: { message?: protoTypes.IMessage } } }
			  }
			| undefined
		expect(update?.key.id).toBe('TARGET')
		expect(update?.update.messageTimestamp).toBe(1730000005)
		expect(update?.update.message?.editedMessage?.message?.conversation).toBe('novo')
	})
})

describe('dispatch: undecryptable_message', () => {
	const baseUndecryptable = {
		info: {
			source: { chat: jid('5511'), is_group: false, is_from_me: false },
			id: 'BAD-1',
			timestamp: 1730000000,
			push_name: 'Foo'
		},
		is_unavailable: true,
		unavailable_type: 'view_once'
	}

	it("emits a CIPHERTEXT stub upsert when decrypt_fail_mode is 'show'", () => {
		const upserts = collect(
			{ type: 'undecryptable_message', data: { ...baseUndecryptable, decrypt_fail_mode: 'show' } },
			'messages.upsert'
		)
		const stub = upserts[0]?.messages[0]
		expect(stub?.messageStubType).toBe(StubType.CIPHERTEXT)
		expect(stub?.messageStubParameters).toEqual(['view_once'])
		expect(stub?.key.id).toBe('BAD-1')
	})

	it("suppresses emission when decrypt_fail_mode is 'hide'", () => {
		const upserts = collect(
			{ type: 'undecryptable_message', data: { ...baseUndecryptable, decrypt_fail_mode: 'hide' } },
			'messages.upsert'
		)
		expect(upserts.length).toBe(0)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — group events
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: group_update.create', () => {
	it('does not emit groups.upsert (no metadata available)', () => {
		const upserts = collect(
			{
				type: 'group_update',
				data: {
					group_jid: jid('120363', 'g.us'),
					timestamp: 1,
					is_lid_addressing_mode: false,
					action: { type: 'create' }
				}
			},
			'groups.upsert'
		)
		expect(upserts.length).toBe(0)
	})
})

describe('dispatch: group-participants.update preserves phoneNumber', () => {
	it('LID-addressed participants carry their PN counterpart', () => {
		const domainEvent = buildGroupNotificationDomainEvent({
			type: 'groupUpdate',
			groupJid: '120@g.us',
			author: '236@lid',
			authorPn: '5599@s.whatsapp.net',
			timestamp: 1,
			isLidAddressingMode: true,
			action: { type: 'add', participants: [{ jid: '655@lid', phoneNumber: '5599888@s.whatsapp.net' }] }
		})
		if (!domainEvent || domainEvent.name !== 'group-participants.update')
			throw new Error('expected participants update')
		expect(domainEvent.payload.participants[0]?.phoneNumber).toBe('5599888@s.whatsapp.net')
	})
})

describe('dispatch: group.join-request fan-out', () => {
	const collectJoinRequests = (action: Record<string, unknown>) =>
		collect(
			{
				type: 'group_update',
				data: {
					group_jid: { user: '120', server: 'g.us', agent: 0, device: 0, integrator: 0 },
					participant: jid('236', 'lid'),
					participant_pn: jid('5599'),
					timestamp: 1730000000,
					is_lid_addressing_mode: true,
					action
				}
			},
			'group.join-request'
		)

	it("membership_approval_request emits one event with action='created' and the requester as author", () => {
		const requests = collectJoinRequests({ type: 'membership_approval_request', request_method: 'invite_link' })
		expect(requests.length).toBe(1)
		expect(requests[0]).toMatchObject({
			action: 'created',
			method: 'invite_link',
			author: '236@lid',
			participant: '236@lid',
			participantPn: '5599@s.whatsapp.net'
		})
	})

	it('created_membership_requests fans out one event per request', () => {
		const requests = collectJoinRequests({
			type: 'created_membership_requests',
			request_method: 'linked_group_join',
			requests: [
				{ jid: jid('111', 'lid'), phone_number: jid('1111') },
				{ jid: jid('222', 'lid'), phone_number: jid('2222') }
			]
		})
		expect(requests.map(r => r.participant)).toEqual(['111@lid', '222@lid'])
		expect(requests.every(r => r.method === 'linked_group_join')).toBe(true)
	})

	it("revoked_membership_requests emits action='revoked' with no method", () => {
		const requests = collectJoinRequests({
			type: 'revoked_membership_requests',
			participants: [jid('111', 'lid'), jid('222', 'lid')]
		})
		expect(requests.map(r => r.action)).toEqual(['revoked', 'revoked'])
		expect(requests[0]?.method).toBeUndefined()
	})

	it('drops unknown request_method silently (server may grow new variants)', () => {
		const requests = collectJoinRequests({ type: 'membership_approval_request', request_method: 'future_method' })
		expect(requests[0]?.method).toBeUndefined()
	})
})

describe('dispatch: GROUP_MEMBER_LABEL_CHANGE → group.member-tag.update', () => {
	const baseMemberTagInfo = {
		source: { chat: jid('120363', 'g.us'), sender: jid('5599', 'lid'), is_group: true, is_from_me: false },
		id: 'TAG-EVT',
		timestamp: 1730000000,
		push_name: 'Admin'
	}

	it('emits with groupId / label / participant / timestamp', () => {
		const updates = collect(
			{
				type: 'message',
				data: {
					info: { ...baseMemberTagInfo, source: { ...baseMemberTagInfo.source, sender_alt: jid('5599') } },
					message: {
						protocolMessage: { type: ProtocolMessageType.GROUP_MEMBER_LABEL_CHANGE, memberLabel: { label: 'mod' } }
					}
				}
			},
			'group.member-tag.update'
		)
		expect(updates[0]).toMatchObject({
			groupId: '120363@g.us',
			label: 'mod',
			participant: '5599@lid',
			participantAlt: '5599@s.whatsapp.net',
			messageTimestamp: 1730000000
		})
	})

	it('drops the event when memberLabel.label is absent', () => {
		const updates = collect(
			{
				type: 'message',
				data: {
					info: baseMemberTagInfo,
					message: { protocolMessage: { type: ProtocolMessageType.GROUP_MEMBER_LABEL_CHANGE } }
				}
			},
			'group.member-tag.update'
		)
		expect(updates.length).toBe(0)
	})
})

const subjectNotif = (ts: number) =>
	({
		type: 'groupUpdate',
		groupJid: '120@g.us',
		timestamp: ts,
		isLidAddressingMode: false,
		action: { type: 'subject', subject: 'foo' }
	}) as const

describe('dispatch: stub messages have unique ids', () => {
	it('two notifications with the same timestamp generate distinct key.ids', () => {
		const a = buildGroupNotificationStubMessages(subjectNotif(1730000000), false)
		const b = buildGroupNotificationStubMessages(subjectNotif(1730000000), false)
		expect(a[0]?.key.id).not.toBe(b[0]?.key.id)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: connect_failure → DisconnectReason mapping', () => {
	const closeStatusFor = (reason: number) => {
		const updates = collect({ type: 'connect_failure', data: { reason, message: '' } }, 'connection.update')
		return (updates[0]?.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
	}

	it('maps 401 (LoggedOut) to loggedOut', () => {
		expect(closeStatusFor(401)).toBe(401)
	})

	it('maps 405 (ClientOutdated) to badSession', () => {
		expect(closeStatusFor(405)).toBe(500)
	})

	it('maps 503 (ServiceUnavailable) to unavailableService', () => {
		expect(closeStatusFor(503)).toBe(503)
	})

	it('falls back to connectionClosed for unknown codes', () => {
		expect(closeStatusFor(999)).toBe(428)
	})
})

describe('dispatch: temporary_ban', () => {
	it('exposes code and expire on the Boom error data', () => {
		const updates = collect({ type: 'temporary_ban', data: { code: 102, expire: 1730086400 } }, 'connection.update')
		const error = updates[0]?.lastDisconnect?.error as Boom & { data?: { code: number; expire: number } }
		expect(error.data?.code).toBe(102)
		expect(error.data?.expire).toBe(1730086400)
	})
})

describe('dispatch: logged_out', () => {
	it('includes the server reason in the Boom message', () => {
		const updates = collect({ type: 'logged_out', data: { on_connect: false, reason: 'Removed' } }, 'connection.update')
		expect(updates[0]?.lastDisconnect?.error?.message).toContain('Removed')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — newsletters + app-state syncs
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: newsletter_live_update → newsletter.reaction', () => {
	const collectReactions = (data: Record<string, unknown>) =>
		collect({ type: 'newsletter_live_update', data }, 'newsletter.reaction')

	it('fans out one event per (message, reaction) pair', () => {
		const reactions = collectReactions({
			newsletter_jid: jid('news', 'newsletter'),
			messages: [
				{
					server_id: 100,
					reactions: [
						{ code: '👍', count: 5 },
						{ code: '❤️', count: 3 }
					]
				},
				{ server_id: 101, reactions: [{ code: '🔥', count: 1 }] }
			]
		})
		expect(reactions).toHaveLength(3)
		expect(reactions[0]).toEqual({
			id: 'news@newsletter',
			server_id: '100',
			reaction: { code: '👍', count: 5, removed: false }
		})
		expect(reactions[2]?.server_id).toBe('101')
	})

	it('marks count=0 reactions as removed', () => {
		const reactions = collectReactions({
			newsletter_jid: jid('news', 'newsletter'),
			messages: [{ server_id: 100, reactions: [{ code: '👍', count: 0 }] }]
		})
		expect(reactions[0]?.reaction.removed).toBe(true)
	})

	it('emits nothing when no reactions present', () => {
		const reactions = collectReactions({
			newsletter_jid: jid('news', 'newsletter'),
			messages: [{ server_id: 100, reactions: [] }]
		})
		expect(reactions.length).toBe(0)
	})
})

describe('dispatch: contact_number_changed → lid-mapping.update', () => {
	it('emits one update per (lid, pn) pair', () => {
		const updates = collect(
			{
				type: 'contact_number_changed',
				data: {
					old_jid: jid('5511111'),
					new_jid: jid('5522222'),
					old_lid: jid('111', 'lid'),
					new_lid: jid('222', 'lid')
				}
			},
			'lid-mapping.update'
		)
		expect(updates).toEqual([
			{ lid: '111@lid', pn: '5511111@s.whatsapp.net' },
			{ lid: '222@lid', pn: '5522222@s.whatsapp.net' }
		])
	})

	it('emits only the populated side when one pair is missing', () => {
		const updates = collect(
			{
				type: 'contact_number_changed',
				data: { old_jid: jid('5511111'), new_jid: jid('5522222'), old_lid: null, new_lid: jid('222', 'lid') }
			},
			'lid-mapping.update'
		)
		expect(updates.length).toBe(1)
	})
})

describe('dispatch: app-state deletes', () => {
	it('delete_chat_update emits chats.delete with the jid', () => {
		const updates = collect(
			{ type: 'delete_chat_update', data: { jid: jid('5511'), delete_media: false, timestamp: 1, action: {} } },
			'chats.delete'
		)
		expect(updates).toEqual([['5511@s.whatsapp.net']])
	})

	it('delete_message_for_me_update emits messages.delete with the WAMessageKey', () => {
		const updates = collect(
			{
				type: 'delete_message_for_me_update',
				data: { chat_jid: jid('5511'), message_id: 'MID', from_me: true, timestamp: 1, action: {} }
			},
			'messages.delete'
		)
		expect(updates[0]).toMatchObject({
			keys: [{ remoteJid: '5511@s.whatsapp.net', id: 'MID', fromMe: true }]
		})
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — chat presence (composing/recording/paused)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: chat_presence → presence.update', () => {
	const collectAll = (state: string, media?: string) =>
		collect(
			{
				type: 'chat_presence',
				data: { source: { chat: jid('group', 'g.us'), sender: jid('5511') }, state, media: media ?? '' }
			},
			'presence.update'
		)
	const collectPresence = (state: string, media?: string) =>
		Object.values(collectAll(state, media)[0]?.presences ?? {})[0]?.lastKnownPresence

	it("composing without media → 'composing'", () => {
		expect(collectPresence('composing', '')).toBe('composing')
	})

	it("composing + media='audio' → 'recording'", () => {
		expect(collectPresence('composing', 'audio')).toBe('recording')
	})

	it("paused → 'paused'", () => {
		expect(collectPresence('paused')).toBe('paused')
	})

	it('drops the event entirely for unknown wire states (no false typing indicators)', () => {
		expect(collectAll('typing')).toEqual([])
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — emitCBEvents (raw_node)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: emitCBEvents emits all upstream patterns', () => {
	it('fires CB:tag, CB:tag,key:value, CB:tag,key, CB:tag,key:value,childTag, CB:tag,,childTag', () => {
		const { ctx, ws } = makeCtx()
		const fired: string[] = []
		const original = ws.emit.bind(ws)
		ws.emit = (event, ...args) => {
			if (typeof event === 'string') fired.push(event)
			return original(event, ...args)
		}
		makeEventHandler(ctx)({
			type: 'raw_node',
			data: { tag: 'iq', attrs: { id: 'ID-1', type: 'set' }, content: [{ tag: 'pair-success', attrs: {} }] }
		} as never)
		expect(fired).toContain('CB:iq')
		expect(fired).toContain('CB:iq,id:ID-1')
		expect(fired).toContain('CB:iq,id:ID-1,pair-success')
		expect(fired).toContain('CB:iq,id') // bare-key — the upstream pattern that was missing
		expect(fired).toContain('CB:iq,type:set')
		expect(fired).toContain('CB:iq,type')
		expect(fired).toContain('CB:iq,,pair-success')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — history sync (messaging-history.set + bootstrap fan-out)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: history_sync → messaging-history.set', () => {
	const runHistory = (data: Record<string, unknown>) => collect({ type: 'history_sync', data }, 'messaging-history.set')

	it('INITIAL_BOOTSTRAP extracts chats / contacts / messages and sets isLatest=true', () => {
		const sets = runHistory({
			syncType: HSType.INITIAL_BOOTSTRAP,
			progress: 30,
			conversations: [
				{
					id: '5511@s.whatsapp.net',
					name: 'Foo',
					lidJid: '236@lid',
					messages: [
						{
							message: {
								key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'M1' },
								message: { conversation: 'oi' },
								messageTimestamp: 1730000000
							}
						}
					]
				}
			]
		})
		const set = sets[0]
		expect(set?.chats[0]?.id).toBe('5511@s.whatsapp.net')
		expect(set?.contacts[0]?.name).toBe('Foo')
		expect(set?.messages[0]?.key.id).toBe('M1')
		expect(set?.lidPnMappings).toEqual([{ lid: '236@lid', pn: '5511@s.whatsapp.net' }])
		expect(set?.isLatest).toBe(true)
		expect(set?.progress).toBe(30)
		expect(set?.syncType).toBe(HSType.INITIAL_BOOTSTRAP)
	})

	it('RECENT sets isLatest=false', () => {
		const sets = runHistory({ syncType: HSType.RECENT, conversations: [{ id: '5511@s.whatsapp.net', messages: [] }] })
		expect(sets[0]?.isLatest).toBe(false)
	})

	it('ON_DEMAND sets isLatest=undefined', () => {
		const sets = runHistory({ syncType: HSType.ON_DEMAND, conversations: [] })
		expect(sets[0]?.isLatest).toBeUndefined()
	})

	it('PUSH_NAME populates contacts via item.pushnames', () => {
		const sets = runHistory({
			syncType: HSType.PUSH_NAME,
			pushnames: [
				{ id: '5511@s.whatsapp.net', pushname: 'Alice' },
				{ id: '5522@s.whatsapp.net', pushname: 'Bob' }
			]
		})
		expect(sets[0]?.contacts).toEqual([
			{ id: '5511@s.whatsapp.net', notify: 'Alice' },
			{ id: '5522@s.whatsapp.net', notify: 'Bob' }
		])
		expect(sets[0]?.chats).toEqual([])
		expect(sets[0]?.messages).toEqual([])
	})

	it('forwards chunkOrder from the bridge overlay', () => {
		expect(runHistory({ syncType: HSType.RECENT, chunkOrder: 7, conversations: [] })[0]?.chunkOrder).toBe(7)
	})

	it('forwards peerDataRequestSessionId on ON_DEMAND syncs', () => {
		const sets = runHistory({ syncType: HSType.ON_DEMAND, peerDataRequestSessionId: 'PDO-XYZ', conversations: [] })
		expect(sets[0]?.peerDataRequestSessionId).toBe('PDO-XYZ')
	})

	it('omits peerDataRequestSessionId on server-pushed syncs', () => {
		expect(
			runHistory({ syncType: HSType.INITIAL_BOOTSTRAP, conversations: [] })[0]?.peerDataRequestSessionId
		).toBeUndefined()
	})

	it('truncates chat.messages to a single preview entry', () => {
		const sets = runHistory({
			syncType: HSType.INITIAL_BOOTSTRAP,
			conversations: [
				{
					id: '5511@s.whatsapp.net',
					messages: [
						{ message: { key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'A' }, messageTimestamp: 1 } },
						{ message: { key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'B' }, messageTimestamp: 2 } }
					]
				}
			]
		})
		expect(sets[0]?.messages.length).toBe(2)
		expect(sets[0]?.chats[0]?.messages?.length).toBe(1)
	})

	it('also fans out chats.upsert + contacts.upsert when conversations are present', () => {
		const buckets = collectMany(
			{
				type: 'history_sync',
				data: { syncType: HSType.INITIAL_BOOTSTRAP, conversations: [{ id: '5511@s.whatsapp.net', name: 'Foo' }] }
			},
			'chats.upsert',
			'contacts.upsert',
			'messaging-history.set'
		)
		expect(buckets['chats.upsert'].length).toBe(1)
		expect(buckets['contacts.upsert'].length).toBe(1)
		expect(buckets['messaging-history.set'].length).toBe(1)
	})

	it('skips chats.upsert when no conversations (PUSH_NAME-only sync)', () => {
		const buckets = collectMany(
			{
				type: 'history_sync',
				data: { syncType: HSType.PUSH_NAME, pushnames: [{ id: '5511@s.whatsapp.net', pushname: 'Foo' }] }
			},
			'chats.upsert',
			'contacts.upsert'
		)
		expect(buckets['chats.upsert'].length).toBe(0)
		expect(buckets['contacts.upsert'].length).toBe(1)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — incoming call (auxiliary fields)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: incoming_call', () => {
	it('preserves offer-only auxiliary fields (callerCountryCode, joinable, audio, stanzaId, notify, platform)', () => {
		const calls = collect(
			{
				type: 'incoming_call',
				data: {
					from: jid('5511'),
					stanza_id: 'STAN-1',
					notify: 'Foo',
					platform: 'web',
					version: '2.3000',
					timestamp: 1730000000,
					offline: false,
					action: {
						type: 'offer',
						call_id: 'CALL-1',
						caller_pn: jid('5511'),
						caller_country_code: 'BR',
						device_class: 'web',
						joinable: true,
						is_video: false,
						audio: ['opus', 'g722']
					}
				}
			},
			'call'
		)
		const call = calls[0]?.[0]
		expect(call).toMatchObject({
			callerCountryCode: 'BR',
			joinable: true,
			audio: ['opus', 'g722'],
			stanzaId: 'STAN-1',
			notify: 'Foo',
			platform: 'web'
		})
	})

	it('preserves terminate-only fields (duration, audioDuration)', () => {
		const calls = collect(
			{
				type: 'incoming_call',
				data: {
					from: jid('5511'),
					stanza_id: 'STAN-2',
					timestamp: 1730000000,
					offline: false,
					action: { type: 'terminate', call_id: 'CALL-1', duration: 120, audio_duration: 95 }
				}
			},
			'call'
		)
		const call = calls[0]?.[0]
		expect(call).toMatchObject({ duration: 120, audioDuration: 95, status: 'terminate' })
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Storage — useBridgeStore critical paths
// ─────────────────────────────────────────────────────────────────────────────

const withTempStore = async (fn: (folder: string) => Promise<void>) => {
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-store-'))
	try {
		await fn(folder)
	} finally {
		await rm(folder, { recursive: true, force: true })
	}
}

describe('useBridgeStore: critical stores write through synchronously', () => {
	for (const store of [
		'session',
		'identity',
		'device',
		'prekey',
		'sync_key',
		'sender_key',
		'sync_version',
		'mutation_mac'
	]) {
		it(`${store} hits the disk before set() resolves`, async () => {
			await withTempStore(async folder => {
				const s = await useBridgeStore(folder)
				const value = new Uint8Array([1, 2, 3])
				await s.set(store, 'k1', value)
				const written = await readFile(join(folder, `${store}-k1.bin`))
				expect(new Uint8Array(written)).toEqual(value)
			})
		})
	}
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth — useMultiFileAuthState shape
// ─────────────────────────────────────────────────────────────────────────────

describe('useMultiFileAuthState', () => {
	it('returns { state, saveCreds } so upstream-style auth wiring works', async () => {
		await withTempStore(async folder => {
			const ret = await useMultiFileAuthState(folder)
			expect(ret.state).toBeDefined()
			expect(typeof ret.saveCreds).toBe('function')
			await ret.saveCreds()
		})
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// WABinary — assertNodeErrorFree
// ─────────────────────────────────────────────────────────────────────────────

describe('assertNodeErrorFree', () => {
	it('throws Boom when an <error> child is present', () => {
		expect(() =>
			assertNodeErrorFree({
				tag: 'iq',
				attrs: { type: 'error' },
				content: [{ tag: 'error', attrs: { code: '403', text: 'forbidden' } }]
			})
		).toThrow(Boom)
	})

	it('passes through nodes without an <error> child', () => {
		expect(() =>
			assertNodeErrorFree({ tag: 'iq', attrs: { type: 'result' }, content: [{ tag: 'pair-success', attrs: {} }] })
		).not.toThrow()
	})
})
