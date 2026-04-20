/**
 * Anti-corruption layer between the bridge runtime and baileyrs domain code.
 *
 * Every inbound bridge event flows through `adaptBridgeEvent`, which returns
 * a strictly-typed `CanonicalEvent` (or `null` when the payload is malformed
 * past recovery). Downstream code (notably `Socket/events.ts`) consumes the
 * canonical union exclusively — no `event.data as Whatever` casts, no
 * defensive optional chains, no implicit knowledge of how serde happens to
 * serialize a particular rust enum today.
 *
 * If the bridge's `.d.ts` and runtime ever drift again (renamed field,
 * leaked PascalCase variant, ISO timestamp where a number was promised),
 * the bug surfaces here as one failing fixture test instead of a silent
 * data lie that propagates through the whole event surface.
 */

import type { WhatsAppEvent } from 'whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger.ts'
import type {
	CanonicalCallAction,
	CanonicalCallActionType,
	CanonicalEvent,
	CanonicalGroupAction,
	CanonicalGroupParticipant
} from './types.ts'
import {
	asBoolOr,
	asJidString,
	asNumber,
	asString,
	bridgeJidToString,
	isBridgeJid,
	isObject,
	normalizeDiscriminator,
	toUnixSeconds
} from './primitives.ts'

/**
 * Every bridge event type the adapter explicitly handles. Source of truth
 * for drift detection — `dts-drift.test.ts` cross-checks this against the
 * actual `WhatsAppEvent` union shipped by the bridge's `.d.ts`. Any new
 * `case` in `adaptBridgeEvent` below must also appear here.
 */
export const KNOWN_BRIDGE_EVENT_TYPES = new Set<string>([
	// connection lifecycle
	'connected',
	'disconnected',
	'qr',
	'pairing_code',
	'pair_success',
	'pair_error',
	'logged_out',
	'connect_failure',
	'stream_error',
	'stream_replaced',
	'client_outdated',
	'temporary_ban',
	'qr_scanned_without_multidevice',
	// messages
	'message',
	'receipt',
	'undecryptable_message',
	// contacts
	'push_name_update',
	'contact_update',
	'contact_updated',
	'picture_update',
	// presence
	'presence',
	'chat_presence',
	// groups
	'group_update',
	// chat state
	'archive_update',
	'pin_update',
	'mute_update',
	'star_update',
	'mark_chat_as_read_update',
	// calls
	'incoming_call',
	// acknowledged but no Baileys equivalent
	'self_push_name_updated',
	'history_sync',
	'offline_sync_completed',
	'offline_sync_preview',
	'device_list_update',
	'disappearing_mode_changed',
	'business_status_update',
	'newsletter_live_update',
	'contact_number_changed',
	'contact_sync_requested',
	'user_about_update',
	// app-state sync deletes — handled as noop until a Baileys consumer
	// needs them (they have no direct upstream equivalent and the bridge
	// already mutates its own caches when these arrive)
	'delete_chat_update',
	'delete_message_for_me_update',
	// generic carriers
	'notification',
	'raw_node'
])

/** Result is `null` on unrecoverable shape mismatch — caller should drop the event. */
export const adaptBridgeEvent = (event: WhatsAppEvent, logger?: ILogger): CanonicalEvent | null => {
	const typed = event as unknown as { type: string; data?: unknown }
	const type = typed.type
	const data = typed.data

	switch (type) {
		// ── Connection lifecycle ──
		case 'connected':
			return { type: 'connected' }
		case 'disconnected':
			return { type: 'disconnected' }

		case 'qr':
		case 'pairing_code': {
			if (!isObject(data)) return null
			const code = asString(data.code)
			return code ? { type: 'qr', code } : null
		}

		case 'pair_success': {
			if (!isObject(data)) return null
			const id = asString(data.id)
			if (!id) return null
			return {
				type: 'pairSuccess',
				id,
				lid: asString(data.lid),
				platform: asString(data.platform),
				businessName: asString(data.business_name)
			}
		}

		case 'pair_error': {
			if (!isObject(data)) return null
			return { type: 'pairError', error: asString(data.error) ?? 'Unknown pairing error' }
		}

		case 'logged_out':
			return { type: 'loggedOut' }

		case 'connect_failure': {
			if (!isObject(data)) return { type: 'connectFailure' }
			return { type: 'connectFailure', message: asString(data.message) }
		}

		case 'stream_error': {
			if (!isObject(data)) return null
			return { type: 'streamError', code: asString(data.code) ?? 'unknown' }
		}

		case 'stream_replaced':
			return { type: 'streamReplaced' }
		case 'client_outdated':
			return { type: 'clientOutdated' }
		case 'temporary_ban':
			return { type: 'temporaryBan' }
		case 'qr_scanned_without_multidevice':
			return { type: 'qrScannedWithoutMultidevice' }

		// ── Messages ──
		case 'message':
			return adaptMessage(data, logger)
		case 'receipt':
			return adaptReceipt(data, logger)
		case 'undecryptable_message':
			return { type: 'undecryptableMessage', raw: data }

		// ── Contacts ──
		case 'push_name_update': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			if (!jid) return null
			return { type: 'pushNameUpdate', jid, newPushName: asString(data.new_push_name) }
		}

		case 'contact_update':
		case 'contact_updated': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			return jid ? { type: 'contactUpdate', jid } : null
		}

		case 'picture_update': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			return jid ? { type: 'pictureUpdate', jid } : null
		}

		// ── Presence ──
		case 'presence': {
			if (!isObject(data)) return null
			const from = asJidString(data.from)
			if (!from) return null
			return {
				type: 'presence',
				from,
				unavailable: asBoolOr(data.unavailable, false),
				lastSeen: asNumber(data.last_seen)
			}
		}

		case 'chat_presence': {
			if (!isObject(data)) return null
			const src = isObject(data.source) ? data.source : undefined
			if (!src) return null
			const chat = asJidString(src.chat)
			const sender = asJidString(src.sender)
			if (!chat || !sender) return null
			return { type: 'chatPresence', chatJid: chat, senderJid: sender, state: asString(data.state) ?? 'composing' }
		}

		// ── Groups ──
		case 'group_update':
			return adaptGroupUpdate(data, logger)

		// ── Chat state ──
		case 'archive_update': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			return jid ? { type: 'archiveUpdate', jid } : null
		}

		case 'pin_update': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			return jid ? { type: 'pinUpdate', jid, timestamp: asNumber(data.timestamp) } : null
		}

		case 'mute_update': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			return jid ? { type: 'muteUpdate', jid, timestamp: asNumber(data.timestamp) } : null
		}

		case 'star_update':
			return adaptStarUpdate(data)

		case 'mark_chat_as_read_update': {
			if (!isObject(data)) return null
			const jid = asJidString(data.jid)
			return jid ? { type: 'markChatAsReadUpdate', jid } : null
		}

		// ── Calls ──
		case 'incoming_call':
			return adaptIncomingCall(data, logger)

		// ── Acknowledged but no Baileys equivalent ──
		case 'self_push_name_updated':
		case 'history_sync':
		case 'offline_sync_completed':
		case 'offline_sync_preview':
		case 'device_list_update':
		case 'disappearing_mode_changed':
		case 'business_status_update':
		case 'newsletter_live_update':
		case 'contact_number_changed':
		case 'contact_sync_requested':
		case 'user_about_update':
		case 'delete_chat_update':
		case 'delete_message_for_me_update':
			return { type: 'noop', bridgeType: type }

		// ── Generic notification & raw node ──
		case 'notification': {
			if (!isObject(data)) return { type: 'noop', bridgeType: 'notification' }
			const attrs = isObject(data.attrs) ? (data.attrs as Record<string, string>) : {}
			return { type: 'notification', tag: asString(data.tag) ?? 'notification', attrs }
		}

		case 'raw_node': {
			// `BinaryNode` is shaped exactly like the bridge payload
			// (`{ tag, attrs, content }`), so we can pass through after a
			// minimal sanity check. Adapter guarantees `tag` is a string.
			if (!isObject(data) || typeof data.tag !== 'string') return null
			return { type: 'rawNode', node: data as never }
		}

		default:
			logger?.debug({ eventType: type }, 'unknown bridge event (no canonical mapping)')
			return null
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-event adapters
// ─────────────────────────────────────────────────────────────────────────────

const adaptMessage = (data: unknown, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const info = isObject(data.info) ? data.info : undefined
	const messageProto = isObject(data.message) ? data.message : undefined
	if (!info || !messageProto) return null

	const src = isObject(info.source) ? info.source : undefined
	const chat = src && asJidString(src.chat)
	const id = asString(info.id)
	if (!src || !chat || !id) {
		logger?.debug({ info }, 'message adapter: missing chat/id')
		return null
	}

	const isGroup = asBoolOr(src.is_group, false)
	const senderRaw = src.sender
	const senderJid = isGroup ? asJidString(senderRaw) : undefined
	const participantAlt = isGroup && isBridgeJid(src.sender_alt) ? bridgeJidToString(src.sender_alt) : undefined
	const remoteJidAlt = !isGroup && isBridgeJid(src.recipient_alt) ? bridgeJidToString(src.recipient_alt) : undefined

	return {
		type: 'message',
		chatJid: chat,
		senderJid,
		isGroup,
		isFromMe: asBoolOr(src.is_from_me, false),
		id,
		timestamp: toUnixSeconds(info.timestamp),
		pushName: asString(info.push_name),
		participantAlt,
		remoteJidAlt,
		messageProto: messageProto as never
	}
}

const adaptReceipt = (data: unknown, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const src = isObject(data.source) ? data.source : undefined
	if (!src) return null
	const chat = asJidString(src.chat)
	const ids = Array.isArray(data.message_ids) ? data.message_ids.filter((x): x is string => typeof x === 'string') : []
	if (!chat || ids.length === 0) {
		logger?.debug({ data }, 'receipt adapter: missing chat or message_ids')
		return null
	}
	const isGroup = asBoolOr(src.is_group, false)
	return {
		type: 'receipt',
		chatJid: chat,
		senderJid: isGroup ? asJidString(src.sender) : undefined,
		isGroup,
		isFromMe: asBoolOr(src.is_from_me, false),
		messageIds: ids,
		timestamp: toUnixSeconds(data.timestamp)
	}
}

const adaptStarUpdate = (data: unknown): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const chatJid = asJidString(data.chat_jid)
	const messageId = asString(data.message_id)
	if (!chatJid || !messageId) return null
	const action = isObject(data.action) ? (data.action as Record<string, unknown>) : undefined
	return {
		type: 'starUpdate',
		chatJid,
		messageId,
		fromMe: asBoolOr(data.from_me, false),
		participantJid: asJidString(data.participant_jid),
		starred: asBoolOr(action?.starred, false)
	}
}

const adaptIncomingCall = (data: unknown, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const from = asJidString(data.from)
	if (!from) return null

	const action = isObject(data.action) ? data.action : undefined
	if (!action) return null

	const actionType = parseCallActionType(action.type)
	const callId = asString(action.call_id)
	if (!actionType || !callId) {
		logger?.debug({ data }, 'incoming_call adapter: missing action.type/call_id')
		return null
	}

	const canonicalAction: CanonicalCallAction = { type: actionType, callId }
	if (actionType === 'offer') {
		canonicalAction.callerPn = asJidString(action.caller_pn)
		canonicalAction.isVideo = asBoolOr(action.is_video, false)
	}

	return {
		type: 'incomingCall',
		from,
		timestamp: toUnixSeconds(data.timestamp),
		offline: asBoolOr(data.offline, false),
		action: canonicalAction
	}
}

const parseCallActionType = (raw: unknown): CanonicalCallActionType | undefined => {
	const norm = normalizeDiscriminator(raw)
	switch (norm) {
		case 'offer':
			return 'offer'
		case 'pre_accept':
		case 'preaccept':
			return 'preAccept'
		case 'accept':
			return 'accept'
		case 'reject':
			return 'reject'
		case 'terminate':
			return 'terminate'
		default:
			return undefined
	}
}

// ── Group action adapter — the one that actually uncovered the PascalCase drift ──

const adaptGroupParticipant = (raw: unknown): CanonicalGroupParticipant | null => {
	if (!isObject(raw)) return null
	const jid = asJidString(raw.jid)
	if (!jid) return null
	return { jid, phoneNumber: asJidString(raw.phone_number) }
}

const adaptGroupParticipants = (raw: unknown): CanonicalGroupParticipant[] => {
	if (!Array.isArray(raw)) return []
	return raw.map(adaptGroupParticipant).filter((p): p is CanonicalGroupParticipant => p !== null)
}

const adaptGroupAction = (raw: unknown): CanonicalGroupAction | null => {
	if (!isObject(raw)) return null
	const norm = normalizeDiscriminator(raw.type)
	const rawType = asString(raw.type) ?? 'unknown'
	if (!norm) return { type: 'unknown', rawType }

	switch (norm) {
		case 'add':
			return { type: 'add', participants: adaptGroupParticipants(raw.participants), reason: asString(raw.reason) }
		case 'remove':
			return { type: 'remove', participants: adaptGroupParticipants(raw.participants), reason: asString(raw.reason) }
		case 'promote':
			return { type: 'promote', participants: adaptGroupParticipants(raw.participants) }
		case 'demote':
			return { type: 'demote', participants: adaptGroupParticipants(raw.participants) }
		case 'modify':
			return { type: 'modify', participants: adaptGroupParticipants(raw.participants) }
		case 'subject':
			return {
				type: 'subject',
				subject: asString(raw.subject) ?? '',
				subjectOwner: asJidString(raw.subject_owner),
				subjectTime: asNumber(raw.subject_time)
			}
		case 'description':
			return {
				type: 'description',
				id: asString(raw.id) ?? '',
				description: asString(raw.description)
			}
		case 'locked':
			return { type: 'locked' }
		case 'unlocked':
			return { type: 'unlocked' }
		case 'announce':
		case 'announcement':
			return { type: 'announce' }
		case 'not_announce':
		case 'not_announcement':
		case 'notannounce':
			return { type: 'notAnnounce' }
		case 'ephemeral': {
			const expiration = asNumber(raw.expiration)
			if (expiration == null) return null
			return { type: 'ephemeral', expiration, trigger: asNumber(raw.trigger) }
		}
		case 'membership_approval_mode':
		case 'membershipapprovalmode':
			return { type: 'membershipApprovalMode', enabled: asBoolOr(raw.enabled, false) }
		case 'member_add_mode':
		case 'memberaddmode':
			return { type: 'memberAddMode', mode: asString(raw.mode) ?? '' }
		case 'no_frequently_forwarded':
		case 'nofrequentlyforwarded':
			return { type: 'noFrequentlyForwarded' }
		case 'frequently_forwarded_ok':
		case 'frequentlyforwardedok':
			return { type: 'frequentlyForwardedOk' }
		case 'invite':
			return { type: 'invite', code: asString(raw.code) ?? '' }
		case 'revoke':
		case 'revoke_invite':
		case 'revokeinvite':
			return { type: 'revokeInvite' }
		case 'create':
			return { type: 'create' }
		case 'delete':
			return { type: 'delete', reason: asString(raw.reason) }
		case 'link':
			return { type: 'link', linkType: asString(raw.link_type) ?? '' }
		case 'unlink':
			return {
				type: 'unlink',
				unlinkType: asString(raw.unlink_type) ?? '',
				unlinkReason: asString(raw.unlink_reason)
			}
		case 'membership_approval_request':
		case 'created_membership_requests':
		case 'revoked_membership_requests':
			return { type: 'unknown', rawType: norm }
		default:
			return { type: 'unknown', rawType }
	}
}

const adaptGroupUpdate = (data: unknown, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const groupJid = asJidString(data.group_jid)
	if (!groupJid) return null
	const action = adaptGroupAction(data.action)
	if (!action) {
		logger?.warn({ data }, 'group_update adapter: action shape rejected')
		return null
	}
	return {
		type: 'groupUpdate',
		groupJid,
		author: asJidString(data.participant),
		authorPn: asJidString(data.participant_pn),
		timestamp: toUnixSeconds(data.timestamp),
		isLidAddressingMode: asBoolOr(data.is_lid_addressing_mode, false),
		action
	}
}
