/**
 * Schema-driven bridge → canonical adapter table.
 *
 * The single source of truth for "every bridge event variant we accept and
 * how it maps to a CanonicalEvent". Each entry receives the bridge's typed
 * data slot (`Extract<WhatsAppEvent, { type: T }>['data']`) and returns
 * either a CanonicalEvent or `null` (drop on unrecoverable shape).
 *
 * Type safety properties:
 *   1. The table is `satisfies AdapterMap` where `AdapterMap` is keyed by
 *      every `WhatsAppEvent['type']`. Adding a new variant to the bridge
 *      `.d.ts` and forgetting an entry here is a compile error.
 *   2. Each entry's `data` parameter is the bridge's narrow type — fields
 *      come back as the right TS type without manual `unknown` checks.
 *   3. Each entry's return type is `CanonicalEvent | null`. Returning the
 *      wrong canonical shape is a compile error.
 *
 * Where the bridge `.d.ts` references a sub-type that isn't separately
 * exported (PinAction, MuteAction, ArchiveChatAction, etc. — the action
 * field of every sync-action event), TS resolves the type to `any`. We
 * apply narrowing parsers from `./primitives` (`isObject`, `asBoolOr`,
 * `asNumber`, `asString`) at those leak points only — not boilerplate
 * everywhere.
 */

import type { MessageWireInfo, WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge'
import type { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { ILogger } from '../Utils/logger.ts'
import { processHistoryMessage } from '../Utils/process-history-message.ts'
import { isJidGroup } from '../WABinary/jid-utils.ts'
import type {
	CanonicalCallAction,
	CanonicalCallActionType,
	CanonicalEvent,
	CanonicalGroupAction,
	CanonicalGroupParticipant,
	CanonicalMessage,
	CanonicalReceipt
} from './types.ts'
import {
	absoluteFromDuration,
	asBool,
	asBoolOr,
	asStringArray,
	asDurationSeconds,
	asInt64,
	asJidAddressString,
	asJidString,
	asNumber,
	asString,
	asUnixSeconds,
	isObject,
	normalizeDiscriminator
} from './primitives.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Type plumbing
// ─────────────────────────────────────────────────────────────────────────────

export type BridgeEventType = WhatsAppEvent['type']
type BridgeData<T extends BridgeEventType> = Extract<WhatsAppEvent, { type: T }>['data']

/**
 * Adapter contract — maps a typed bridge data slot to a CanonicalEvent or
 * `null` when the payload is unrecoverable. `logger` is optional and used
 * for diagnostic warnings only.
 */
type AdapterFn<T extends BridgeEventType> = (data: BridgeData<T>, logger?: ILogger) => CanonicalEvent | null

/** Mapped type that forces every bridge event variant to have an entry. */
type AdapterMap = { [K in BridgeEventType]: AdapterFn<K> }

/**
 * Bridge sync-action events (`pin_update`, `mute_update`, etc.) carry the
 * proto action under `data.action`, but the bridge `.d.ts` types it as
 * the unexported `PinAction` / `MuteAction` (resolves to `any`). Narrow
 * once at the call site.
 */
// Tolerates a missing `data` slot: the adapter table has to be total against
// whatever the runtime sends, and an entry that reads the action before any
// other guard would otherwise throw rather than drop (`bridge:adapt-total`).
const extractAction = (data: { action?: unknown } | undefined): Record<string, unknown> | undefined =>
	isObject(data?.action) ? data.action : undefined

/** A group JID is authoritative when an older producer leaves `is_group` false. */
const resolveIsGroup = (wireValue: unknown, chatJid: string): boolean =>
	asBoolOr(wireValue, false) || isJidGroup(chatJid) === true

const resolveParticipantAlt = (senderAlt: string | undefined, isGroup: boolean): string | undefined =>
	isGroup ? senderAlt : undefined

const resolveRemoteJidAlt = (
	senderAlt: string | undefined,
	recipientAlt: string | undefined,
	isGroup: boolean,
	isFromMe: boolean
): string | undefined => (isGroup ? undefined : isFromMe ? recipientAlt : senderAlt)

/**
 * Rejection diagnostic for a required timestamp that is missing or
 * unparseable. Metadata only — never the payload: these objects can carry
 * message bodies and JIDs.
 */
const invalidTimestampDetail = (event: string, raw: unknown): Record<string, unknown> => ({
	event,
	field: 'timestamp',
	reason: raw === undefined || raw === null ? 'missing' : 'invalid',
	receivedType: typeof raw
})

const parseEditAttribute = (value: unknown): CanonicalMessage['editAttribute'] => {
	switch (value) {
		case '1':
		case '2':
		case '3':
		case '7':
		case '8':
			return value
		default:
			return undefined
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-event adapters — the bulk of the file. One entry per WhatsAppEvent variant.
// ─────────────────────────────────────────────────────────────────────────────

const ADAPTERS = {
	// ── Connection lifecycle ──
	connected: () => ({ type: 'connected' }),
	disconnected: () => ({ type: 'disconnected' }),
	stream_replaced: () => ({ type: 'streamReplaced' }),
	client_outdated: () => ({ type: 'clientOutdated' }),
	temporary_ban: data => ({
		type: 'temporaryBan',
		code: asNumber(data?.code),
		// The wire sends how long the ban lasts, and WA Web renders it that way
		// ("you'll be able to use WhatsApp again in {duration}"). The canonical
		// event promises the instant it lifts, which is what the socket formats
		// and what a reconnect delay subtracts `Date.now()` from — so the
		// conversion happens here, once, rather than in each of them.
		expire: absoluteFromDuration(asDurationSeconds(data?.expire))
	}),
	qr_scanned_without_multidevice: () => ({ type: 'qrScannedWithoutMultidevice' }),
	logged_out: data => ({
		type: 'loggedOut',
		onConnect: asBoolOr(data?.on_connect, false),
		reason: asString(data?.reason)
	}),

	qr: data => (data?.code ? { type: 'qr', code: data?.code } : null),
	pairing_code: data => (data?.code ? { type: 'qr', code: data?.code } : null),
	pairing_code_refresh: data => ({
		type: 'noop',
		bridgeType: 'pairing_code_refresh',
		detail: data?.force_manual ? 'force_manual' : 'automatic'
	}),
	pair_passkey_request: () => ({ type: 'noop', bridgeType: 'pair_passkey_request' }),
	pair_passkey_confirmation: data => ({
		type: 'noop',
		bridgeType: 'pair_passkey_confirmation',
		detail: data?.skip_handoff_ux ? 'handoff_verified' : 'confirmation_required'
	}),
	pair_passkey_error: data => ({
		type: 'noop',
		bridgeType: 'pair_passkey_error',
		detail: asString(data?.error)
	}),

	pair_success: data => {
		// `id` and `lid` come typed as `Jid` in the bridge .d.ts, but the
		// bridge actually serializes pair_success.{id,lid} as strings (see
		// the wire log) — accept both shapes.
		const id = typeof data?.id === 'string' ? data?.id : asJidString(data?.id)
		if (!id) return null
		return {
			type: 'pairSuccess',
			id,
			lid: typeof data?.lid === 'string' ? data?.lid : asJidString(data?.lid),
			platform: asString(data?.platform),
			businessName: asString(data?.business_name)
		}
	},

	pair_error: data => ({
		type: 'pairError',
		error: asString(data?.error) ?? 'Unknown pairing error',
		id: typeof data?.id === 'string' ? data?.id : asJidString(data?.id),
		lid: typeof data?.lid === 'string' ? data?.lid : asJidString(data?.lid),
		businessName: asString(data?.business_name),
		platform: asString(data?.platform)
	}),

	connect_failure: data =>
		isObject(data)
			? { type: 'connectFailure', message: asString(data?.message), reason: asNumber(data?.reason) }
			: { type: 'connectFailure' },

	stream_error: data => ({ type: 'streamError', code: asString(data?.code) ?? 'unknown' }),

	// ── Messages ──
	message: (data, logger) => adaptMessage(data, logger),
	receipt: (data, logger) => adaptReceipt(data, logger),
	// Upstream consumes message ACKs internally through
	// `CB:ack,class:message`: successful ACKs stay off the public event bus,
	// while NACKs become `messages.update` with status ERROR. Preserve every
	// typed field here so the dispatcher can reproduce both surfaces.
	server_ack: data => {
		const id = asString(data?.id)
		if (!id) return null
		return {
			type: 'serverAck',
			id,
			class: asString(data?.class),
			from: asJidString(data?.from),
			timestamp: asUnixSeconds(data?.timestamp),
			error: asString(data?.error)
		}
	},
	undecryptable_message: (data, logger) => {
		// Bridge ships `{ info: MessageInfo, is_unavailable, unavailable_type,
		// decrypt_fail_mode }` — same MessageInfo shape as the regular
		// `message` event. Extract the chat / sender / id so the dispatcher
		// can synthesize a CIPHERTEXT stub matching upstream
		// `messages-recv.ts:1352`.
		if (!isObject(data)) return null
		const info = isObject(data?.info) ? data?.info : undefined
		if (!info) return null
		const src = isObject(info.source) ? info.source : undefined
		const chat = src && asJidString(src.chat)
		const id = asString(info.id)
		if (!src || !chat || !id) return null
		const isGroup = resolveIsGroup(src.is_group, chat)
		const isFromMe = asBoolOr(src.is_from_me, false)
		const senderAlt = asJidString(src.sender_alt)
		const recipientAlt = asJidString(src.recipient_alt)
		const timestamp = asUnixSeconds(info.timestamp)
		if (timestamp === undefined) {
			logger?.debug(
				invalidTimestampDetail('undecryptable_message', info.timestamp),
				'undecryptable_message adapter: missing or invalid timestamp'
			)
			return null
		}
		return {
			type: 'undecryptableMessage',
			chatJid: chat,
			senderJid: isGroup ? asJidString(src.sender) : undefined,
			id,
			timestamp,
			isFromMe,
			isGroup,
			pushName: asString(info.push_name),
			participantAlt: resolveParticipantAlt(senderAlt, isGroup),
			remoteJidAlt: resolveRemoteJidAlt(senderAlt, recipientAlt, isGroup, isFromMe),
			isUnavailable: asBoolOr(data?.is_unavailable, false),
			unavailableType: asString(data?.unavailable_type),
			decryptFailMode: asString(data?.decrypt_fail_mode),
			raw: data
		}
	},

	// ── Contacts ──
	contact_update: data => adaptContactUpdate(data),
	contact_updated: data => adaptContactUpdate(data),

	picture_update: data => {
		const jid = asJidString(data?.jid)
		if (!jid) return null
		return {
			type: 'pictureUpdate',
			jid,
			removed: asBoolOr(data?.removed, false),
			author: asJidString(data?.author),
			pictureId: asString(data?.picture_id)
		}
	},

	// ── Presence ──
	presence: data => {
		const from = asJidString(data?.from)
		if (!from) return null
		return {
			type: 'presence',
			from,
			unavailable: asBoolOr(data?.unavailable, false),
			lastSeen: asUnixSeconds(data?.last_seen)
		}
	},

	chat_presence: data => {
		const src = isObject(data?.source) ? data?.source : undefined
		if (!src) return null
		const chat = asJidString(src.chat)
		const sender = asJidString(src.sender)
		if (!chat || !sender) return null
		// Bridge sends `media: ''` for "no media" — normalize to undefined
		// so consumers can rely on field omission as the absence signal.
		const media = asString(data?.media)
		// Bridge `state` MUST be one of the two canonical values; defaulting
		// to 'composing' on an unknown/missing value would synthesize a
		// false typing indicator. Drop the event instead.
		const rawState = asString(data?.state)
		if (rawState !== 'composing' && rawState !== 'paused') return null
		return {
			type: 'chatPresence',
			chatJid: chat,
			senderJid: sender,
			state: rawState,
			media: media === 'audio' ? 'audio' : undefined
		}
	},

	// ── Groups ──
	group_update: (data, logger) => adaptGroupUpdate(data, logger),

	// ── Chat state ──
	archive_update: data => {
		const jid = asJidString(data?.jid)
		if (!jid) return null
		return { type: 'archiveUpdate', jid, archived: asBoolOr(extractAction(data)?.archived, true) }
	},
	pin_update: data => {
		const jid = asJidString(data?.jid)
		if (!jid) return null
		return {
			type: 'pinUpdate',
			jid,
			timestamp: asUnixSeconds(data?.timestamp),
			pinned: asBoolOr(extractAction(data)?.pinned, true)
		}
	},
	mute_update: data => {
		const jid = asJidString(data?.jid)
		if (!jid) return null
		const action = extractAction(data)
		return {
			type: 'muteUpdate',
			jid,
			timestamp: asUnixSeconds(data?.timestamp),
			muted: asBoolOr(action?.muted, true),
			muteEndTimestamp: asInt64(action?.muteEndTimestamp) ?? asInt64(action?.mute_end_timestamp)
		}
	},
	star_update: data => adaptStarUpdate(data),
	mark_chat_as_read_update: data => {
		const jid = asJidString(data?.jid)
		if (!jid) return null
		return { type: 'markChatAsReadUpdate', jid, read: asBoolOr(extractAction(data)?.read, true) }
	},
	label_edit_update: data => {
		const labelId = asString(data?.label_id)
		if (!labelId) return { type: 'noop', bridgeType: 'label_edit_update' }
		const action = extractAction(data)
		// `predefinedId` is proto `predefined_id` (a number); upstream `Label`
		// wants it as a string. Dual-read the spelling, then stringify.
		const predefined = asNumber(action?.predefinedId) ?? asNumber(action?.predefined_id)
		return {
			type: 'labelEdit',
			labelId,
			name: asString(action?.name) ?? '',
			color: asNumber(action?.color) ?? 0,
			deleted: asBoolOr(action?.deleted, false),
			predefinedId: predefined != null ? String(predefined) : undefined
		}
	},
	label_association_update: data => {
		const labelId = asString(data?.label_id)
		const chatJid = asJidString(data?.chat_jid)
		if (!labelId || !chatJid) return { type: 'noop', bridgeType: 'label_association_update' }
		// `action.labeled === true` → label added to the chat, else removed.
		return { type: 'labelAssociation', labelId, chatJid, labeled: asBoolOr(extractAction(data)?.labeled, true) }
	},

	/**
	 * The per-message half of `labels.association`, which used to have no path.
	 * Same canonical event as the chat one, told apart by carrying a message.
	 */
	message_label_association_update: data => {
		const labelId = asString(data?.label_id)
		const chatJid = asJidString(data?.chat_jid)
		const messageId = asString(data?.message_id)
		if (!labelId || !chatJid || !messageId) {
			return { type: 'noop', bridgeType: 'message_label_association_update' }
		}
		return {
			type: 'labelAssociation',
			labelId,
			chatJid,
			messageId,
			labeled: asBoolOr(extractAction(data)?.labeled, true)
		}
	},

	/**
	 * What a degraded app-state sync left behind. The engine announces the
	 * connection anyway, so without this a consumer is told a session with no
	 * push name is healthy and has nothing to read that says otherwise.
	 */
	app_state_sync_failed: data => ({
		type: 'appStateSyncFailed',
		fatal: asStringArray(data?.fatal),
		retryable: asStringArray(data?.retryable),
		skipped: asStringArray(data?.skipped),
		connected: asBoolOr(data?.connected, false)
	}),

	/**
	 * The QR refs ran out. Upstream ends the socket with `timedOut` when its own
	 * QR timer gives up (`Socket/socket.ts`), which is the same end state, so
	 * this becomes the same terminal close rather than a new signal to learn.
	 */
	pairing_qr_codes_exhausted: () => ({ type: 'qrCodesExhausted' }),

	/**
	 * Another linked device turned link previews on or off account-wide.
	 *
	 * Upstream carries this on `settings.update`, reached through app state
	 * (`Utils/chat-utils.ts` branches on `privacySettingDisableLinkPreviewsAction`
	 * and emits the action as the value). Same event, different pipe — so the
	 * value is the action itself, not the decoded flag.
	 *
	 * `previews_disabled` is that flag already decoded by the bridge, which is
	 * what fills the action in when the payload carried the flag alone. The
	 * bridge only emits this event when the wire carried the flag, so the last
	 * fallback is unreachable in practice and exists so the value always has
	 * the field upstream's consumers read.
	 */
	disable_link_previews_update: data => {
		const action = extractAction(data)
		return {
			type: 'settingUpdate',
			setting: 'disableLinkPreviews',
			value: {
				...action,
				isPreviewsDisabled: asBool(action?.isPreviewsDisabled) ?? asBoolOr(data?.previews_disabled, false)
			}
		}
	},

	/**
	 * A pair-code request failed, so any code the user was shown is spent.
	 *
	 * Same lifecycle as `pair_error`, which is why it adapts to the same
	 * canonical event: the socket lives on and the engine takes another
	 * request, so this must not read as a close, and the code on screen has to
	 * stop being offered. `pairError` is the handler that does both — a
	 * pairing code surfaces as `qr` (see `pairing_code` above), and `connecting`
	 * clears it while saying a fresh one can be asked for.
	 *
	 * `rejection` and `backoff` ride along for the log. Neither changes what a
	 * consumer does here, and the engine owns the retry — but a throttle the
	 * server named itself is the difference between a code that will come back
	 * and one that will not, and dropping it leaves that unexplained.
	 */
	pairing_code_error: data => ({
		type: 'pairError',
		error: asString(data?.error) ?? 'pairing code rejected',
		rejection: asNumber(data?.rejection),
		backoff: asNumber(data?.backoff)
	}),

	// Acknowledged with no Baileys equivalent: upstream has no channel for a
	// contact deletion (`contacts.update` only upserts), for quick replies, or
	// for a call placed on the phone.
	contact_removed: () => ({ type: 'noop', bridgeType: 'contact_removed' }),
	quick_reply_update: () => ({ type: 'noop', bridgeType: 'quick_reply_update' }),
	call_log_sync: () => ({ type: 'noop', bridgeType: 'call_log_sync' }),

	// ── Calls ──
	incoming_call: (data, logger) => adaptIncomingCall(data, logger),
	missed_call: (data, logger) => {
		const from = asJidString(data?.from)
		const callId = asString(data?.call_id)
		if (!from || !callId) return null
		const timestamp = asUnixSeconds(data?.timestamp)
		if (timestamp === undefined) {
			logger?.debug(
				invalidTimestampDetail('missed_call', data?.timestamp),
				'missed_call adapter: missing or invalid timestamp'
			)
			return null
		}
		return {
			type: 'incomingCall',
			from,
			timestamp,
			offline: data?.reason === 'offline',
			action: { type: 'timeout', callId }
		}
	},
	call_ended_elsewhere: (data, logger) => {
		const from = asJidString(data?.from)
		const callId = asString(data?.call_id)
		if (!from || !callId) return null
		const timestamp = asUnixSeconds(data?.timestamp)
		if (timestamp === undefined) {
			logger?.debug(
				invalidTimestampDetail('call_ended_elsewhere', data?.timestamp),
				'call_ended_elsewhere adapter: missing or invalid timestamp'
			)
			return null
		}
		return {
			type: 'incomingCall',
			from,
			timestamp,
			offline: false,
			action: { type: data?.outcome === 'accepted' ? 'accept' : 'reject', callId }
		}
	},

	// ── History sync — fully decoded by the bridge, normalized 1:1 with upstream ──
	history_sync: data => {
		// `data` is `proto.IHistorySync & { syncType, chunkOrder?, progress? }` —
		// the bridge serialized the whole proto via `to_js_value_camel`. Walk
		// it through the upstream-aligned `processHistoryMessage` to bucket
		// chats / contacts / messages / lidPnMappings, then forward the
		// metadata fields (the dispatcher folds in `isLatest` /
		// `peerDataRequestSessionId`).
		if (!isObject(data)) return null
		const processed = processHistoryMessage(data as proto.IHistorySync)
		// Top-level metadata overlay wins over the proto's own `syncType` /
		// `progress` fields when both present — the bridge maintains the
		// authoritative copy across multi-chunk arrivals.
		const overlay = data as Record<string, unknown>
		const metaSyncType = asNumber(overlay.syncType)
		const metaChunkOrder = asNumber(overlay.chunkOrder)
		const metaProgress = asNumber(overlay.progress)
		const peerDataRequestSessionId = asString(overlay.peerDataRequestSessionId)
		// Batch markers (the bridge splits a chunk into bounded sub-batches).
		// Absent on a non-batched bridge → treat as a single final batch.
		const batchIndex = asNumber(overlay.batchIndex)
		const isFinalBatch = overlay.isFinalBatch !== false
		return {
			type: 'historySync',
			chats: processed.chats,
			contacts: processed.contacts,
			messages: processed.messages,
			lidPnMappings: processed.lidPnMappings,
			syncType: metaSyncType ?? processed.syncType ?? undefined,
			progress: metaProgress ?? processed.progress ?? undefined,
			pastParticipants: processed.pastParticipants,
			chunkOrder: metaChunkOrder,
			peerDataRequestSessionId,
			batchIndex,
			isFinalBatch
		}
	},

	// ── Acknowledged but no Baileys equivalent (noop) ──
	self_push_name_updated: () => ({ type: 'noop', bridgeType: 'self_push_name_updated' }),
	client_expiration_changed: () => ({ type: 'noop', bridgeType: 'client_expiration_changed' }),
	offline_sync_completed: data => ({
		type: 'offlineSyncCompleted',
		count: asNumber(data?.count) ?? 0
	}),
	offline_sync_preview: () => ({ type: 'noop', bridgeType: 'offline_sync_preview' }),
	// Counterpart of `offline_sync_completed`, not a variant: the drain ended
	// without its end marker, so the client is *not* caught up and the backlog
	// is redelivered on the next connection. Emitting `receivedPendingNotifications`
	// here would be a lie, so this stays a noop until the next preview/completion.
	offline_sync_interrupted: () => ({ type: 'noop', bridgeType: 'offline_sync_interrupted' }),
	dirty_state: data => {
		const dirtyType = asString(data?.dirty_type)
		if (!dirtyType) return null
		return { type: 'dirtyState', dirtyType, timestamp: asNumber(data?.timestamp) }
	},
	device_list_update: () => ({ type: 'noop', bridgeType: 'device_list_update' }),
	identity_change: () => ({ type: 'noop', bridgeType: 'identity_change' }),
	disappearing_mode_changed: data => {
		const jid = asJidString(data?.from)
		const duration = asNumber(data?.duration)
		if (!jid || duration == null) return { type: 'noop', bridgeType: 'disappearing_mode_changed' }
		return {
			type: 'disappearingModeChanged',
			jid,
			duration,
			settingTimestamp: asNumber(data?.setting_timestamp)
		}
	},
	business_status_update: () => ({ type: 'noop', bridgeType: 'business_status_update' }),
	newsletter_live_update: data => {
		const newsletterJid = asJidString(data?.newsletter_jid)
		if (!newsletterJid) return { type: 'noop', bridgeType: 'newsletter_live_update' }
		const rawMessages = Array.isArray(data?.messages) ? data?.messages : []
		const messages = rawMessages
			.map(m => {
				if (!isObject(m)) return null
				// Prefer the original string form — `server_id` is 64-bit and
				// `Number()` rounds at 2^53, so going through `asNumber` first
				// would silently corrupt newsletter ids past that boundary.
				const serverId = asString(m.server_id) ?? asNumber(m.server_id)?.toString()
				if (!serverId) return null
				const rawReactions = Array.isArray(m.reactions) ? m.reactions : []
				const reactions = rawReactions
					.map(r => {
						if (!isObject(r)) return null
						const code = asString(r.code)
						const count = asNumber(r.count)
						if (!code || count == null) return null
						return { code, count }
					})
					.filter((r): r is { code: string; count: number } => r !== null)
				return { serverId, reactions }
			})
			.filter((m): m is { serverId: string; reactions: { code: string; count: number }[] } => m !== null)
		return { type: 'newsletterLiveUpdate', newsletterJid, messages }
	},
	contact_number_changed: data => {
		// Bridge `ContactNumberChanged` carries up to two LID↔PN pairs:
		// (old_lid, old_jid) and (new_lid, new_jid). We learn whatever's
		// present and let the dispatcher fan out one upstream event per
		// pair. Mirrors upstream `messages-recv.ts:287`.
		const oldJid = asJidString(data?.old_jid)
		const newJid = asJidString(data?.new_jid)
		const oldLid = asJidString(data?.old_lid)
		const newLid = asJidString(data?.new_lid)
		const mappings: { lid: string; pn: string }[] = []
		if (oldLid && oldJid) mappings.push({ lid: oldLid, pn: oldJid })
		if (newLid && newJid) mappings.push({ lid: newLid, pn: newJid })
		if (mappings.length === 0) return { type: 'noop', bridgeType: 'contact_number_changed' }
		return { type: 'lidMappingUpdate', mappings }
	},
	contact_sync_requested: () => ({ type: 'noop', bridgeType: 'contact_sync_requested' }),
	user_about_update: () => ({ type: 'noop', bridgeType: 'user_about_update' }),
	delete_chat_update: data => {
		const jid = asJidString(data?.jid)
		return jid ? { type: 'chatDelete', jid } : { type: 'noop', bridgeType: 'delete_chat_update' }
	},
	clear_chat_update: data => {
		// Clear = drop all messages but keep the chat. Maps to upstream
		// `messages.delete` `{ jid, all: true }` (the chat-clear surface noted in
		// the messageDelete dispatcher), distinct from chatDelete (whole chat gone).
		const jid = asJidString(data?.jid)
		return jid ? { type: 'chatClear', jid } : { type: 'noop', bridgeType: 'clear_chat_update' }
	},
	// Muting a contact's status (stories) updates. Forwarded for surface completeness,
	// but noop'd: upstream Baileys has no status-mute event/chatModify to map it onto.
	user_status_mute_update: () => ({ type: 'noop', bridgeType: 'user_status_mute_update' }),
	delete_message_for_me_update: data => {
		const chatJid = asJidString(data?.chat_jid)
		const messageId = asString(data?.message_id)
		if (!chatJid || !messageId) return { type: 'noop', bridgeType: 'delete_message_for_me_update' }
		return {
			type: 'messageDelete',
			chatJid,
			messageId,
			fromMe: asBoolOr(data?.from_me, false),
			participantJid: asJidString(data?.participant_jid)
		}
	},

	// ── Generic notification / raw node ──
	notification: data => {
		if (!isObject(data)) return { type: 'noop', bridgeType: 'notification' }
		// Validate attrs values are actually strings — bridge serde might
		// emit numbers / nested objects on rare attrs (e.g. server bugs),
		// and the previous unchecked cast would smuggle non-strings into
		// CanonicalNotification.attrs (typed `Record<string, string>`).
		// Drop non-string values, coerce the rest.
		const attrs: Record<string, string> = {}
		if (isObject(data?.attrs)) {
			for (const [k, v] of Object.entries(data?.attrs)) {
				if (typeof v === 'string') attrs[k] = v
				else if (typeof v === 'number' || typeof v === 'boolean') attrs[k] = String(v)
				// Drop nested objects / null silently — they wouldn't make
				// sense on a flat attrs map anyway.
			}
		}
		return { type: 'notification', tag: asString(data?.tag) ?? 'notification', attrs }
	},

	raw_node: data => {
		// `BinaryNode` is shaped exactly like the bridge payload
		// (`{ tag, attrs, content }`). Minimal sanity check on `tag`.
		if (!isObject(data) || typeof data?.tag !== 'string') return null
		return { type: 'rawNode', node: data as never }
	},

	mex_notification: data => {
		const opName = asString(data?.op_name)
		if (!opName) return null
		const payload = isObject(data?.payload) ? (data?.payload as Record<string, unknown>) : {}
		return {
			type: 'mexNotification',
			opName,
			from: asJidString(data?.from),
			stanzaId: asString(data?.stanza_id),
			offline: asBoolOr(data?.offline, false),
			payload
		}
	}
} satisfies AdapterMap

/** Set of bridge event types we explicitly handle — derived from the table. */
export const KNOWN_BRIDGE_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(ADAPTERS))

/**
 * Public entry point — looks up the adapter by event type and runs it.
 * Mirrors the previous `adaptBridgeEvent` API exactly.
 */
export const adaptBridgeEventViaSchema = (event: WhatsAppEvent, logger?: ILogger): CanonicalEvent | null => {
	const typed = event as { type: BridgeEventType; data?: unknown }
	// An own property of the table, not anything the prototype chain answers.
	//
	// The type string comes from the runtime, which gets it from the server, so it
	// is untrusted input into a plain-object lookup. `ADAPTERS.constructor` and
	// `ADAPTERS.toString` resolve to inherited functions: they were called and
	// their return values handed on as canonical events — measured, `constructor`
	// produced an object and `toString` a string, neither of which is an event.
	// `__proto__` and `valueOf` reached the other failure mode and threw.
	if (!Object.hasOwn(ADAPTERS, typed.type)) {
		logger?.debug({ eventType: typed.type }, 'unknown bridge event (no canonical mapping)')
		return null
	}
	const adapter = (ADAPTERS as Record<string, AdapterFn<BridgeEventType>>)[typed.type]!
	// The slot is passed through exactly as it arrived, nullish included.
	//
	// The contract these adapters are documented under is "null on unrecoverable
	// shape mismatch, never a throw", and a throw here does not stay local: it
	// propagates into the socket's event dispatch and takes down the whole event
	// loop rather than the one event. 30 of the 58 declared types threw on an
	// event that arrived with no data — `data.code` on `undefined` — so every
	// adapter in the table now reads its slot optionally.
	//
	// Substituting an empty object here instead was tried and reverted: `{}` is a
	// perfectly good object, so it walks straight past the `isObject(data)` guard
	// that several adapters use to decide the payload is unrecoverable.
	// `history_sync` then built an empty final batch and the socket emitted a
	// spurious `messaging-history.set` where it had previously dropped the event.
	// Each adapter owns that decision; the dispatch must not pre-empt it.
	//
	// `data` cast here is the only `as` in the public path — the bridge
	// runtime is the source of truth that the type matches the discriminator.
	return adapter(typed.data as never, logger)
}

// ─────────────────────────────────────────────────────────────────────────────
// Heavy adapters — kept as named functions because the inline form would
// blow up the table. Each takes the bridge's typed data slot.
// ─────────────────────────────────────────────────────────────────────────────

const adaptMessage = (data: BridgeData<'message'>, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const info = isObject(data.info) ? data.info : undefined
	const messageProto = isObject(data.message) ? data.message : undefined
	if (!info || !messageProto) return null
	return adaptMessageParts(info, messageProto, logger)
}

/**
 * Adapt the protobuf-wire capability without manufacturing a synthetic bridge
 * event object. Both message transports converge on the same validated mapping
 * below, so metadata semantics cannot drift between the compatibility and hot
 * paths.
 */
export const adaptBridgeMessageWire = (
	messageProto: unknown,
	info: MessageWireInfo,
	logger?: ILogger
): CanonicalMessage | null => {
	if (!isObject(messageProto)) return null
	const chat = asString(info.chat)
	const id = asString(info.id)
	if (!chat || !id) {
		logger?.debug({ info }, 'message wire adapter: missing chat/id')
		return null
	}

	const isGroup = resolveIsGroup(info.isGroup, chat)
	const isFromMe = asBoolOr(info.isFromMe, false)
	const senderAlt = asString(info.senderAlt)
	const recipientAlt = asString(info.recipientAlt)
	// The packed envelope carries the timestamp as a numeric record, so the
	// only invalid shapes here are a missing or non-finite value. Like the
	// object route below, those drop the message rather than dating it at
	// the epoch.
	const timestamp = asNumber(info.timestamp)
	if (timestamp === undefined) {
		logger?.debug(
			invalidTimestampDetail('message_wire', info.timestamp),
			'message wire adapter: missing or invalid timestamp'
		)
		return null
	}
	return {
		type: 'message',
		chatJid: chat,
		senderJid: isGroup ? asString(info.sender) : undefined,
		isGroup,
		isFromMe,
		id,
		timestamp,
		pushName: asString(info.pushName),
		participantAlt: resolveParticipantAlt(senderAlt, isGroup),
		remoteJidAlt: resolveRemoteJidAlt(senderAlt, recipientAlt, isGroup, isFromMe),
		isViewOnce: info.isViewOnce === true ? true : undefined,
		isOffline: info.isOffline === true ? true : undefined,
		unavailableRequestId: asString(info.unavailableRequestId),
		editAttribute: parseEditAttribute(info.edit),
		messageProto: messageProto as never
	}
}

const adaptMessageParts = (
	info: Record<string, unknown>,
	messageProto: Record<string, unknown>,
	logger?: ILogger
): CanonicalMessage | null => {
	const src = isObject(info.source) ? info.source : undefined
	const chat = src && asJidString(src.chat)
	const id = asString(info.id)
	if (!src || !chat || !id) {
		logger?.debug({ info }, 'message adapter: missing chat/id')
		return null
	}

	const isGroup = resolveIsGroup(src.is_group, chat)
	const isFromMe = asBoolOr(src.is_from_me, false)
	const senderRaw = src.sender
	const senderJid = isGroup ? asJidString(senderRaw) : undefined
	const senderAlt = asJidString(src.sender_alt)
	const recipientAlt = asJidString(src.recipient_alt)
	const timestamp = asUnixSeconds(info.timestamp)
	if (timestamp === undefined) {
		logger?.debug(invalidTimestampDetail('message', info.timestamp), 'message adapter: missing or invalid timestamp')
		return null
	}
	return {
		type: 'message',
		chatJid: chat,
		senderJid,
		isGroup,
		isFromMe,
		id,
		timestamp,
		pushName: asString(info.push_name),
		participantAlt: resolveParticipantAlt(senderAlt, isGroup),
		remoteJidAlt: resolveRemoteJidAlt(senderAlt, recipientAlt, isGroup, isFromMe),
		isViewOnce: info.is_view_once === true ? true : undefined,
		isOffline: asBoolOr(info.is_offline, false) ? true : undefined,
		unavailableRequestId: asString(info.unavailable_request_id),
		editAttribute: parseEditAttribute(info.edit),
		messageProto: messageProto as never
	}
}

const adaptReceipt = (data: BridgeData<'receipt'>, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const src = isObject(data.source) ? data.source : undefined
	if (!src) return null
	const chat = asJidString(src.chat)
	const ids = Array.isArray(data.message_ids) ? data.message_ids.filter((x): x is string => typeof x === 'string') : []
	if (!chat || ids.length === 0) {
		logger?.debug({ data }, 'receipt adapter: missing chat or message_ids')
		return null
	}
	const isGroup = resolveIsGroup(src.is_group, chat)
	// A receipt without a trustworthy timestamp cannot be placed on any
	// timeline slot (`readTimestamp` / `playedTimestamp` /
	// `receiptTimestamp`), so the event is dropped rather than dated at the
	// epoch. Optional timestamps elsewhere stay absent via `asUnixSeconds`.
	const timestamp = asUnixSeconds(data.timestamp)
	if (timestamp === undefined) {
		logger?.debug(invalidTimestampDetail('receipt', data.timestamp), 'receipt adapter: missing or invalid timestamp')
		return null
	}
	const { receiptType, raw: receiptTypeRaw } = parseReceiptType(data.type)
	return {
		type: 'receipt',
		chatJid: chat,
		senderJid: isGroup ? asJidString(src.sender) : undefined,
		isGroup,
		isFromMe: asBoolOr(src.is_from_me, false),
		messageIds: ids,
		timestamp,
		receiptType,
		...(receiptTypeRaw !== undefined ? { receiptTypeRaw } : {})
	}
}

const adaptContactUpdate = (data: unknown): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const jid = asJidString(data.jid)
	if (!jid) return null
	const action = isObject(data.action) ? data.action : undefined
	return {
		type: 'contactUpdate',
		jid,
		fullName: asString(action?.fullName) ?? asString(action?.full_name),
		firstName: asString(action?.firstName) ?? asString(action?.first_name),
		lidJid: asString(action?.lidJid) ?? asString(action?.lid_jid),
		pnJid: asString(action?.pnJid) ?? asString(action?.pn_jid),
		username: asString(action?.username)
	}
}

/**
 * Bridge wire `ReceiptType` → canonical kebab-cased variant, preserving the
 * original value when it matches nothing known.
 *
 * The bridge's generated `.d.ts` advertises `ReceiptType` as
 * `{type: "delivered"} | …`, but `#[serde(from = "String")]` on the rust
 * enum disables the matching `Serialize` rename: the wire form is the
 * bare PascalCase variant name (`"Delivered"`, `"Read"`, `"PeerMsg"`).
 * Keep both spellings here so a future bridge bump that re-introduces
 * the snake_case wire form keeps working.
 *
 * Unrecognized wire values arrive wrapped as `{ Other: value }` (the packed
 * `ReceiptWireData.type` contract) or, defensively, as a future bare
 * string. Those map to `'other'` with the original value in `raw`. The
 * wrapper is trusted over spelling: `{ Other: 'Read' }` is `other`, not
 * `read` (see `parseReceiptType`).
 */
const RECEIPT_TYPE_MAP: Record<string, NonNullable<CanonicalReceipt['receiptType']>> = {
	Delivered: 'delivered',
	Sent: 'sent',
	Sender: 'sender',
	Retry: 'retry',
	EncRekeyRetry: 'enc-rekey-retry',
	Read: 'read',
	ReadSelf: 'read-self',
	Played: 'played',
	PlayedSelf: 'played-self',
	Inactive: 'inactive',
	PeerMsg: 'peer-msg',
	HistorySync: 'history-sync',
	ServerError: 'server-error',
	delivered: 'delivered',
	sent: 'sent',
	sender: 'sender',
	retry: 'retry',
	enc_rekey_retry: 'enc-rekey-retry',
	read: 'read',
	read_self: 'read-self',
	played: 'played',
	played_self: 'played-self',
	inactive: 'inactive',
	peer_msg: 'peer-msg',
	history_sync: 'history-sync',
	server_error: 'server-error'
}

const parseReceiptType = (raw: unknown): { receiptType: CanonicalReceipt['receiptType']; raw?: string } => {
	// The `Other` wrapper is authoritative: the packed codec round-trips
	// `{ Other: value }` verbatim and never synthesizes it for a known
	// variant, so even a payload whose spelling collides with a known
	// variant name (e.g. `{ Other: 'Read' }`) stays category `other` with
	// its exact payload preserved. Only bare strings and `{ type }` go
	// through the known-variant lookup.
	if (isObject(raw) && typeof raw.Other === 'string') return { receiptType: 'other', raw: raw.Other }
	const norm = typeof raw === 'string' ? raw : isObject(raw) && typeof raw.type === 'string' ? raw.type : undefined
	if (norm == null) return { receiptType: undefined }
	// Own-property lookup: the table is an ordinary object, so indexing an
	// unknown bare name like 'constructor' or '__proto__' would otherwise
	// return an inherited value instead of falling through to 'other'.
	const mapped = Object.hasOwn(RECEIPT_TYPE_MAP, norm) ? RECEIPT_TYPE_MAP[norm] : undefined
	return mapped ? { receiptType: mapped } : { receiptType: 'other', raw: norm }
}

const adaptStarUpdate = (data: BridgeData<'star_update'>): CanonicalEvent | null => {
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

const adaptIncomingCall = (data: BridgeData<'incoming_call'>, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const from = asJidString(data.from)
	if (!from) return null

	const action = isObject(data.action) ? data.action : undefined
	if (!action) return null

	// The bridge `CallAction` union narrows variant-specific fields only on the
	// matching variant, and its group-call variants (group updates, rekeys,
	// waiting rooms) carry no `call_id` at all. `parseCallActionType` admits
	// none of those, so a runtime read through the action's own shape is safe —
	// and is the cheapest way around TS's inability to follow our
	// string-normalized discriminator back into the bridge union.
	const fields = action as Record<string, unknown>

	const actionType = parseCallActionType(fields.type)
	const callId = asString(fields.call_id)
	if (!actionType || !callId) {
		logger?.debug({ data }, 'incoming_call adapter: missing action.type/call_id')
		return null
	}

	// The call offer is timeline-ordered by its timestamp downstream; an
	// unparseable one drops the event rather than dating it at the epoch.
	const timestamp = asUnixSeconds(data.timestamp)
	if (timestamp === undefined) {
		logger?.debug(
			invalidTimestampDetail('incoming_call', data.timestamp),
			'incoming_call adapter: missing or invalid timestamp'
		)
		return null
	}

	const canonicalAction: CanonicalCallAction = {
		type: actionType,
		callId,
		callCreator: asJidAddressString(fields.call_creator)
	}
	if (actionType === 'offer') {
		canonicalAction.callerPn = asJidString(fields.caller_pn)
		canonicalAction.callerCountryCode = asString(fields.caller_country_code)
		canonicalAction.deviceClass = asString(fields.device_class)
		canonicalAction.joinable = asBoolOr(fields.joinable, false)
		canonicalAction.isVideo = asBoolOr(fields.is_video, false)
		if (Array.isArray(fields.audio)) {
			canonicalAction.audio = fields.audio.filter((x): x is string => typeof x === 'string')
		}
	} else if (actionType === 'terminate') {
		canonicalAction.duration = asNumber(fields.duration)
		canonicalAction.audioDuration = asNumber(fields.audio_duration)
	}

	return {
		type: 'incomingCall',
		from: asJidAddressString(data.from) ?? from,
		timestamp,
		offline: asBoolOr(data.offline, false),
		stanzaId: asString(data.stanza_id),
		notify: asString(data.notify),
		platform: asString(data.platform),
		version: asString(data.version),
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
			return 'preaccept'
		case 'transport':
			return 'transport'
		case 'relay_latency':
		case 'relaylatency':
			return 'relaylatency'
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

// ── Group action adapter ──

const adaptGroupParticipant = (raw: unknown): CanonicalGroupParticipant | null => {
	if (!isObject(raw)) return null
	const jid = asJidString(raw.jid)
	if (!jid) return null
	const rawRole = asString(raw.type)
	const role = rawRole === 'participant' || rawRole === 'admin' || rawRole === 'superadmin' ? rawRole : undefined
	const participant: CanonicalGroupParticipant = { jid, phoneNumber: asJidString(raw.phone_number) }
	const lid = asJidString(raw.lid)
	const username = asString(raw.username)
	const displayName = asString(raw.display_name)
	const joinTime = asNumber(raw.join_time)
	if (lid) participant.lid = lid
	if (username) participant.username = username
	if (displayName) participant.displayName = displayName
	if (joinTime !== undefined) participant.joinTime = joinTime
	if (role) participant.role = role
	return participant
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
		case 'linked_group_promote':
			return { type: 'linkedGroupPromote', participants: adaptGroupParticipants(raw.participants) }
		case 'linked_group_demote':
			return { type: 'linkedGroupDemote', participants: adaptGroupParticipants(raw.participants) }
		case 'suspended':
			return { type: 'suspended' }
		case 'unsuspended':
			return { type: 'unsuspended' }
		case 'auto_add_disabled':
			return { type: 'autoAddDisabled' }
		case 'is_capi_hosted_group':
			return { type: 'capiHostedGroup' }
		case 'group_safety_check':
			return { type: 'groupSafetyCheck' }
		case 'limit_sharing_enabled':
			return { type: 'limitSharingEnabled', trigger: asNumber(raw.trigger) }
		case 'allow_admin_reports':
			return { type: 'allowAdminReports' }
		case 'not_allow_admin_reports':
			return { type: 'notAllowAdminReports' }
		case 'reports':
			return { type: 'reports' }
		case 'allow_non_admin_sub_group_creation':
			return { type: 'allowNonAdminSubGroupCreation' }
		case 'not_allow_non_admin_sub_group_creation':
			return { type: 'notAllowNonAdminSubGroupCreation' }
		case 'created_sub_group_suggestion':
			return { type: 'createdSubGroupSuggestion' }
		case 'revoked_sub_group_suggestions':
			return { type: 'revokedSubGroupSuggestions' }
		case 'change_number':
			return {
				type: 'changeNumber',
				newOwner: asJidString(raw.new_owner),
				subGroupSuggestions: Array.isArray(raw.sub_group_suggestions)
					? raw.sub_group_suggestions.map(asJidString).filter((jid): jid is string => jid !== undefined)
					: []
			}
		case 'growth_locked':
		case 'growthlocked': {
			const expiration = asNumber(raw.expiration)
			if (expiration == null) return null
			return { type: 'growthLocked', expiration, lockType: asString(raw.lock_type) ?? '' }
		}
		case 'growth_unlocked':
		case 'growthunlocked':
			return { type: 'growthUnlocked' }
		case 'membership_approval_request':
			return {
				type: 'membershipApprovalRequest',
				requestMethod: asString(raw.request_method),
				parentGroupJid: asJidString(raw.parent_group_jid)
			}
		case 'created_membership_requests':
			return {
				type: 'createdMembershipRequests',
				requestMethod: asString(raw.request_method),
				parentGroupJid: asJidString(raw.parent_group_jid),
				requests: adaptGroupParticipants(raw.requests)
			}
		case 'revoked_membership_requests':
			return {
				type: 'revokedMembershipRequests',
				// `revoked_membership_requests` ships bare Jids (not full
				// participant infos), so wrap each into the canonical
				// participant shape with no `phoneNumber`.
				participants: Array.isArray(raw.participants)
					? raw.participants
							.map(j => {
								const jid = asJidString(j)
								return jid ? { jid } : null
							})
							.filter((p): p is CanonicalGroupParticipant => p !== null)
					: []
			}
		default:
			return { type: 'unknown', rawType }
	}
}

const adaptGroupUpdate = (data: BridgeData<'group_update'>, logger?: ILogger): CanonicalEvent | null => {
	if (!isObject(data)) return null
	const groupJid = asJidString(data.group_jid)
	if (!groupJid) return null
	const action = adaptGroupAction(data.action)
	if (!action) {
		logger?.warn({ data }, 'group_update adapter: action shape rejected')
		return null
	}
	const timestamp = asUnixSeconds(data.timestamp)
	if (timestamp === undefined) {
		logger?.debug(
			invalidTimestampDetail('group_update', data.timestamp),
			'group_update adapter: missing or invalid timestamp'
		)
		return null
	}
	return {
		type: 'groupUpdate',
		groupJid,
		notificationId: asString(data.notification_id),
		actionIndex: asNumber(data.action_index) ?? 0,
		author: asJidString(data.participant),
		authorPn: asJidString(data.participant_pn),
		authorUsername: asString(data.participant_username),
		authorCountryCode: asString(data.participant_country_code),
		timestamp,
		isLidAddressingMode: asBoolOr(data.is_lid_addressing_mode, false),
		action
	}
}
