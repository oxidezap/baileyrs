/**
 * Canonical → Baileys event dispatcher.
 *
 * Architecture:
 *   1. `adaptBridgeEvent` (Bridge/schema.ts) turns the raw bridge runtime
 *      event into a typed `CanonicalEvent` discriminated union — that's
 *      our domain contract.
 *   2. `DISPATCHERS` here is a `{ [K in CanonicalEvent['type']]: … }`
 *      mapped type — TS forces a handler per variant. Adding a new
 *      canonical variant without a dispatcher is a compile error.
 *   3. Each dispatcher receives a `DispatchCtx` (closure-captured
 *      EventEmitter, logger, callbacks, etc.) and the narrow event
 *      payload — no `as` casts, no `unknown` field access.
 *
 * The previous switch-based design had three implicit failure modes:
 *   • Missing case (no `assertNever`) compiled silently.
 *   • `ev.emit('chats.update', […] as Partial<…>)` casts hid shape errors.
 *   • Adding a new bridge event variant required edits in three files
 *     before the type-checker noticed anything missing.
 * The mapped-type table closes all three.
 */

import type { WhatsAppEvent } from 'whatsapp-rust-bridge'
import type { CanonicalEvent, CanonicalMessage } from '../Bridge/index.ts'
import { adaptBridgeEvent } from '../Bridge/index.ts'
import type {
	BaileysEventMap,
	BinaryNode,
	ConnectionState,
	WACallEvent,
	WACallUpdateType,
	WAMessage,
	WAPresence
} from '../Types/index.ts'
import { DisconnectReason, WAProto } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { isJidGroup } from '../WABinary/jid-utils.ts'
import {
	buildGroupJoinRequestEvents,
	buildGroupNotificationDomainEvent,
	buildGroupNotificationStubMessages
} from './group-notifications.ts'
import { mapReachoutTimelock } from './reachout.ts'
import type { SocketContext } from './types.ts'

const DEF_CALLBACK_PREFIX = 'CB:'
const DEF_TAG_PREFIX = 'TAG:'

/** Emit CB: pattern events on the ws EventEmitter for retrocompat. */
const emitCBEvents = (ctx: SocketContext, node: BinaryNode) => {
	const { ws } = ctx
	const l0 = node.tag
	const l1 = node.attrs || {}
	const l2 = Array.isArray(node.content) ? (node.content[0] as BinaryNode)?.tag : ''

	const id = l1.id
	if (id) ws.emit(`${DEF_TAG_PREFIX}${id}`, node)

	for (const [key, val] of Object.entries(l1)) {
		if (l2) ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}:${val},${l2}`, node)
		ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}:${val}`, node)
		// Bare-key pattern (no value): upstream `socket.ts:610` emits this
		// so consumers wiring `ws.on('CB:iq,id', …)` (any id) catch every
		// stanza carrying that attr. Missing here meant id-pattern matchers
		// silently never fired.
		ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}`, node)
	}
	if (l2) ws.emit(`${DEF_CALLBACK_PREFIX}${l0},,${l2}`, node)
	ws.emit(`${DEF_CALLBACK_PREFIX}${l0}`, node)
}

/**
 * Build a Baileys `WAMessage` from a canonical message.
 *
 * Lives at this layer (not in the adapter) because `WAProto.WebMessageInfo`
 * is the Baileys upstream contract — it's the OUTBOUND end of the
 * bridge → canonical → Baileys pipeline. Adapters never reach for the proto.
 */
const canonicalMessageToWAMessage = (m: CanonicalMessage): WAMessage => {
	const wm = WAProto.WebMessageInfo.fromObject({
		key: {
			remoteJid: m.chatJid,
			fromMe: m.isFromMe,
			id: m.id,
			participant: m.senderJid
		},
		message: m.messageProto,
		messageTimestamp: m.timestamp,
		pushName: m.pushName,
		status: WAProto.WebMessageInfo.Status.SERVER_ACK
	}) as WAMessage
	if (m.participantAlt) wm.key.participantAlt = m.participantAlt
	if (m.remoteJidAlt) wm.key.remoteJidAlt = m.remoteJidAlt
	if (m.isViewOnce) wm.key.isViewOnce = true
	// Surface the raw EditAttribute so consumers that dedupe by `key.id`
	// can branch on edits ("1") vs originals (""). Mirrors upstream's
	// `decodeMessageNode` which sets `key.editAttribute` from the same
	// stanza attribute.
	if (m.editAttribute) (wm.key as { editAttribute?: string }).editAttribute = m.editAttribute
	return wm
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch table — one entry per CanonicalEvent variant.
// ─────────────────────────────────────────────────────────────────────────────

interface EventCallbacks {
	onPairSuccess?: (data: { platform?: string; businessName?: string }) => void | Promise<void>
}

interface DispatchCtx {
	ctx: SocketContext
	callbacks?: EventCallbacks
}

/** Narrow `CanonicalEvent` by its `type` discriminator. */
type CanonicalByType<T extends CanonicalEvent['type']> = Extract<CanonicalEvent, { type: T }>

/** Each dispatcher receives the narrow canonical event + the runtime context. */
type DispatcherFn<T extends CanonicalEvent['type']> = (evt: CanonicalByType<T>, dispatch: DispatchCtx) => void

/**
 * Mapped type forces every CanonicalEvent variant to have an entry. Adding
 * a new variant to `CanonicalEvent` and forgetting a handler here is a
 * compile error — no `assertNever` runtime hack required.
 */
type DispatcherMap = { [K in CanonicalEvent['type']]: DispatcherFn<K> }

const emitClose = (ctx: SocketContext, reason: string, statusCode: number) =>
	ctx.ev.emit('connection.update', {
		connection: 'close',
		lastDisconnect: { error: new Boom(reason, { statusCode }), date: new Date() }
	} as Partial<ConnectionState>)

/**
 * Map bridge `ConnectFailureReason` wire codes (per the bridge's
 * `.d.ts` annotation) onto upstream Baileys' `DisconnectReason`.
 * Unknown codes fall through to `connectionClosed` so existing
 * reconnect heuristics keep working.
 */
const mapConnectFailureToDisconnect = (reason: number | undefined): number => {
	switch (reason) {
		case 401: // LoggedOut
		case 403: // MainDeviceGone
		case 406: // UnknownLogout
			return DisconnectReason.loggedOut
		case 402: // TempBanned
			return DisconnectReason.forbidden
		case 405: // ClientOutdated
			return DisconnectReason.badSession
		case 411: // MultideviceMismatch (legacy alias)
			return DisconnectReason.multideviceMismatch
		case 503: // ServiceUnavailable
		case 501: // Experimental
			return DisconnectReason.unavailableService
		case 408: // Timed out
			return DisconnectReason.timedOut
		case 515: // RestartRequired
			return DisconnectReason.restartRequired
		// 400, 409, 413, 414, 415, 418, 500, undefined → generic close
		default:
			return DisconnectReason.connectionClosed
	}
}

const describeTempBan = (code: number | undefined): string => {
	switch (code) {
		case 101:
			return 'sent_to_too_many_people'
		case 102:
			return 'blocked_by_users'
		case 103:
			return 'created_too_many_groups'
		case 104:
			return 'sent_too_many_same_message'
		case 106:
			return 'broadcast_list'
		default:
			return code != null ? `code_${code}` : 'unknown'
	}
}

/**
 * Sole `as` cast in the dispatch path. The bridge runtime's
 * `connection.update` slot accepts the full ConnectionState union, but we
 * only ever emit partials shaped as `{ connection, … }`. The Baileys event
 * map types `connection.update` as the full state which is unsafe to
 * widen; centralizing the cast here keeps every dispatcher clean.
 */
const emitConnectionUpdate = (ctx: SocketContext, update: Partial<ConnectionState>) =>
	ctx.ev.emit('connection.update', update as Partial<ConnectionState>)

const DISPATCHERS: DispatcherMap = {
	// ── Connection lifecycle ──
	connected: (_, { ctx }) => emitConnectionUpdate(ctx, { connection: 'open' }),
	disconnected: (_, { ctx }) => emitClose(ctx, 'Connection closed', DisconnectReason.connectionClosed),
	qr: (evt, { ctx }) => emitConnectionUpdate(ctx, { qr: evt.code }),
	pairSuccess: (evt, { ctx, callbacks }) => {
		const { id, lid, businessName, platform } = evt
		ctx.setUser({ id, lid })
		callbacks?.onPairSuccess?.({ platform, businessName })
		// Synthetic `creds.update` so upstream-style auth code
		// (`ev.on('creds.update', saveCreds)`) gets a single tick to persist
		// post-pair state. The bridge owns the real creds; this emission is
		// a compat hook for upstream's lifecycle.
		ctx.ev.emit('creds.update', { registered: true, me: { id, lid, name: businessName }, platform })
	},
	pairError: (evt, { ctx }) => emitClose(ctx, 'Pairing failed: ' + evt.error, DisconnectReason.connectionClosed),
	loggedOut: (evt, { ctx }) =>
		emitClose(ctx, evt.reason ? `Logged out: ${evt.reason}` : 'Logged out', DisconnectReason.loggedOut),
	connectFailure: (evt, { ctx }) => {
		// Map bridge `ConnectFailureReason` wire codes onto Baileys'
		// DisconnectReason. Defaults to connectionClosed for unknown codes.
		// LoggedOut paths (401/403/406) drive bots' "should I re-pair?"
		// branch — folding them into connectionClosed kept that broken.
		const status = mapConnectFailureToDisconnect(evt.reason)
		emitClose(ctx, evt.message ?? 'Connection failure', status)
	},
	streamError: (evt, { ctx }) => emitClose(ctx, 'Stream error: ' + evt.code, DisconnectReason.badSession),
	streamReplaced: (_, { ctx }) =>
		emitConnectionUpdate(ctx, {
			connection: 'close',
			lastDisconnect: {
				error: new Boom('Connection replaced', { statusCode: DisconnectReason.connectionReplaced }),
				date: new Date()
			}
		}),
	clientOutdated: (_, { ctx }) => emitClose(ctx, 'Client outdated', DisconnectReason.badSession),
	temporaryBan: (evt, { ctx }) => {
		// Surface the wire code + expire on the Boom so consumers reading
		// `lastDisconnect.error.data` can act on the specific reason.
		const reason = describeTempBan(evt.code)
		const message = evt.expire
			? `Temporary ban (${reason}); expires at ${new Date(evt.expire * 1000).toISOString()}`
			: `Temporary ban (${reason})`
		ctx.ev.emit('connection.update', {
			connection: 'close',
			lastDisconnect: {
				error: new Boom(message, {
					statusCode: DisconnectReason.forbidden,
					data: { code: evt.code, expire: evt.expire }
				}),
				date: new Date()
			}
		} as Partial<ConnectionState>)
	},
	qrScannedWithoutMultidevice: (_, { ctx }) => ctx.logger.warn('QR scanned but multi-device not enabled on phone'),

	// ── Messages ──
	message: (evt, { ctx }) => {
		if (ctx.fullConfig.shouldIgnoreJid?.(evt.chatJid)) return
		// Note: `emitOwnEvents=false` is NOT applied here. Upstream Baileys
		// uses that flag to suppress the local echo when `sendMessage()`
		// succeeds, not to drop inbound `fromMe` messages from other linked
		// devices.
		const waMsg = canonicalMessageToWAMessage(evt)
		const upsertPayload: BaileysEventMap['messages.upsert'] = {
			messages: [waMsg],
			type: evt.isOffline ? 'append' : 'notify'
		}
		if (evt.unavailableRequestId) upsertPayload.requestId = evt.unavailableRequestId
		ctx.ev.emit('messages.upsert', upsertPayload)

		// Mirror upstream `process-message.ts:523-533`: when the inbound
		// proto carries a `reactionMessage`, surface it on the dedicated
		// `messages.reaction` channel as well. The `key` in the event
		// payload is the TARGET (the message being reacted to), and
		// `reaction.key` is the reaction's own envelope key — that's the
		// exact shape upstream consumers index by.
		const reactionMessage = evt.messageProto.reactionMessage
		if (reactionMessage?.key) {
			ctx.ev.emit('messages.reaction', [
				{
					key: reactionMessage.key,
					reaction: { ...reactionMessage, key: waMsg.key }
				}
			])
		}

		// Mirror upstream `process-message.ts:404-414` (REVOKE) and
		// `:474-490` (MESSAGE_EDIT). Both surface as `messages.update` with
		// the TARGET key (id taken from protocolMessage.key).
		const protocolMsg = evt.messageProto.protocolMessage
		// `group.member-tag.update` doesn't reuse `protocolMsg.key.id` — the
		// label change applies to the participant directly, identified by
		// the envelope key. Mirror upstream `process-message.ts:492-503`.
		if (
			protocolMsg?.type === WAProto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE &&
			protocolMsg.memberLabel?.label
		) {
			// `senderJid` is required for this event — it identifies the
			// participant whose label changed. If the bridge ever surfaced a
			// label-change without one (server bug / non-group context), an
			// empty-string fallback would corrupt downstream consumer state.
			// Skip with a warn instead.
			if (!evt.senderJid) {
				ctx.logger.warn(
					{ chatJid: evt.chatJid, label: protocolMsg.memberLabel.label },
					'GROUP_MEMBER_LABEL_CHANGE without senderJid — dropping (no participant to attribute)'
				)
			} else {
				ctx.ev.emit('group.member-tag.update', {
					groupId: evt.chatJid,
					label: protocolMsg.memberLabel.label,
					participant: evt.senderJid,
					participantAlt: evt.participantAlt,
					messageTimestamp: evt.timestamp
				})
			}
		}

		const protocolKeyId = protocolMsg?.key?.id
		if (protocolMsg && protocolKeyId) {
			if (protocolMsg.type === WAProto.Message.ProtocolMessage.Type.REVOKE) {
				ctx.ev.emit('messages.update', [
					{
						key: { ...waMsg.key, id: protocolKeyId },
						update: {
							message: null,
							messageStubType: WAProto.WebMessageInfo.StubType.REVOKE,
							key: waMsg.key
						}
					}
				])
			} else if (protocolMsg.type === WAProto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocolMsg.editedMessage) {
				const tsMs = protocolMsg.timestampMs
				const editedTs = tsMs != null ? Math.floor(Number(tsMs) / 1000) : (evt.timestamp ?? waMsg.messageTimestamp)
				ctx.ev.emit('messages.update', [
					{
						key: { ...waMsg.key, id: protocolKeyId },
						update: {
							message: { editedMessage: { message: protocolMsg.editedMessage } },
							messageTimestamp: editedTs
						}
					}
				])
			}
		}
	},

	receipt: (evt, { ctx }) => {
		// Fan out one MessageUserReceiptUpdate per id (upstream emits
		// per-id) and pick the timestamp slot from the receipt type so
		// consumers branching on `receipt.readTimestamp` /
		// `receipt.playedTimestamp` see the right field populated.
		const participant = evt.isGroup ? evt.senderJid : undefined
		const receipt: { receiptTimestamp?: number; readTimestamp?: number; playedTimestamp?: number } = {}
		if (evt.receiptType === 'read' || evt.receiptType === 'read-self') {
			receipt.readTimestamp = evt.timestamp
		} else if (evt.receiptType === 'played' || evt.receiptType === 'played-self') {
			receipt.playedTimestamp = evt.timestamp
		} else {
			receipt.receiptTimestamp = evt.timestamp
		}
		ctx.ev.emit(
			'message-receipt.update',
			evt.messageIds.map(id => ({
				key: { remoteJid: evt.chatJid, id, fromMe: evt.isFromMe, participant },
				receipt
			}))
		)
	},

	undecryptableMessage: (evt, { ctx }) => {
		// Mirror upstream `messages-recv.ts:1352-…`: surface a CIPHERTEXT
		// stub on `messages.upsert` so consumers see the placeholder and
		// can request a resend (PLACEHOLDER_MESSAGE_RESEND PDO). Logging
		// happens at debug — upstream considers this routine.
		ctx.logger.debug(
			{ id: evt.id, chat: evt.chatJid, isUnavailable: evt.isUnavailable, fail: evt.decryptFailMode },
			'undecryptable message received'
		)
		// `decrypt_fail_mode === 'hide'` means the server told us to
		// silently drop — match that by NOT emitting an upsert.
		if (evt.decryptFailMode === 'hide') return
		const stubMsg = WAProto.WebMessageInfo.fromObject({
			key: {
				remoteJid: evt.chatJid,
				fromMe: evt.isFromMe,
				id: evt.id,
				participant: evt.senderJid
			},
			messageTimestamp: evt.timestamp,
			pushName: evt.pushName,
			messageStubType: WAProto.WebMessageInfo.StubType.CIPHERTEXT,
			messageStubParameters: evt.unavailableType ? [evt.unavailableType] : []
		}) as WAMessage
		if (evt.participantAlt) stubMsg.key.participantAlt = evt.participantAlt
		if (evt.remoteJidAlt) stubMsg.key.remoteJidAlt = evt.remoteJidAlt
		ctx.ev.emit('messages.upsert', { messages: [stubMsg], type: 'notify' })
	},

	// ── Contacts ──
	pushNameUpdate: (evt, { ctx }) => ctx.ev.emit('contacts.update', [{ id: evt.jid, notify: evt.newPushName }]),
	contactUpdate: (evt, { ctx }) => {
		// Promote ContactAction fields into upstream's `Partial<Contact>`
		// shape so consumers (sidebar UIs, contact pickers) see real names
		// instead of bare ids. `verifiedName` is intentionally not set —
		// that comes from a different notification path (business-level
		// verification).
		const update: { id: string; name?: string; lid?: string; phoneNumber?: string } = { id: evt.jid }
		const name = evt.fullName ?? evt.firstName
		if (name) update.name = name
		if (evt.lidJid) update.lid = evt.lidJid
		if (evt.pnJid) update.phoneNumber = evt.pnJid
		ctx.ev.emit('contacts.update', [update])
	},
	pictureUpdate: (evt, { ctx }) =>
		// Upstream emits `imgUrl: null` on removal so consumers cache the
		// absence instead of refetching forever. `'changed'` is the
		// sentinel for "invalidate cache, refetch on demand".
		ctx.ev.emit('contacts.update', [{ id: evt.jid, imgUrl: evt.removed ? null : 'changed' }]),

	// ── Presence ──
	presence: (evt, { ctx }) =>
		ctx.ev.emit('presence.update', {
			id: evt.from,
			presences: {
				[evt.from]: {
					lastKnownPresence: (evt.unavailable ? 'unavailable' : 'available') as WAPresence,
					lastSeen: evt.lastSeen
				}
			}
		}),
	chatPresence: (evt, { ctx }) => {
		// Bridge `ChatPresenceUpdate.state` is `'composing' | 'paused'`.
		// `recording` is signaled via `media === 'audio'` riding on top of
		// `composing` — upstream Baileys' `WAPresence` collapses the two
		// signals into 'composing' / 'recording' / 'paused'. Anything
		// outside this set falls back to `'paused'` (the safe sentinel —
		// "stopped doing whatever they were doing") rather than passing
		// through unvalidated, which previously could leak unknown wire
		// values onto consumer-facing `WAPresence`.
		let mapped: WAPresence
		if (evt.state === 'composing') mapped = evt.media === 'audio' ? 'recording' : 'composing'
		else if (evt.state === 'paused') mapped = 'paused'
		else {
			ctx.logger.debug({ state: evt.state, media: evt.media }, 'chat_presence: unknown state — falling back to paused')
			mapped = 'paused'
		}
		ctx.ev.emit('presence.update', {
			id: evt.chatJid,
			presences: { [evt.senderJid]: { lastKnownPresence: mapped } }
		})
	},

	// ── Groups ──
	groupUpdate: (evt, { ctx }) => {
		const user = ctx.getUser()
		const fromMe = !!(evt.author && (evt.author === user?.id || evt.author === user?.lid))

		// Dispatch via discriminator instead of `as never` so TS validates
		// payload ↔ event-name pairing.
		const domainEvent = buildGroupNotificationDomainEvent(evt)
		if (domainEvent) {
			if (domainEvent.name === 'groups.update') ctx.ev.emit('groups.update', domainEvent.payload)
			else ctx.ev.emit('group-participants.update', domainEvent.payload)
		}

		// `groups.upsert` is intentionally NOT emitted from `<create>`. The
		// bridge gives us only the creation marker — `participants` /
		// `subject` / `creation` are unknown without an extra IQ. Upstream
		// emits this only AFTER `groupMetadata` resolves (`messages-recv.ts:661`),
		// so emitting `[{ id }]` here would feed consumers a broken
		// `GroupMetadata` (participants undefined → `metadata.participants.map`
		// throws). Bots that want the metadata should call
		// `sock.groupMetadata(evt.groupJid)` from a `groups.update` listener
		// or after the matching `messages.upsert` stub.

		// Fan out `group.join-request` for membership_approval_request /
		// created_membership_requests / revoked_membership_requests.
		// Upstream emits one event per affected participant.
		for (const joinReq of buildGroupJoinRequestEvents(evt)) {
			ctx.ev.emit('group.join-request', joinReq)
		}

		const stubMessages = buildGroupNotificationStubMessages(evt, fromMe)
		if (stubMessages.length > 0) {
			ctx.ev.emit('messages.upsert', { messages: stubMessages, type: 'notify' } as BaileysEventMap['messages.upsert'])
		}
	},

	// ── Chat state ──
	archiveUpdate: (evt, { ctx }) => ctx.ev.emit('chats.update', [{ id: evt.jid, archived: evt.archived }]),
	pinUpdate: (evt, { ctx }) =>
		// Upstream Baileys' `chat-utils.ts:878` emits `null` (not
		// `undefined`) on unpin so consumers using `'pinned' in update`
		// can distinguish "not touched" from "explicitly unpinned" —
		// matters for ChatUpdate-shaped diffs where the property's
		// presence is the signal.
		ctx.ev.emit('chats.update', [{ id: evt.jid, pinned: evt.pinned ? evt.timestamp : null }]),
	muteUpdate: (evt, { ctx }) =>
		// Mirrors upstream `chat-utils.ts:809`: when muted, surface
		// `muteEndTimestamp` (0 = forever); on unmute, surface `null`.
		ctx.ev.emit('chats.update', [{ id: evt.jid, muteEndTime: evt.muted ? (evt.muteEndTimestamp ?? 0) : null }]),
	starUpdate: (evt, { ctx }) =>
		ctx.ev.emit('messages.update', [
			{
				key: { remoteJid: evt.chatJid, id: evt.messageId, fromMe: evt.fromMe, participant: evt.participantJid },
				update: { starred: evt.starred }
			}
		]),
	markChatAsReadUpdate: (evt, { ctx }) =>
		// Mirrors upstream `chat-utils.ts:852`: read=true → unreadCount=0,
		// read=false (mark as unread) → -1 sentinel.
		ctx.ev.emit('chats.update', [{ id: evt.jid, unreadCount: evt.read ? 0 : -1 }]),

	// ── Calls ──
	incomingCall: (evt, { ctx }) => {
		const isGroup = isJidGroup(evt.from)
		// Map the canonical action onto upstream Baileys' WACallUpdateType.
		// `preAccept` is upstream's `ringing`. `timeout` has no bridge
		// counterpart yet (upstream synthesizes it from a separate signal).
		const status: WACallUpdateType = evt.action.type === 'preAccept' ? 'ringing' : (evt.action.type as WACallUpdateType)
		const callEvt: WACallEvent = {
			chatId: evt.from,
			from: evt.from,
			id: evt.action.callId,
			date: new Date(evt.timestamp * 1000),
			status,
			offline: evt.offline,
			isGroup,
			// Group JID = `evt.from` only when the stanza came from a group
			// JID itself. The bridge offer payload doesn't carry a separate
			// `group_jid` field today, so the group's JID IS the `from` for
			// `<call>` stanzas in groups.
			...(isGroup ? { groupJid: evt.from } : {}),
			...(evt.action.callerPn ? { callerPn: evt.action.callerPn } : {}),
			...(evt.action.type === 'offer' ? { isVideo: !!evt.action.isVideo } : {}),
			// Bridge auxiliary fields (offer-only / terminate-only / always)
			...(evt.action.callerCountryCode ? { callerCountryCode: evt.action.callerCountryCode } : {}),
			...(evt.action.deviceClass ? { deviceClass: evt.action.deviceClass } : {}),
			...(evt.action.joinable !== undefined ? { joinable: evt.action.joinable } : {}),
			...(evt.action.audio ? { audio: evt.action.audio } : {}),
			...(evt.action.duration !== undefined ? { duration: evt.action.duration } : {}),
			...(evt.action.audioDuration !== undefined ? { audioDuration: evt.action.audioDuration } : {}),
			...(evt.stanzaId ? { stanzaId: evt.stanzaId } : {}),
			...(evt.notify ? { notify: evt.notify } : {}),
			...(evt.platform ? { platform: evt.platform } : {}),
			...(evt.version ? { version: evt.version } : {})
		}
		ctx.ev.emit('call', [callEvt])
	},

	// ── Raw passthrough ──
	rawNode: (evt, { ctx }) => emitCBEvents(ctx, evt.node),
	notification: (evt, { ctx }) =>
		ctx.logger.trace({ tag: evt.tag, attrs: evt.attrs }, 'bridge generic notification (no Baileys mapping)'),
	mexNotification: (evt, { ctx }) => {
		// Route by op_name. Adding a new MEX-driven event means a new entry
		// here — no per-op_name plumbing in the Bridge layer.
		if (evt.opName === 'NotificationUserReachoutTimelockUpdate') {
			const state = mapReachoutTimelock(evt.payload)
			if (state) emitConnectionUpdate(ctx, { reachoutTimeLock: state })
			else ctx.logger.warn({ payload: evt.payload }, 'reachout-timelock push: payload missing expected fields')
			return
		}
		ctx.logger.trace(
			{ opName: evt.opName, offline: evt.offline },
			'bridge mex notification with no Baileys mapping (drop)'
		)
	},
	noop: (evt, { ctx }) =>
		ctx.logger.trace(
			{ bridgeType: evt.bridgeType, detail: evt.detail },
			'bridge event acknowledged (no Baileys equivalent)'
		),

	lidMappingUpdate: (evt, { ctx }) => {
		// Mirror upstream `messages-recv.ts:287`: one `lid-mapping.update`
		// event per pair, payload is the bare `{ lid, pn }` shape.
		for (const mapping of evt.mappings) {
			ctx.ev.emit('lid-mapping.update', mapping)
		}
	},
	chatDelete: (evt, { ctx }) => ctx.ev.emit('chats.delete', [evt.jid]),
	messageDelete: (evt, { ctx }) =>
		// Upstream `chat-utils.ts:857` shape: `{ keys: WAMessageKey[] }` for
		// per-message delete (not the `{ jid, all: true }` chat-clear case
		// — that's a different sync action surface).
		ctx.ev.emit('messages.delete', {
			keys: [
				{
					remoteJid: evt.chatJid,
					id: evt.messageId,
					fromMe: evt.fromMe,
					...(evt.participantJid ? { participant: evt.participantJid } : {})
				}
			]
		}),
	newsletterLiveUpdate: (evt, { ctx }) => {
		// Fan out one `newsletter.reaction` per (message, reaction) pair —
		// matches upstream `messages-recv.ts:320` semantics. Upstream sets
		// `removed: true` when count is 0 (user removed their reaction);
		// we mirror that.
		for (const msg of evt.messages) {
			for (const reaction of msg.reactions) {
				ctx.ev.emit('newsletter.reaction', {
					id: evt.newsletterJid,
					server_id: msg.serverId,
					reaction: {
						code: reaction.code,
						count: reaction.count,
						removed: reaction.count === 0
					}
				})
			}
		}
	},
	disappearingModeChanged: (evt, { ctx }) =>
		// Upstream surfaces this through `chats.update.ephemeralExpiration`
		// (set in `process-message.ts:417` for the protocolMessage path).
		// Bridge gives us the same data via a dedicated event — emit on
		// the same channel for parity.
		ctx.ev.emit('chats.update', [
			{
				id: evt.jid,
				ephemeralExpiration: evt.duration > 0 ? evt.duration : null,
				ephemeralSettingTimestamp: evt.settingTimestamp
			}
		]),

	historySync: (evt, { ctx }) => {
		// 1:1 with upstream `process-message.ts:371-376`. `isLatest` is true
		// when this is the first history sync the bot has seen since
		// pairing — upstream tracks it in `creds.processedHistoryMessages`,
		// but in baileyrs the bridge owns creds, so we approximate with the
		// `INITIAL_BOOTSTRAP` syncType which only fires once per pair. Bots
		// gating "first hydrate" logic on `isLatest` see the same boolean.
		const HSType = WAProto.HistorySync.HistorySyncType
		const isInitial = evt.syncType === HSType.INITIAL_BOOTSTRAP
		const payload: BaileysEventMap['messaging-history.set'] = {
			chats: evt.chats,
			contacts: evt.contacts,
			messages: evt.messages,
			isLatest: evt.syncType === HSType.ON_DEMAND ? undefined : isInitial,
			progress: evt.progress,
			syncType: evt.syncType,
			chunkOrder: evt.chunkOrder,
			peerDataRequestSessionId: evt.peerDataRequestSessionId,
			lidPnMappings: evt.lidPnMappings.length > 0 ? evt.lidPnMappings : undefined
		}
		ctx.ev.emit('messaging-history.set', payload)

		// Also fan out to `chats.upsert` / `contacts.upsert` so bots that
		// wire those (instead of, or in addition to, messaging-history.set)
		// get hydrated. Upstream emits both channels from different code
		// paths; we collapse them here so consumers picking either pattern
		// see the same data on the first pair.
		if (evt.chats.length > 0) ctx.ev.emit('chats.upsert', evt.chats)
		if (evt.contacts.length > 0) ctx.ev.emit('contacts.upsert', evt.contacts)
	}
}

/**
 * Create the event handler that translates canonical events into Baileys
 * events on `ctx.ev`. The handler does NO bridge-shape inspection — that's
 * the schema's job. Field-access here references canonical types
 * exclusively, so a downstream rename surfaces as a `tsc` failure.
 */
export const makeEventHandler = (ctx: SocketContext, callbacks?: EventCallbacks) => {
	const dispatchCtx: DispatchCtx = { ctx, callbacks }

	return (event: WhatsAppEvent) => {
		const canonical = adaptBridgeEvent(event, ctx.logger)
		if (!canonical) return
		// Type-safe table lookup. The runtime cast through `DispatcherFn`
		// is a no-op TS-wise (the table is exhaustively typed) — needed
		// only because TS can't follow the discriminator across the
		// indexed-access into the mapped type.
		const dispatcher = DISPATCHERS[canonical.type] as DispatcherFn<typeof canonical.type>
		try {
			dispatcher(canonical, dispatchCtx)
		} catch (err) {
			// One bad event must not poison the rest of the pipeline.
			ctx.logger.error({ err, type: canonical.type }, 'dispatcher threw — dropping event')
		}
	}
}
