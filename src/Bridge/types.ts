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
}

export interface CanonicalLoggedOut {
	type: 'loggedOut'
}

export interface CanonicalConnectFailure {
	type: 'connectFailure'
	message?: string
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
}

export interface CanonicalPictureUpdate {
	type: 'pictureUpdate'
	jid: string
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
	state: string
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
}

export interface CanonicalPinUpdate {
	type: 'pinUpdate'
	jid: string
	timestamp?: number
}

export interface CanonicalMuteUpdate {
	type: 'muteUpdate'
	jid: string
	timestamp?: number
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
}

// ── Calls ──

export type CanonicalCallActionType = 'offer' | 'preAccept' | 'accept' | 'reject' | 'terminate'

export interface CanonicalCallAction {
	type: CanonicalCallActionType
	callId: string
	/** Only populated when `type === 'offer'`. */
	callerPn?: string
	/** Only populated when `type === 'offer'`. */
	isVideo?: boolean
}

export interface CanonicalIncomingCall {
	type: 'incomingCall'
	from: string
	timestamp: number
	offline: boolean
	action: CanonicalCallAction
}

// ── Misc ──

export interface CanonicalUndecryptableMessage {
	type: 'undecryptableMessage'
	raw: unknown
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
	| CanonicalRawNode
	| CanonicalNotification
	| CanonicalNoop
