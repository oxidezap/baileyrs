import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { encodeMessageWireBatch, encodeProto, encodeReceiptWireBatch } from '@oxidezap/whatsapp-rust-bridge'
import type { proto as protoTypes } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'

import { adaptBridgeEvent } from '../Bridge/adapt.ts'
import type { CanonicalEvent, CanonicalGroupAction } from '../Bridge/types.ts'
import { buildGroupNotificationDomainEvent, buildGroupNotificationStubMessages } from '../Socket/group-notifications.ts'
import { makeEventHandler, makeEventHandlers } from '../Socket/events.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BaileysEventMap, BinaryNode } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
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
		getMe: () => undefined,
		setUser: () => {},
		reportUnexpectedError: () => {},
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

const baseMessageWireInfo = {
	chat: '5511@s.whatsapp.net',
	sender: '5511@s.whatsapp.net',
	isGroup: false,
	isFromMe: false,
	id: 'MSG-1',
	timestamp: 1_730_000_000,
	pushName: 'Foo',
	isViewOnce: false,
	isOffline: false
}

/** Build a `MessageWireBatch` exactly as the bridge writes it. */
const wireMessageBatch = (
	entries: ReadonlyArray<{ id: string; message?: Record<string, unknown>; info?: Record<string, unknown> }>
) =>
	encodeMessageWireBatch(
		entries.map(entry => ({
			payload: encodeProto('Message', entry.message ?? { conversation: entry.id }),
			info: { ...baseMessageWireInfo, ...entry.info, id: entry.id }
		}))
	)

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

	it('infers group source from @g.us when the bridge flag is false', () => {
		const receipt = adapt(
			{
				type: 'receipt',
				data: {
					source: { chat: jid('120363', 'g.us'), sender: jid('5511'), is_group: false, is_from_me: false },
					message_ids: ['GROUP-ACK'],
					type: 'delivered',
					timestamp: 1730000000
				}
			},
			'receipt'
		)
		expect(receipt.isGroup).toBe(true)
		expect(receipt.senderJid).toBe('5511@s.whatsapp.net')
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

describe('adapter: pairing_code_error', () => {
	const evt = (data: Record<string, unknown>) => ({ type: 'pairing_code_error', data })

	it('lands on the same canonical event a pair_error does', () => {
		expect(adapt(evt({ error: 'rejected', rejection: 3, backoff: 300 }), 'pairError')).toEqual({
			type: 'pairError',
			error: 'rejected',
			rejection: 3,
			backoff: 300
		})
	})

	it('leaves rejection and backoff absent when the server named neither', () => {
		const c = adapt(evt({ error: 'no connection' }), 'pairError')
		expect(c.rejection).toBeUndefined()
		expect(c.backoff).toBeUndefined()
	})

	// The spent code is displayed through `connection.update.qr` (a pairing code
	// surfaces as a QR does), so `connecting` with an explicit `qr: undefined`
	// is what stops it being offered. Dropping the event left it on screen.
	it('clears the spent code and keeps the socket open', () => {
		const updates = collect(evt({ error: 'rejected' }), 'connection.update')
		expect(updates).toEqual([{ connection: 'connecting', qr: undefined, receivedPendingNotifications: false }])
	})
})

describe('adapter: disable_link_previews_update', () => {
	const evt = (data: Record<string, unknown>) => ({ type: 'disable_link_previews_update', data })

	it('carries the action through as upstream does', () => {
		expect(adapt(evt({ previews_disabled: true, action: { isPreviewsDisabled: true } }), 'settingUpdate')).toEqual({
			type: 'settingUpdate',
			setting: 'disableLinkPreviews',
			value: { isPreviewsDisabled: true }
		})
	})

	// The flag the bridge decoded is the same bit; it fills the action in rather
	// than handing consumers a value missing the only field they read.
	it('falls back to the decoded flag when the action omits it', () => {
		expect(adapt(evt({ previews_disabled: true, action: {} }), 'settingUpdate').value).toEqual({
			isPreviewsDisabled: true
		})
	})

	it('emits on upstream own settings.update channel', () => {
		expect(
			collect(evt({ previews_disabled: false, action: { isPreviewsDisabled: false } }), 'settings.update')
		).toEqual([{ setting: 'disableLinkPreviews', value: { isPreviewsDisabled: false } }])
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
	// The wire states how long the ban lasts; the canonical event promises the
	// instant it lifts. The adapter converts, so a fixed input no longer has a
	// fixed output — see `Bridge/__tests__/payload-shapes.test.ts` for the
	// window this is checked against.
	it('captures the code and reports the ban as a deadline', () => {
		const before = Math.floor(Date.now() / 1000)
		const c = adapt({ type: 'temporary_ban', data: { code: 102, expire: 3600 } }, 'temporaryBan')
		const after = Math.floor(Date.now() / 1000)
		expect(c.code).toBe(102)
		expect(c.expire! >= before + 3600 && c.expire! <= after + 3600).toBe(true)
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

	it('retains every currently known official advanced action instead of collapsing to unknown', () => {
		const cases: [Record<string, unknown>, CanonicalGroupAction['type']][] = [
			[
				{ type: 'linked_group_promote', participants: [{ jid: jid('111', 'lid'), type: 'superadmin' }] },
				'linkedGroupPromote'
			],
			[{ type: 'linked_group_demote', participants: [{ jid: jid('111', 'lid') }] }, 'linkedGroupDemote'],
			[{ type: 'suspended' }, 'suspended'],
			[{ type: 'unsuspended' }, 'unsuspended'],
			[{ type: 'auto_add_disabled' }, 'autoAddDisabled'],
			[{ type: 'is_capi_hosted_group' }, 'capiHostedGroup'],
			[{ type: 'group_safety_check' }, 'groupSafetyCheck'],
			[{ type: 'limit_sharing_enabled', trigger: 7 }, 'limitSharingEnabled'],
			[{ type: 'allow_admin_reports' }, 'allowAdminReports'],
			[{ type: 'not_allow_admin_reports' }, 'notAllowAdminReports'],
			[{ type: 'reports' }, 'reports'],
			[{ type: 'allow_non_admin_sub_group_creation' }, 'allowNonAdminSubGroupCreation'],
			[{ type: 'not_allow_non_admin_sub_group_creation' }, 'notAllowNonAdminSubGroupCreation'],
			[{ type: 'created_sub_group_suggestion' }, 'createdSubGroupSuggestion'],
			[{ type: 'revoked_sub_group_suggestions' }, 'revokedSubGroupSuggestions'],
			[
				{
					type: 'change_number',
					new_owner: jid('5511'),
					sub_group_suggestions: [jid('1201', 'g.us'), jid('1202', 'g.us')]
				},
				'changeNumber'
			]
		]

		for (const [action, expected] of cases) {
			expect(adapt(groupEvt(action), 'groupUpdate').action.type).toBe(expected)
		}
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
			pastParticipants: undefined,
			chunkOrder: undefined,
			peerDataRequestSessionId: undefined,
			// Batch markers: absent in the payload → defaults to a single final batch.
			batchIndex: undefined,
			isFinalBatch: true
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

	it('coalesces a packed receipt batch into one emission carrying every update', () => {
		const { ctx, ev } = makeCtx()
		const updates: BaileysEventMap['message-receipt.update'][] = []
		ev.on('message-receipt.update', payload => updates.push(payload))

		makeEventHandlers(ctx).onReceiptBatch?.(
			encodeReceiptWireBatch([
				{
					source: { chat: jid('5511'), sender: jid('5511'), is_group: false, is_from_me: false },
					message_ids: ['A', 'B'],
					timestamp: 1730000000,
					type: 'Read',
					offline: false
				},
				{
					source: { chat: jid('5522'), sender: jid('5522'), is_group: false, is_from_me: false },
					message_ids: ['C'],
					timestamp: 1730000001,
					type: 'Played',
					offline: true
				}
			])
		)

		// One EventEmitter round trip for the batch, not one per receipt, with
		// the per-receipt fan-out and timestamp slots preserved in wire order.
		expect(updates.length).toBe(1)
		expect(updates[0]?.map(u => u.key.id)).toEqual(['A', 'B', 'C'])
		expect(updates[0]?.map(u => u.key.remoteJid)).toEqual([
			'5511@s.whatsapp.net',
			'5511@s.whatsapp.net',
			'5522@s.whatsapp.net'
		])
		expect(updates[0]?.[0]?.receipt.readTimestamp).toBe(1730000000)
		expect(updates[0]?.[1]?.receipt.readTimestamp).toBe(1730000000)
		expect(updates[0]?.[2]?.receipt.playedTimestamp).toBe(1730000001)
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

	it('attributes a group receipt to its acknowledging participant when is_group is false', () => {
		const updates =
			collect(
				{
					type: 'receipt',
					data: {
						source: {
							chat: jid('120363', 'g.us'),
							sender: jid('5511'),
							is_group: false,
							is_from_me: false
						},
						message_ids: ['GROUP-ACK'],
						type: 'delivered',
						timestamp: 1730000000
					}
				},
				'message-receipt.update'
			)[0] ?? []
		expect(updates[0]?.key.participant).toBe('5511@s.whatsapp.net')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — messages (reactions, REVOKE, EDIT, undecryptable)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: typed bridge message batches', () => {
	it('decodes protobuf-wire batches into the same ordered upsert', () => {
		const { ctx, ev } = makeCtx()
		const upserts: BaileysEventMap['messages.upsert'][] = []
		ev.on('messages.upsert', payload => upserts.push(payload))

		const ids = ['WIRE-1', 'WIRE-2', 'WIRE-3']
		makeEventHandlers(ctx).onMessageBatch?.(wireMessageBatch(ids.map(id => ({ id }))))

		expect(upserts.length).toBe(1)
		expect(upserts[0]?.messages.map(message => message.key.id)).toEqual(ids)
		expect(upserts[0]?.messages.map(message => message.message?.conversation)).toEqual(ids)
	})

	it('coalesces adjacent ordinary messages into one ordered upsert', () => {
		const { ctx, ev } = makeCtx()
		const upserts: BaileysEventMap['messages.upsert'][] = []
		ev.on('messages.upsert', payload => upserts.push(payload))

		makeEventHandlers(ctx).onMessageBatch?.(wireMessageBatch([{ id: 'BATCH-1' }, { id: 'BATCH-2' }, { id: 'BATCH-3' }]))

		expect(upserts.length).toBe(1)
		expect(upserts[0]?.type).toBe('notify')
		expect(upserts[0]?.messages.map(message => message.key.id)).toEqual(['BATCH-1', 'BATCH-2', 'BATCH-3'])
	})

	it('starts a new upsert when delivery type or request id changes', () => {
		const { ctx, ev } = makeCtx()
		const upserts: BaileysEventMap['messages.upsert'][] = []
		ev.on('messages.upsert', payload => upserts.push(payload))

		makeEventHandlers(ctx).onMessageBatch?.(
			wireMessageBatch([
				{ id: 'LIVE' },
				{ id: 'OFFLINE-1', info: { isOffline: true } },
				{ id: 'OFFLINE-2', info: { isOffline: true } },
				{ id: 'PDO', info: { isOffline: true, unavailableRequestId: 'REQUEST-1' } }
			])
		)

		expect(
			upserts.map(upsert => ({
				ids: upsert.messages.map(message => message.key.id),
				type: upsert.type,
				requestId: upsert.requestId
			}))
		).toEqual([
			{ ids: ['LIVE'], type: 'notify', requestId: undefined },
			{ ids: ['OFFLINE-1', 'OFFLINE-2'], type: 'append', requestId: undefined },
			{ ids: ['PDO'], type: 'append', requestId: 'REQUEST-1' }
		])
	})

	it('flushes around side-effect messages and preserves observable order', () => {
		const { ctx, ev } = makeCtx()
		const observed: string[] = []
		ev.on('messages.upsert', (payload: BaileysEventMap['messages.upsert']) => {
			observed.push(`upsert:${payload.messages.map(message => message.key.id).join(',')}`)
		})
		ev.on('messages.reaction', () => observed.push('reaction'))

		makeEventHandlers(ctx).onMessageBatch?.(
			wireMessageBatch([
				{ id: 'BEFORE' },
				{
					id: 'REACTION',
					message: {
						reactionMessage: {
							key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'TARGET' },
							text: '👍'
						}
					}
				},
				{ id: 'AFTER' }
			])
		)

		expect(observed).toEqual(['upsert:BEFORE', 'upsert:REACTION', 'reaction', 'upsert:AFTER'])
	})
})

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

	// Bridge 0.14.0 dedupes dispatched undecryptables by (chat, id, sender)
	// instead of (chat, id): two group participants reusing an id are two
	// messages, and both now reach the consumer.
	it('emits one stub per sender when two participants reuse the same id', () => {
		const { ctx, ev } = makeCtx()
		const upserts: BaileysEventMap['messages.upsert'][] = []
		ev.on('messages.upsert', payload => upserts.push(payload))
		const handler = makeEventHandler(ctx)
		const fromSender = (user: string) => ({
			type: 'undecryptable_message',
			data: {
				info: {
					source: { chat: jid('123456', 'g.us'), sender: jid(user), is_group: true, is_from_me: false },
					id: 'DUP-1',
					timestamp: 1730000000,
					push_name: ''
				},
				is_unavailable: false,
				decrypt_fail_mode: 'show'
			}
		})
		handler(fromSender('5511') as never)
		handler(fromSender('5522') as never)
		const keys = upserts.map(u => u.messages[0]?.key)
		expect(keys.map(k => k?.id)).toEqual(['DUP-1', 'DUP-1'])
		expect(keys.map(k => k?.participant)).toEqual(['5511@s.whatsapp.net', '5522@s.whatsapp.net'])
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — push names from inbound envelopes
// ─────────────────────────────────────────────────────────────────────────────

// Bridge 0.14.0 dropped the dedicated `push_name_update` event; the push name
// now reaches consumers the way upstream surfaces it (`messages-recv.ts`): a
// `contacts.update` with `notify` derived from each inbound envelope.
describe('dispatch: inbound push name → contacts.update', () => {
	const msgEvent = (info: Record<string, unknown>) => ({
		type: 'message',
		data: { info: { ...baseMessageInfo, ...info }, message: { conversation: 'hi' } }
	})

	it('notifies the DM sender push name', () => {
		const updates = collect(msgEvent({}), 'contacts.update')
		expect(updates[0]?.[0]).toEqual({ id: '5511@s.whatsapp.net', notify: 'Foo' })
	})

	it('attributes a group message to the participant, not the group', () => {
		const updates = collect(
			msgEvent({ source: { chat: jid('123456', 'g.us'), sender: jid('5511'), is_group: true, is_from_me: false } }),
			'contacts.update'
		)
		expect(updates[0]?.[0]).toEqual({ id: '5511@s.whatsapp.net', notify: 'Foo' })
	})

	it('stays silent for own messages and for envelopes without a push name', () => {
		const own = msgEvent({ source: { chat: jid('5511'), is_group: false, is_from_me: true } })
		expect(collect(own, 'contacts.update').length).toBe(0)
		expect(collect(msgEvent({ push_name: undefined }), 'contacts.update').length).toBe(0)
	})

	it('also notifies from an undecryptable envelope', () => {
		const updates = collect(
			{
				type: 'undecryptable_message',
				data: {
					info: { ...baseMessageInfo, id: 'BAD-2' },
					is_unavailable: false,
					decrypt_fail_mode: 'show'
				}
			},
			'contacts.update'
		)
		expect(updates[0]?.[0]).toEqual({ id: '5511@s.whatsapp.net', notify: 'Foo' })
	})

	// The wire-batch aggregation branch never reaches the single-message
	// dispatcher, so it has to emit the push name itself.
	it('also notifies from wire-batched ordinary messages', () => {
		const { ctx, ev } = makeCtx()
		const updates: BaileysEventMap['contacts.update'][] = []
		ev.on('contacts.update', payload => updates.push(payload))

		makeEventHandlers(ctx).onMessageBatch?.(wireMessageBatch([{ id: 'BATCH-1' }, { id: 'BATCH-2' }]))

		expect(updates.length).toBe(2)
		expect(updates[0]?.[0]).toEqual({ id: '5511@s.whatsapp.net', notify: 'Foo' })
	})

	// The engine's dedicated event used to fire for hidden ciphertexts too:
	// the name is envelope metadata, independent of the suppressed stub.
	it("still notifies when decrypt_fail_mode is 'hide'", () => {
		const buckets = collectMany(
			{
				type: 'undecryptable_message',
				data: { info: { ...baseMessageInfo, id: 'BAD-4' }, is_unavailable: false, decrypt_fail_mode: 'hide' }
			},
			'contacts.update',
			'messages.upsert'
		)
		expect(buckets['contacts.update'][0]?.[0]).toEqual({ id: '5511@s.whatsapp.net', notify: 'Foo' })
		expect(buckets['messages.upsert'].length).toBe(0)
	})

	// A consumer listener that throws must not abort the rest of the batch;
	// dispatchCanonicalEvent contains the single path the same way.
	it('contains a throwing contacts.update listener inside a wire batch', () => {
		const { ctx, ev } = makeCtx()
		const upserts: BaileysEventMap['messages.upsert'][] = []
		let threw = false
		ev.on('contacts.update', () => {
			if (!threw) {
				threw = true
				throw new Error('consumer bug')
			}
		})
		ev.on('messages.upsert', payload => upserts.push(payload))

		makeEventHandlers(ctx).onMessageBatch?.(wireMessageBatch([{ id: 'BATCH-1' }, { id: 'BATCH-2' }]))

		expect(threw).toBe(true)
		expect(upserts.flatMap(u => u.messages.map(m => m.key.id))).toEqual(['BATCH-2'])
	})

	it('honors shouldIgnoreJid on the undecryptable path', () => {
		const { ctx, ev } = makeCtx()
		ctx.fullConfig = { shouldIgnoreJid: () => true } as never
		const updates: BaileysEventMap['contacts.update'][] = []
		ev.on('contacts.update', payload => updates.push(payload))
		makeEventHandler(ctx)({
			type: 'undecryptable_message',
			data: { info: { ...baseMessageInfo, id: 'BAD-3' }, is_unavailable: false, decrypt_fail_mode: 'show' }
		} as never)
		expect(updates.length).toBe(0)
	})

	// A status post's canonical shape has the pseudo-contact as chatJid and no
	// senderJid; attributing the poster's name to `status@broadcast` would let
	// every poster overwrite one fake contact. Until the canonical layer
	// carries the broadcast participant, staying silent is the correct shape.
	it('never attributes a push name to a broadcast pseudo-contact', () => {
		const updates = collect(
			msgEvent({
				source: { chat: jid('status', 'broadcast'), sender: jid('5511'), is_group: false, is_from_me: false }
			}),
			'contacts.update'
		)
		expect(updates.length).toBe(0)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — group events
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch: group_update.create', () => {
	it('resolves metadata and emits chats, groups, then the create stub', async () => {
		const { ctx, ev } = makeCtx()
		const observed: string[] = []
		const groups: BaileysEventMap['groups.upsert'][] = []
		const messages: BaileysEventMap['messages.upsert'][] = []
		ev.on('chats.upsert', () => observed.push('chats.upsert'))
		ev.on('groups.upsert', payload => {
			observed.push('groups.upsert')
			groups.push(payload)
		})
		ev.on('messages.upsert', payload => {
			observed.push('messages.upsert')
			messages.push(payload)
		})
		ctx.getClient = async () =>
			({
				getGroupMetadata: async () => ({
					id: '120363@g.us',
					subject: 'Created group',
					participants: [],
					addressingMode: 'pn',
					creator: '5511@s.whatsapp.net',
					creationTime: 1730000000,
					isLocked: false,
					isAnnouncement: false,
					membershipApproval: false,
					isParentGroup: false,
					isDefaultSubGroup: false,
					isGeneralChat: false,
					allowNonAdminSubGroupCreation: false,
					noFrequentlyForwarded: false,
					isSuspended: false,
					allowAdminReports: false,
					isHiddenGroup: false,
					isIncognito: false,
					hasGroupHistory: false,
					isLimitSharingEnabled: false
				})
			}) as never

		makeEventHandler(ctx)({
			type: 'group_update',
			data: {
				group_jid: jid('120363', 'g.us'),
				notification_id: 'CREATE-1',
				action_index: 0,
				participant: jid('236', 'lid'),
				participant_username: 'creator-user',
				timestamp: 1730000000,
				is_lid_addressing_mode: false,
				action: { type: 'create' }
			}
		} as never)
		await new Promise(resolve => setImmediate(resolve))

		expect(observed).toEqual(['chats.upsert', 'groups.upsert', 'messages.upsert'])
		expect(groups[0]?.[0]).toMatchObject({
			id: '120363@g.us',
			subject: 'Created group',
			author: '236@lid',
			authorUsername: 'creator-user'
		})
		expect(messages[0]?.type).toBe('append')
		expect(messages[0]?.messages[0]?.key.id).toBe('CREATE-1')
		expect(messages[0]?.messages[0]?.messageStubType).toBe(StubType.GROUP_CREATE)
		expect(messages[0]?.messages[0]?.messageStubParameters).toEqual(['Created group'])
	})
})

describe('dispatch: advanced official group actions', () => {
	it('does not invent public Baileys events for tags upstream currently ignores', () => {
		const actions = [
			{ type: 'linked_group_promote', participants: [{ jid: jid('111', 'lid') }] },
			{ type: 'linked_group_demote', participants: [{ jid: jid('111', 'lid') }] },
			{ type: 'suspended' },
			{ type: 'unsuspended' },
			{ type: 'auto_add_disabled' },
			{ type: 'is_capi_hosted_group' },
			{ type: 'group_safety_check' },
			{ type: 'limit_sharing_enabled', trigger: 1 },
			{ type: 'allow_admin_reports' },
			{ type: 'not_allow_admin_reports' },
			{ type: 'reports' },
			{ type: 'allow_non_admin_sub_group_creation' },
			{ type: 'not_allow_non_admin_sub_group_creation' },
			{ type: 'created_sub_group_suggestion' },
			{ type: 'revoked_sub_group_suggestions' },
			{ type: 'change_number', new_owner: jid('5511'), sub_group_suggestions: [jid('1201', 'g.us')] }
		]

		for (const action of actions) {
			const emitted = collectMany(
				{
					type: 'group_update',
					data: {
						group_jid: jid('120', 'g.us'),
						participant: jid('236', 'lid'),
						timestamp: 1730000000,
						is_lid_addressing_mode: true,
						action
					}
				},
				'groups.update',
				'group-participants.update',
				'group.join-request',
				'messages.upsert'
			)
			expect(Object.values(emitted).every(events => events.length === 0)).toBe(true)
		}
	})
})

describe('dispatch: group-participants.update preserves phoneNumber', () => {
	it('LID-addressed participants carry their PN counterpart', () => {
		const domainEvent = buildGroupNotificationDomainEvent({
			type: 'groupUpdate',
			groupJid: '120@g.us',
			actionIndex: 0,
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

describe('dispatch: group invite-link parity', () => {
	const notification = {
		type: 'groupUpdate' as const,
		groupJid: '120@g.us',
		notificationId: 'INVITE-1',
		actionIndex: 0,
		author: '236@lid',
		authorPn: '5599@s.whatsapp.net',
		timestamp: 1,
		isLidAddressingMode: true,
		action: { type: 'invite' as const, code: 'AbCdEf123' }
	}

	it('emits inviteCode and the matching GROUP_CHANGE_INVITE_LINK stub', () => {
		const domain = buildGroupNotificationDomainEvent(notification)
		expect(domain?.name).toBe('groups.update')
		if (!domain || domain.name !== 'groups.update') throw new Error('expected groups.update')
		expect(domain.payload).toEqual([
			{
				id: '120@g.us',
				inviteCode: 'AbCdEf123',
				author: '236@lid',
				authorPn: '5599@s.whatsapp.net'
			}
		])

		const [stub] = buildGroupNotificationStubMessages(notification, false)
		expect(stub?.messageStubType).toBe(StubType.GROUP_CHANGE_INVITE_LINK)
		expect(stub?.messageStubParameters).toEqual(['AbCdEf123'])
		expect(stub?.key?.id).toBe('INVITE-1')
	})

	it('does not invent a revoke event or stub that upstream does not expose', () => {
		const revoke = { ...notification, action: { type: 'revokeInvite' as const } }
		expect(buildGroupNotificationDomainEvent(revoke)).toBe(null)
		expect(buildGroupNotificationStubMessages(revoke, false)).toEqual([])
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
					participant_username: 'actor-user',
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

	it('distinguishes requester cancellation from admin rejection', () => {
		const requests = collectJoinRequests({
			type: 'revoked_membership_requests',
			participants: [jid('236', 'lid'), jid('222', 'lid')]
		})
		expect(requests.map(r => r.action)).toEqual(['revoked', 'rejected'])
		expect(requests[0]?.authorUsername).toBe('actor-user')
		expect(requests[0]?.method).toBeUndefined()
	})

	it('drops unknown request_method silently (server may grow new variants)', () => {
		const requests = collectJoinRequests({ type: 'membership_approval_request', request_method: 'future_method' })
		expect(requests[0]?.method).toBeUndefined()
	})

	it('encodes exact join-approval stub parameters for every affected participant', () => {
		const base = {
			type: 'groupUpdate' as const,
			groupJid: '120@g.us',
			notificationId: 'JOIN-1',
			actionIndex: 2,
			author: '236@lid',
			authorPn: '5599@s.whatsapp.net',
			timestamp: 1,
			isLidAddressingMode: true
		}
		const created = buildGroupNotificationStubMessages(
			{
				...base,
				action: {
					type: 'createdMembershipRequests',
					requestMethod: 'invite_link',
					requests: [
						{ jid: '111@lid', phoneNumber: '5511@s.whatsapp.net' },
						{ jid: '222@lid', phoneNumber: '5522@s.whatsapp.net' }
					]
				}
			},
			false
		)
		expect(created).toHaveLength(2)
		expect(created.map(message => message.messageStubParameters)).toEqual([
			[JSON.stringify({ lid: '111@lid', pn: '5511@s.whatsapp.net' }), 'created', 'invite_link'],
			[JSON.stringify({ lid: '222@lid', pn: '5522@s.whatsapp.net' }), 'created', 'invite_link']
		])

		const revoked = buildGroupNotificationStubMessages(
			{
				...base,
				action: {
					type: 'revokedMembershipRequests',
					participants: [
						{ jid: '236@lid', phoneNumber: '5599@s.whatsapp.net' },
						{ jid: '222@lid', phoneNumber: '5522@s.whatsapp.net' }
					]
				}
			},
			false
		)
		expect(revoked.map(message => message.messageStubParameters)).toEqual([
			[JSON.stringify({ lid: '236@lid', pn: '5599@s.whatsapp.net' }), 'revoked'],
			[JSON.stringify({ lid: '222@lid', pn: '5522@s.whatsapp.net' }), 'rejected']
		])
		expect(
			revoked.every(
				message => message.messageStubType === StubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD
			)
		).toBe(true)
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
		actionIndex: 0,
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

describe('dispatch: offline_sync_completed', () => {
	it('surfaces upstream receivedPendingNotifications readiness', () => {
		const updates = collect({ type: 'offline_sync_completed', data: { count: 4 } }, 'connection.update')
		expect(updates).toEqual([{ receivedPendingNotifications: true }])
	})
})

describe('event buffer: connection.update delivery', () => {
	// `EventEmitter.emit()` stops at the first listener that throws. On the
	// lifecycle channel that means one bad handler keeps the app's reconnect
	// handler from ever seeing a terminal `close` — the bot stays offline, which
	// is the failure the whole close contract exists to prevent.
	it('keeps notifying listeners after one throws', () => {
		const ev = makeEventBuffer(noopLogger as never)
		const seen: string[] = []

		ev.on('connection.update', () => {
			seen.push('first')
			throw new Error('listener exploded')
		})
		ev.on('connection.update', () => seen.push('second'))

		ev.emit('connection.update', { connection: 'close' } as never)

		expect(seen).toEqual(['first', 'second'])
	})

	it('calls listeners with the emitter as `this`, as emit() would', () => {
		// A listener declared as a normal function that removes itself with
		// `this.off(...)` is a common pattern; calling it bare makes `this`
		// undefined and the throw is swallowed by the isolation above.
		const ev = makeEventBuffer(noopLogger as never)
		let receiverMatched = false

		ev.on('connection.update', function selfRemoving(this: unknown) {
			receiverMatched = typeof (this as { off?: unknown })?.off === 'function'
		})

		ev.emit('connection.update', { connection: 'close' } as never)

		expect(receiverMatched).toBe(true)
	})

	it('still stops at a throwing listener on other channels, as upstream does', () => {
		const ev = makeEventBuffer(noopLogger as never)
		const seen: string[] = []

		ev.on('creds.update', () => {
			seen.push('first')
			throw new Error('listener exploded')
		})
		ev.on('creds.update', () => seen.push('second'))

		expect(() => ev.emit('creds.update', {} as never)).toThrow()
		expect(seen).toEqual(['first'])
	})
})

describe('dispatch: connect_failure → DisconnectReason mapping', () => {
	const closeStatusFor = (reason: number) => {
		const updates = collect({ type: 'connect_failure', data: { reason, message: '' } }, 'connection.update')
		return (updates[0]?.lastDisconnect?.error as Boom | undefined)?.output?.statusCode
	}

	it('maps 401 (LoggedOut) to loggedOut', () => {
		expect(closeStatusFor(401)).toBe(401)
	})

	// The wire code, not `badSession` (500). badSession is what bots branch on
	// to wipe credentials and re-pair, and an outdated build is the one failure
	// where doing that helps nobody. Upstream keeps the wire code too —
	// `getErrorCodeFromStreamError` reads `+node.attrs.code` first and only
	// falls back to badSession when the stanza carries none.
	it('maps 405 (ClientOutdated) to the wire code, not badSession', () => {
		expect(closeStatusFor(405)).toBe(405)
	})

	// 500/503 are the two reasons `ConnectFailureReason::should_reconnect()`
	// matches, so the engine keeps retrying and the socket reports `connecting`
	// rather than a `close` the upstream handler would answer with a second
	// socket. See `auto-reconnect-terminal-close.test.ts`.
	it('does not close on 503 (ServiceUnavailable) — the engine retries it', () => {
		const updates = collect({ type: 'connect_failure', data: { reason: 503, message: '' } }, 'connection.update')
		expect(updates.map(update => update.connection)).toEqual(['connecting'])
	})

	it('falls back to connectionClosed for unknown codes', () => {
		expect(closeStatusFor(999)).toBe(428)
	})
})

describe('dispatch: temporary_ban', () => {
	it('exposes code and expire on the Boom error data', () => {
		const before = Math.floor(Date.now() / 1000)
		const updates = collect({ type: 'temporary_ban', data: { code: 102, expire: 3600 } }, 'connection.update')
		const after = Math.floor(Date.now() / 1000)
		const error = updates[0]?.lastDisconnect?.error as Boom & { data?: { code: number; expire: number } }
		expect(error.data?.code).toBe(102)
		// A deadline, because that is what the socket formats and what a
		// reconnect policy subtracts `Date.now()` from.
		expect(error.data!.expire >= before + 3600 && error.data!.expire <= after + 3600).toBe(true)
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

	// The attrs walk is `for..in`, which sees the prototype chain where the
	// `Object.entries` it replaced did not. An attrs map that inherits an
	// enumerable must not fire CB events for an attr the stanza never carried.
	it('fires nothing for attrs inherited from the prototype chain', () => {
		const { ctx, ws } = makeCtx()
		const fired: string[] = []
		const original = ws.emit.bind(ws)
		ws.emit = (event, ...args) => {
			if (typeof event === 'string') fired.push(event)
			return original(event, ...args)
		}
		const attrs: BinaryNode['attrs'] = Object.create({ inherited: 'ghost' })
		attrs.type = 'set'
		makeEventHandler(ctx)({
			type: 'raw_node',
			data: { tag: 'iq', attrs, content: [] }
		} as never)
		expect(fired).toContain('CB:iq,type:set')
		expect(fired.some(event => event.includes('inherited'))).toBe(false)
	})

	it('uses the raw node as the single lossless CB source for server ACKs', () => {
		const { ctx, ev, ws } = makeCtx()
		const rawAcks: BinaryNode[] = []
		const updates: BaileysEventMap['messages.update'][] = []
		ws.on('CB:ack,class:message', node => rawAcks.push(node))
		ev.on('messages.update', update => updates.push(update))

		const rawAck: BinaryNode = {
			tag: 'ack',
			attrs: {
				id: 'MSG-ACK-1',
				class: 'message',
				from: 'group@g.us',
				participant: '5511999999999:7@s.whatsapp.net',
				recipient: '5511888888888@s.whatsapp.net',
				type: 'text',
				t: '1734000000',
				sync: '1',
				phash: '2:abc+/def',
				refresh_lid: 'true',
				addressing_mode: 'lid',
				count: '3'
			}
		}

		const dispatch = makeEventHandler(ctx)
		dispatch({ type: 'raw_node', data: rawAck } as never)
		// The semantic event follows the same raw stanza in the core. It must not
		// reconstruct a second, field-reduced public ACK.
		dispatch({
			type: 'server_ack',
			data: {
				id: rawAck.attrs.id,
				class: rawAck.attrs.class,
				from: jid('group', 'g.us'),
				timestamp: 1_734_000_000,
				error: null
			}
		} as never)

		expect(rawAcks).toEqual([rawAck])
		expect(updates).toHaveLength(0)
	})

	it('maps typed message NACKs to ERROR updates without synthesizing a raw ACK', () => {
		const { ctx, ev, ws } = makeCtx()
		const rawAcks: BinaryNode[] = []
		const updates: BaileysEventMap['messages.update'][] = []
		ws.on('CB:ack,class:message', node => rawAcks.push(node))
		ev.on('messages.update', update => updates.push(update))

		makeEventHandler(ctx)({
			type: 'server_ack',
			data: {
				id: 'MSG-NACK-1',
				class: 'message',
				from: jid('group', 'g.us'),
				timestamp: 1_734_000_000,
				error: '479'
			}
		} as never)

		expect(rawAcks).toHaveLength(0)
		expect(updates).toHaveLength(1)
		expect(updates[0]?.[0]?.key).toEqual({
			remoteJid: 'group@g.us',
			fromMe: true,
			id: 'MSG-NACK-1'
		})
		expect(updates[0]?.[0]?.update.status).toBe(proto.WebMessageInfo.Status.ERROR)
		expect(updates[0]?.[0]?.update.messageStubParameters).toEqual(['479'])
	})
})

describe('dispatch: dirty_state uses the typed internal callback', () => {
	it('does not require raw-node forwarding to refresh participating metadata', () => {
		const { ctx } = makeCtx()
		const dirtyTypes: string[] = []
		makeEventHandler(ctx, {
			onDirtyState: event => dirtyTypes.push(event.dirtyType)
		})({ type: 'dirty_state', data: { dirty_type: 'groups', timestamp: 1_725_000_000 } } as never)

		expect(dirtyTypes).toEqual(['groups'])
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — history sync (messaging-history.set + bootstrap fan-out)
// ─────────────────────────────────────────────────────────────────────────────

// The bridge may split one chunk into bounded batches (isFinalBatch=false on
// all but the last). `isLatest`/`progress` are chunk-level, so they must fire
// ONLY on the final batch; intermediate batches just append content.
const conv = (id: string) => ({
	id,
	messages: [
		{
			message: {
				key: { remoteJid: id, fromMe: false, id: 'M' },
				message: { conversation: 'x' },
				messageTimestamp: 1730000000
			}
		}
	]
})

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

	it('batched INITIAL_BOOTSTRAP: intermediate batch has isLatest=false and no progress, content still flows', () => {
		const mid = runHistory({
			syncType: HSType.INITIAL_BOOTSTRAP,
			progress: 50,
			batchIndex: 0,
			isFinalBatch: false,
			conversations: [conv('a@s.whatsapp.net')]
		})
		expect(mid[0]?.isLatest).toBe(false)
		expect(mid[0]?.progress).toBeUndefined()
		expect(mid[0]?.chats[0]?.id).toBe('a@s.whatsapp.net')
		expect(mid[0]?.messages[0]?.key.id).toBe('M')
	})

	it('batched INITIAL_BOOTSTRAP: final batch sets isLatest=true and carries progress', () => {
		const fin = runHistory({
			syncType: HSType.INITIAL_BOOTSTRAP,
			progress: 100,
			batchIndex: 1,
			isFinalBatch: true,
			conversations: [conv('b@s.whatsapp.net')]
		})
		expect(fin[0]?.isLatest).toBe(true)
		expect(fin[0]?.progress).toBe(100)
		expect(fin[0]?.chats[0]?.id).toBe('b@s.whatsapp.net')
	})

	it('missing batch markers behave as a single final batch (back-compat)', () => {
		const sets = runHistory({
			syncType: HSType.INITIAL_BOOTSTRAP,
			progress: 20,
			conversations: [conv('c@s.whatsapp.net')]
		})
		expect(sets[0]?.isLatest).toBe(true)
		expect(sets[0]?.progress).toBe(20)
	})

	it('two chunks with the same syncType each dispatch independently', () => {
		const a = runHistory({
			syncType: HSType.RECENT,
			chunkOrder: 1,
			isFinalBatch: true,
			conversations: [conv('a@s.whatsapp.net')]
		})
		const b = runHistory({
			syncType: HSType.RECENT,
			chunkOrder: 2,
			isFinalBatch: true,
			conversations: [conv('b@s.whatsapp.net')]
		})
		expect(a[0]?.chats[0]?.id).toBe('a@s.whatsapp.net')
		expect(b[0]?.chats[0]?.id).toBe('b@s.whatsapp.net')
		expect(a[0]?.isLatest).toBe(false)
		expect(b[0]?.isLatest).toBe(false)
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

	it('forwards pastParticipants from the decoded history proto', () => {
		const pastParticipants = [{ groupJid: '120@g.us', pastParticipants: [{ userJid: '236@lid', leaveTs: 100 }] }]
		const sets = runHistory({ syncType: HSType.RECENT, conversations: [], pastParticipants })
		expect(sets[0]?.pastParticipants).toEqual(pastParticipants)
	})

	it('emits explicit history completion status once per INITIAL_BOOTSTRAP and RECENT phase', () => {
		const { ctx, ev } = makeCtx()
		const statuses: BaileysEventMap['messaging-history.status'][] = []
		ev.on('messaging-history.status', value => statuses.push(value))
		const handle = makeEventHandler(ctx)
		handle({
			type: 'history_sync',
			data: { syncType: HSType.INITIAL_BOOTSTRAP, progress: 10, conversations: [] }
		} as never)
		handle({
			type: 'history_sync',
			data: { syncType: HSType.INITIAL_BOOTSTRAP, progress: 100, conversations: [] }
		} as never)
		handle({
			type: 'history_sync',
			data: { syncType: HSType.RECENT, progress: 50, conversations: [] }
		} as never)
		handle({
			type: 'history_sync',
			data: { syncType: HSType.RECENT, progress: 100, conversations: [] }
		} as never)

		expect(statuses).toEqual([
			{ syncType: HSType.INITIAL_BOOTSTRAP, status: 'complete', explicit: true },
			{ syncType: HSType.RECENT, status: 'complete', explicit: true }
		])
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

describe('dispatch: MessageCappingInfoNotification → message-capping.update', () => {
	it('unwraps the neutral MEX response without renaming its public snake_case fields', () => {
		const payload = {
			total_quota: 100,
			used_quota: 25,
			cycle_start_timestamp: '1000',
			cycle_end_timestamp: '2000',
			server_sent_timestamp: '1500',
			ote_status: 'ELIGIBLE',
			mv_status: 'ACTIVE',
			capping_status: 'FIRST_WARNING'
		}
		const updates = collect(
			{
				type: 'mex_notification',
				data: {
					op_name: 'MessageCappingInfoNotification',
					offline: false,
					payload: { data: { xwa2_notify_new_chat_messages_capping_info_update: payload } }
				}
			},
			'message-capping.update'
		)
		expect(updates).toEqual([payload])
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
			expect(ret.state.creds.registered).toBe(false)
			expect(ret.state.creds.noiseKey.public.length).toBe(32)
			expect(ret.state.creds.signedPreKey.signature.length).toBe(64)
			expect(typeof ret.state.keys.get).toBe('function')
			expect(typeof ret.state.keys.set).toBe('function')
			expect(ret.state.store).toBeDefined()
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
