/**
 * Canonical event types — what baileyrs OWNS as its contract with the bridge.
 *
 * Adapters in this folder convert raw bridge payloads into these shapes; all
 * downstream code consumes these instead of touching `WhatsAppEvent.data`
 * directly. This is the anti-corruption layer that keeps drift in the bridge
 * (renamed fields, leaked enum casing, ISO-vs-unix timestamps, etc.) from
 * leaking into our domain code.
 *
 * Naming conventions:
 *   - Discriminator (`type`) is camelCase — matches Baileys event names.
 *   - All JIDs are device-stripped strings (`user@server`).
 *   - All timestamps are unix seconds.
 *   - Optional fields use `?` (omitted) rather than `null`.
 */

import type { Chat, Contact, LIDMapping, WAMessage } from '../Types/index.ts'
import type { BinaryNode, WAProto } from '../Types/index.ts'

// ── Connection lifecycle ──

export interface CanonicalConnected {
	type: 'connected'
}

export interface CanonicalDisconnected {
	type: 'disconnected'
}

/** `qr` and `pairing_code` collapse here — both surface a code to display. */
export interface CanonicalQR {
	type: 'qr'
	code: string
}

export interface CanonicalPairSuccess {
	type: 'pairSuccess'
	id: string
	lid?: string
	platform?: string
	businessName?: string
}

export interface CanonicalPairError {
	type: 'pairError'
	error: string
	/** Account JID after pairing (may be set even on error). */
	id?: string
	/** LID for the account. */
	lid?: string
	/** Business display name when paired account is a Business profile. */
	businessName?: string
	/** Wire platform string (`'web'`, `'smbi'`, etc). */
	platform?: string
}

export interface CanonicalLoggedOut {
	type: 'loggedOut'
	/** `true` when the bridge surfaced the logout during initial connect. */
	onConnect?: boolean
	/** Server-supplied reason string (Debug formatted from the bridge enum). */
	reason?: string
}

/**
 * `reason` is the canonical signal — numeric wire code mapped to
 * `DisconnectReason` by the dispatcher. `message` is the optional
 * human-readable description for logs/diagnostics; consumers branching
 * on the failure should use `reason`, not parse `message`.
 */
export interface CanonicalConnectFailure {
	type: 'connectFailure'
	/** Optional human-facing description (logs only — DO NOT branch on this). */
	message?: string
	/**
	 * Canonical numeric wire code (the source of truth for branching):
	 *  400=Generic, 401=LoggedOut, 402=TempBanned, 403=MainDeviceGone,
	 *  405=ClientOutdated, 406=UnknownLogout, 409=BadUserAgent,
	 *  413=CatExpired, 414=CatInvalid, 415=NotFound, 418=ClientUnknown,
	 *  500=InternalServerError, 501=Experimental, 503=ServiceUnavailable.
	 *  The dispatcher maps this to the matching `DisconnectReason`.
	 */
	reason?: number
}

export interface CanonicalStreamError {
	type: 'streamError'
	code: string
}

export interface CanonicalStreamReplaced {
	type: 'streamReplaced'
}

export interface CanonicalClientOutdated {
	type: 'clientOutdated'
}

export interface CanonicalTemporaryBan {
	type: 'temporaryBan'
	/**
	 * Bridge `TempBanReason` numeric wire code:
	 *  101=SentToTooManyPeople, 102=BlockedByUsers,
	 *  103=CreatedTooManyGroups, 104=SentTooManySameMessage,
	 *  106=BroadcastList.
	 */
	code?: number
	/** Unix-seconds at which the ban lifts. */
	expire?: number
}

export interface CanonicalQrScannedWithoutMultidevice {
	type: 'qrScannedWithoutMultidevice'
}

// ── Messages ──

/**
 * A fully-resolved message ready to wrap into `WAProto.WebMessageInfo`.
 * `messageProto` carries the raw decrypted protobuf object; everything else
 * is metadata the bridge already extracted from the stanza.
 */
export interface CanonicalMessage {
	type: 'message'
	chatJid: string
	senderJid?: string
	isGroup: boolean
	isFromMe: boolean
	id: string
	timestamp: number
	pushName?: string
	/** LID counterpart of the sender for LID-addressed groups. */
	participantAlt?: string
	/** LID counterpart of the chat (1:1 only) when the recipient is LID. */
	remoteJidAlt?: string
	/** True when the underlying payload is a view-once message (wrapper or inline flag). */
	isViewOnce?: boolean
	/**
	 * `true` when delivered via offline catch-up. Drives the `messages.upsert`
	 * type slot ('append' vs 'notify') so consumers can branch on
	 * "live" vs "history replay".
	 */
	isOffline?: boolean
	/**
	 * PDO request id this message answers. Set when the bridge recovered
	 * the message via `requestPlaceholderResend` instead of normal decrypt.
	 * Surfaced on `messages.upsert.requestId` for upstream parity.
	 */
	unavailableRequestId?: string
	/**
	 * Bridge `EditAttribute` (raw stanza string). Restricted to the wire
	 * values the server emits so consumers can `switch` exhaustively.
	 *
	 *   "1" — sender-edit
	 *   "2" — sender-revoke
	 *   "3" — admin-revoke
	 *   "7" — pin
	 *   "8" — unpin
	 *   ""  — none (omitted at the canonical layer; never reaches here)
	 *
	 * Used to set `key.editAttribute` on the wrapped WAMessage so consumers
	 * can dedupe edits against the original message id.
	 */
	editAttribute?: '1' | '2' | '3' | '7' | '8'
	messageProto: WAProto.IMessage
}

// ── Receipts ──

export interface CanonicalReceipt {
	type: 'receipt'
	chatJid: string
	senderJid?: string
	isGroup: boolean
	isFromMe: boolean
	messageIds: string[]
	timestamp: number
	/**
	 * Bridge `ReceiptType` discriminator (already normalized to the
	 * variant string — no `data` payload preserved). Drives the
	 * `readTimestamp` / `playedTimestamp` slot in the emitted update.
	 */
	receiptType?:
		| 'delivered'
		| 'sender'
		| 'retry'
		| 'enc-rekey-retry'
		| 'read'
		| 'read-self'
		| 'played'
		| 'played-self'
		| 'inactive'
		| 'peer-msg'
		| 'history-sync'
		| 'server-error'
		| 'other'
}

// ── Contacts ──

export interface CanonicalPushNameUpdate {
	type: 'pushNameUpdate'
	jid: string
	newPushName?: string
}

export interface CanonicalContactUpdate {
	type: 'contactUpdate'
	jid: string
	/** ContactAction.fullName — the user-set display name. */
	fullName?: string
	/** ContactAction.firstName — separate slot used by some clients. */
	firstName?: string
	/** Resolved LID counterpart of `jid` (when `jid` is a PN). */
	lidJid?: string
	/** Resolved PN counterpart of `jid` (when `jid` is a LID). */
	pnJid?: string
	/** ContactAction.username — meta username if the contact has set one. */
	username?: string
}

export interface CanonicalPictureUpdate {
	type: 'pictureUpdate'
	jid: string
	/** `true` when the user removed the avatar; consumers map this to `imgUrl: null`. */
	removed: boolean
	/** Admin who changed the picture (group-only). */
	author?: string
	/** Server-assigned picture id; absent on removal. */
	pictureId?: string
}

// ── Presence ──

export interface CanonicalPresence {
	type: 'presence'
	from: string
	unavailable: boolean
	lastSeen?: number
}

export interface CanonicalChatPresence {
	type: 'chatPresence'
	chatJid: string
	senderJid: string
	/**
	 * Bridge `ChatPresence` discriminator — `'composing' | 'paused'`.
	 * Combine with `media` to derive upstream's `WAPresence`:
	 * `composing + audio → recording`, `composing + (absent) → composing`,
	 * `paused → paused`.
	 */
	state: string
	/**
	 * `'audio'` when the user is recording a voice note. Absent (not the
	 * empty string) when no media — adapter normalizes the bridge's `''`
	 * away so consumers can rely on field omission as the "no media" signal.
	 */
	media?: 'audio'
}

// ── Groups ──

/** Participant info as carried inside an event-time group action. */
export interface CanonicalGroupParticipant {
	jid: string
	phoneNumber?: string
}

export type CanonicalGroupAction =
	| { type: 'add'; participants: CanonicalGroupParticipant[]; reason?: string }
	| { type: 'remove'; participants: CanonicalGroupParticipant[]; reason?: string }
	| { type: 'promote'; participants: CanonicalGroupParticipant[] }
	| { type: 'demote'; participants: CanonicalGroupParticipant[] }
	| { type: 'modify'; participants: CanonicalGroupParticipant[] }
	| { type: 'subject'; subject: string; subjectOwner?: string; subjectTime?: number }
	| { type: 'description'; id: string; description?: string }
	| { type: 'locked' }
	| { type: 'unlocked' }
	| { type: 'announce' }
	| { type: 'notAnnounce' }
	| { type: 'ephemeral'; expiration: number; trigger?: number }
	| { type: 'membershipApprovalMode'; enabled: boolean }
	| { type: 'memberAddMode'; mode: string }
	| { type: 'noFrequentlyForwarded' }
	| { type: 'frequentlyForwardedOk' }
	| { type: 'invite'; code: string }
	| { type: 'revokeInvite' }
	| { type: 'create' }
	| { type: 'delete'; reason?: string }
	| { type: 'link'; linkType: string }
	| { type: 'unlink'; unlinkType: string; unlinkReason?: string }
	/**
	 * Anti-spam: server temporarily restricted new joins until `expiration`.
	 * `lockType` is the server's category (e.g. `'inviter_blocklisted'`).
	 */
	| { type: 'growthLocked'; expiration: number; lockType: string }
	/** Server lifted a growth lock. */
	| { type: 'growthUnlocked' }
	/**
	 * Single join-request created by a user. `requestMethod` carries
	 * `invite_link` / `linked_group_join` / `non_admin_add`.
	 * `parentGroupJid` is set when the request fanned out from a parent
	 * community.
	 */
	| {
			type: 'membershipApprovalRequest'
			requestMethod?: string
			parentGroupJid?: string
	  }
	/** Batched join-requests (typically from a community linked-group fanout). */
	| {
			type: 'createdMembershipRequests'
			requestMethod?: string
			parentGroupJid?: string
			requests: CanonicalGroupParticipant[]
	  }
	/** Admin revoked one or more pending requests. */
	| {
			type: 'revokedMembershipRequests'
			participants: CanonicalGroupParticipant[]
	  }
	/** Catch-all for action types the adapter doesn't recognize yet. */
	| { type: 'unknown'; rawType: string }

export interface CanonicalGroupUpdate {
	type: 'groupUpdate'
	groupJid: string
	author?: string
	authorPn?: string
	timestamp: number
	isLidAddressingMode: boolean
	action: CanonicalGroupAction
}

// ── Chat state ──

export interface CanonicalArchiveUpdate {
	type: 'archiveUpdate'
	jid: string
	/** `false` when the user unarchived. Drives `chats.update.archived: false`. */
	archived: boolean
}

export interface CanonicalPinUpdate {
	type: 'pinUpdate'
	jid: string
	timestamp?: number
	/** `false` when the user unpinned. Drives `chats.update.pinned: undefined`. */
	pinned: boolean
}

export interface CanonicalMuteUpdate {
	type: 'muteUpdate'
	jid: string
	/** Notification timestamp (when the mute action was synced). */
	timestamp?: number
	/** `false` when the user unmuted. Drives `chats.update.muteEndTime: null`. */
	muted: boolean
	/**
	 * Unix-seconds the mute should expire at. Absent for unmute and for
	 * indefinite mute. WhatsApp uses 0 as the "muted forever" sentinel —
	 * preserved as 0 so consumers can branch on it.
	 */
	muteEndTimestamp?: number
}

export interface CanonicalStarUpdate {
	type: 'starUpdate'
	chatJid: string
	messageId: string
	fromMe: boolean
	participantJid?: string
	starred: boolean
}

export interface CanonicalMarkChatAsReadUpdate {
	type: 'markChatAsReadUpdate'
	jid: string
	/** `false` when the user marked the chat as unread. */
	read: boolean
}

// ── Calls ──

export type CanonicalCallActionType = 'offer' | 'preAccept' | 'accept' | 'reject' | 'terminate'

export interface CanonicalCallAction {
	type: CanonicalCallActionType
	callId: string
	/** Caller's phone number — present on `offer`. */
	callerPn?: string
	/** Caller's ISO country code from the bridge's offer payload. */
	callerCountryCode?: string
	/** Device class string (e.g. `"web"`, `"mobile"`). Offer-only. */
	deviceClass?: string
	/** `true` for group call invites the recipient can join late. Offer-only. */
	joinable?: boolean
	/** Audio codec list advertised on the offer. Offer-only. */
	audio?: string[]
	/** `true` for video calls. Offer-only. */
	isVideo?: boolean
	/** Total call duration in seconds. Terminate-only. */
	duration?: number
	/** Active audio duration in seconds. Terminate-only. */
	audioDuration?: number
}

export interface CanonicalIncomingCall {
	type: 'incomingCall'
	from: string
	timestamp: number
	offline: boolean
	/** Stanza-level `id` (distinct from `action.callId`). */
	stanzaId?: string
	/** WhatsApp `notify` push name on the offer. */
	notify?: string
	/** Platform string (e.g. `"web"`, `"smbi"`). */
	platform?: string
	/** WhatsApp client version on the caller side. */
	version?: string
	action: CanonicalCallAction
}

// ── Misc ──

export interface CanonicalUndecryptableMessage {
	type: 'undecryptableMessage'
	chatJid: string
	senderJid?: string
	id: string
	timestamp: number
	isFromMe: boolean
	isGroup: boolean
	pushName?: string
	participantAlt?: string
	remoteJidAlt?: string
	/** Bridge `is_unavailable` flag — true when the message was placeholder-replaced. */
	isUnavailable: boolean
	/** Bridge `unavailable_type`: "view_once" | "unknown". */
	unavailableType?: string
	/** Bridge `decrypt_fail_mode`: "show" | "hide". */
	decryptFailMode?: string
	/** Original raw payload, preserved for debug logging. */
	raw: unknown
}

/**
 * Newsletter (channel) live update. The bridge folds reaction-count
 * deltas for one or more messages of a single newsletter into one
 * event; the dispatcher fans them out into upstream's per-reaction
 * `newsletter.reaction` events.
 */
export interface CanonicalNewsletterLiveUpdate {
	type: 'newsletterLiveUpdate'
	newsletterJid: string
	messages: { serverId: string; reactions: { code: string; count: number }[] }[]
}

/**
 * One or more LID↔PN mappings learned from a server-side event. Today
 * sourced from `contact_number_changed` (carries up to two pairs:
 * `old_lid↔old_jid`, `new_lid↔new_jid`). The dispatcher fans these out
 * onto upstream's `lid-mapping.update` channel, one event per pair —
 * matches `messages-recv.ts:287` semantics.
 */
export interface CanonicalLidMappingUpdate {
	type: 'lidMappingUpdate'
	mappings: { lid: string; pn: string }[]
}

/** A chat was deleted from the user's app-state index. */
export interface CanonicalChatDelete {
	type: 'chatDelete'
	jid: string
}

/** "Delete for me" of a single message via app-state sync. */
export interface CanonicalMessageDelete {
	type: 'messageDelete'
	chatJid: string
	messageId: string
	fromMe: boolean
	participantJid?: string
}

/** Per-chat ephemeral (disappearing) mode change. */
export interface CanonicalDisappearingModeChanged {
	type: 'disappearingModeChanged'
	jid: string
	/** Duration in seconds. 0 = disabled. */
	duration: number
	/** Unix-seconds the user changed the setting at. */
	settingTimestamp?: number
}

export interface CanonicalHistorySync {
	type: 'historySync'
	chats: Chat[]
	contacts: Contact[]
	messages: WAMessage[]
	lidPnMappings: LIDMapping[]
	/** `proto.HistorySync.HistorySyncType` numeric. */
	syncType?: number
	/** Progress 0-100, when the bridge passed it through. */
	progress?: number
	/** Multi-chunk ordering — present when sync arrives in chunks. */
	chunkOrder?: number
	/** PDO session id, set on `ON_DEMAND` syncs answering a `fetchMessageHistory`. */
	peerDataRequestSessionId?: string
}

export interface CanonicalRawNode {
	type: 'rawNode'
	node: BinaryNode
}

/**
 * Generic `<notification>` carrier (the catch-all `Event::Notification`).
 * Mostly used for raw-tag dispatch (CB:* hooks) — the typed events above
 * already cover the well-known stanza variants.
 */
export interface CanonicalNotification {
	type: 'notification'
	tag: string
	attrs: Record<string, string>
}

/**
 * Server-pushed MEX (GraphQL) update routed by textual `op_name`.
 * Examples: `NotificationUserReachoutTimelockUpdate`, `MessageCappingInfoNotification`,
 * `NotificationGroupPropertyUpdate`. The op_name is stable across WA Web
 * bundle releases (numeric query ids rotate). Payload shape varies per
 * op_name — consumers in `Socket/events.ts` switch on it.
 */
export interface CanonicalMexNotification {
	type: 'mexNotification'
	opName: string
	from?: string
	stanzaId?: string
	offline: boolean
	payload: Record<string, unknown>
}

/**
 * Bridge events we acknowledge but don't translate to a Baileys event.
 * Keeping them in the canonical union makes the events.ts switch
 * exhaustive — adding a new `noop` variant requires a deliberate edit.
 */
export interface CanonicalNoop {
	type: 'noop'
	bridgeType: string
	/** Optional context for logging only. */
	detail?: string
}

// ── Union ──

export type CanonicalEvent =
	| CanonicalConnected
	| CanonicalDisconnected
	| CanonicalQR
	| CanonicalPairSuccess
	| CanonicalPairError
	| CanonicalLoggedOut
	| CanonicalConnectFailure
	| CanonicalStreamError
	| CanonicalStreamReplaced
	| CanonicalClientOutdated
	| CanonicalTemporaryBan
	| CanonicalQrScannedWithoutMultidevice
	| CanonicalMessage
	| CanonicalReceipt
	| CanonicalPushNameUpdate
	| CanonicalContactUpdate
	| CanonicalPictureUpdate
	| CanonicalPresence
	| CanonicalChatPresence
	| CanonicalGroupUpdate
	| CanonicalArchiveUpdate
	| CanonicalPinUpdate
	| CanonicalMuteUpdate
	| CanonicalStarUpdate
	| CanonicalMarkChatAsReadUpdate
	| CanonicalIncomingCall
	| CanonicalUndecryptableMessage
	| CanonicalLidMappingUpdate
	| CanonicalNewsletterLiveUpdate
	| CanonicalChatDelete
	| CanonicalMessageDelete
	| CanonicalDisappearingModeChanged
	| CanonicalHistorySync
	| CanonicalRawNode
	| CanonicalNotification
	| CanonicalMexNotification
	| CanonicalNoop
