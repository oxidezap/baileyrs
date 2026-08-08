/**
 * Canonical → Baileys event dispatcher.
 *
 * `adaptBridgeEvent` (Bridge/schema.ts) yields a `CanonicalEvent`
 * discriminated union; `DISPATCHERS` is a `{ [K in CanonicalEvent['type']]: … }`
 * mapped type so TS forces a handler per variant — a missing handler
 * is a compile error.
 */

import Long from 'long'
import {
	BinaryReader,
	decodeMessageWireBatch,
	decodeReceiptWireBatch,
	decodeServerAckWireBatch
} from '@oxidezap/whatsapp-rust-bridge'
import type {
	HistorySyncWireBatch,
	MessageWireBatch,
	MessageWireBatchView,
	ReceiptWireBatch,
	ReceiptWireData,
	ServerAckWireBatch,
	ServerAckWireData,
	WhatsAppEvent,
	WhatsAppEventCallbacks
} from '@oxidezap/whatsapp-rust-bridge'
import type { CanonicalEvent, CanonicalMessage } from '../Bridge/index.ts'
import { adaptBridgeEvent, adaptBridgeMessageWire } from '../Bridge/index.ts'
import { decodeHistorySyncWireBatch } from '../Bridge/history-sync-wire.ts'
import { bridgeGroupMetadataToBaileys } from '../Compatibility/group-metadata.ts'
import { DEF_CALLBACK_PREFIX, DEF_TAG_PREFIX, HISTORY_SYNC_PAUSED_TIMEOUT_MS } from '../Defaults/index.ts'
import type {
	BaileysEventMap,
	BinaryNode,
	ConnectionState,
	WACallEvent,
	WACallUpdateType,
	WAMessage,
	WAPresence
} from '../Types/index.ts'
import { DisconnectReason, WAMessageStatus, WAProto } from '../Types/index.ts'
import { LabelAssociationType } from '../Types/LabelAssociation.ts'
import { Boom } from '../Utils/boom.ts'
import { toNumber } from '../Utils/generics.ts'
import { CONVERSATION_HISTORY_SYNC_TYPES } from '../Utils/process-history-message.ts'
import { isJidGroup } from '../WABinary/jid-utils.ts'
import {
	buildGroupCreateStubMessage,
	buildGroupJoinRequestEvents,
	buildGroupNotificationChatUpdates,
	buildGroupNotificationDomainEvent,
	buildGroupNotificationStubMessages
} from '../Compatibility/group-notifications.ts'
import { emitMessageUpsert, type MessageUpsertMetadata } from '../Compatibility/message-upsert.ts'
import { extractMessageCappingPayload } from './message-capping.ts'
import { mapReachoutTimelock } from './reachout.ts'
import { isReconnectableConnectFailure } from './terminal-close.ts'
import type { SocketContext } from './types.ts'

const CANONICAL_MESSAGE_EVENT = 'message'
const MESSAGE_UPSERT_APPEND = 'append'
const MESSAGE_UPSERT_NOTIFY = 'notify'

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
	// Direct construction instead of a `WebMessageInfo.fromObject` envelope:
	// every input is already in its wire-correct runtime type, so the schema
	// walk would only re-derive them field by field on the hottest path. `new`
	// keeps protobufjs parity (instanceof, prototype defaults and own
	// repeated/map fields), and `Message.fromObject` still normalizes the
	// payload while short-circuiting the already-decoded runtime instances.
	const key = new WAProto.MessageKey() as WAMessage['key']
	key.remoteJid = m.chatJid
	key.fromMe = m.isFromMe
	key.id = m.id
	if (m.senderJid !== undefined) key.participant = m.senderJid
	const wm = new WAProto.WebMessageInfo() as WAMessage
	wm.key = key
	if (m.messageProto !== undefined) wm.message = WAProto.Message.fromObject(m.messageProto)
	// Source-side WAProto types 64-bit fields via the bridge shapes (plain
	// number); the published facade and the previous fromObject path both
	// carry a protobufjs `Long` here, so keep that runtime shape.
	wm.messageTimestamp = Long.fromValue(m.timestamp) as unknown as WAMessage['messageTimestamp']
	if (m.pushName !== undefined) wm.pushName = m.pushName
	wm.status = WAProto.WebMessageInfo.Status.SERVER_ACK
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

interface PendingMessageUpsert extends MessageUpsertMetadata {
	messages: WAMessage[]
}

const messageUpsertMetadata = (message: CanonicalMessage): MessageUpsertMetadata => ({
	type: message.isOffline ? MESSAGE_UPSERT_APPEND : MESSAGE_UPSERT_NOTIFY,
	requestId: message.unavailableRequestId
})

const hasMessageSideEffects = (message: CanonicalMessage) =>
	message.messageProto.reactionMessage != null || message.messageProto.protocolMessage != null

const hasSameUpsertMetadata = (left: MessageUpsertMetadata, right: MessageUpsertMetadata) =>
	left.type === right.type && left.requestId === right.requestId

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch table — one entry per CanonicalEvent variant.
// ─────────────────────────────────────────────────────────────────────────────

interface EventCallbacks {
	onPairSuccess?: (data: { platform?: string; businessName?: string }) => void | Promise<void>
	onIncomingCall?: (event: Extract<CanonicalEvent, { type: 'incomingCall' }>) => void
	onDirtyState?: (event: Extract<CanonicalEvent, { type: 'dirtyState' }>) => void
	/**
	 * The engine has stopped reconnecting: this client is dead weight only
	 * `free()` can reclaim.
	 *
	 * Owns publishing the `close` too — `publish()` must be called, and the
	 * point of handing it over is that the socket can finish tearing down
	 * first. Upstream does the same, emitting its close only after `ws.close()`
	 * and the end handlers (`Socket/socket.ts`). A consumer answering `close`
	 * with a replacement socket on the same auth folder would otherwise race
	 * the old one's store flush and `free()`.
	 */
	onTerminalClose?: (error: Error, publish: () => void) => void
	/**
	 * Hand back a cleanup for anything the dispatcher armed that outlives a
	 * single event — today the history-sync pause timer. The socket registers
	 * it as an end handler, so a plain `sock.end()` or an `await using` scope
	 * exiting cancels it too: only the terminal-close path goes through
	 * `emitClose`, and a timer surviving disposal fires
	 * `messaging-history.status: paused` from a socket that is already gone.
	 *
	 * Called once, during `makeEventHandlers`.
	 */
	onCleanup?: (cleanup: () => void) => void
	/**
	 * Whether `sock.setAutoReconnect(true)` is in effect. A plain drop is only
	 * transient while the engine still intends to retry: with auto-reconnect
	 * off, the run loop dispatches `Disconnected` and then breaks for good
	 * (`client/lifecycle.rs` tests the flag *after* the dispatch), so the same
	 * event becomes terminal. Absent callback means the default, enabled.
	 */
	isAutoReconnectEnabled?: () => boolean
}

interface DispatchCtx {
	ctx: SocketContext
	callbacks?: EventCallbacks
	historySync: HistorySyncStatusState
}

interface HistorySyncStatusState {
	initialBootstrapComplete: boolean
	recentSyncComplete: boolean
	pausedTimeout?: ReturnType<typeof setTimeout>
}

const clearHistorySyncPausedTimeout = (state: HistorySyncStatusState) => {
	if (state.pausedTimeout) clearTimeout(state.pausedTimeout)
	state.pausedTimeout = undefined
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

/**
 * Report a disconnect the engine will NOT recover from.
 *
 * `connection: 'close'` carries one meaning on this socket, the same one it
 * carries in upstream Baileys: the socket is finished and the consumer has to
 * build a new one. Disconnects the engine is still retrying never come through
 * here — see `emitRetrying` and `terminal-close.ts`.
 *
 * `onTerminalClose` owns both the teardown and the publish, so the socket can
 * be fully torn down before the consumer sees the event — the order upstream
 * uses, and what keeps a replacement socket from overlapping the old one's
 * store flush. Without that callback (a bare `makeEventHandler`), the close
 * goes out immediately.
 */
const emitClose = (
	{ ctx, callbacks, historySync }: DispatchCtx,
	reason: string,
	statusCode: number,
	data?: Record<string, unknown>
) => {
	// Every terminal path cancels the history-sync pause timer, not just the
	// one in `disconnected`. A transient drop deliberately keeps it armed, so
	// without this a drop followed by a terminal close leaves it to fire a
	// `messaging-history.status: paused` from a socket that has already ended.
	clearHistorySyncPausedTimeout(historySync)

	const error = new Boom(reason, { statusCode, data })
	const publish = () =>
		ctx.ev.emit('connection.update', {
			connection: 'close',
			lastDisconnect: { error, date: new Date() }
		} as Partial<ConnectionState>)

	if (callbacks?.onTerminalClose) {
		callbacks.onTerminalClose(error, publish)
		return
	}
	publish()
}

/**
 * Report a disconnect the engine is retrying on its own.
 *
 * Emitted as `connecting` rather than `close` on purpose. The canonical
 * upstream handler is `if (connection === 'close') reconnect()`, and upstream
 * has no auto-reconnect — so surfacing a transient drop as `close` makes that
 * handler build a second socket while the engine is already backing off to
 * restore the first. Two live sockets for one connection. `connecting` is the
 * state upstream itself uses while a connection is being (re)established, so
 * consumers read this as `open → connecting → open` and stay out of the way.
 */
const emitRetrying = (ctx: SocketContext) =>
	ctx.ev.emit('connection.update', {
		connection: 'connecting',
		// Same shape upstream's own `connecting` always carries. Without the
		// explicit clear, a consumer merging partial state keeps rendering the
		// QR from before the drop — one the server has already rotated away.
		qr: undefined,
		receivedPendingNotifications: false
	} as Partial<ConnectionState>)

/**
 * `<failure reason="405">` — the wire code, kept as-is rather than folded into
 * `DisconnectReason`, which has no member for it. See the `clientOutdated`
 * dispatcher for why `badSession` was the wrong home.
 */
const CLIENT_OUTDATED_STATUS = 405

/**
 * Map bridge `ConnectFailureReason` wire codes (per the bridge's
 * `.d.ts` annotation) onto upstream Baileys' `DisconnectReason`.
 * Unknown codes fall through to `connectionClosed` so existing
 * reconnect heuristics keep working.
 *
 * Several cases here are belt-and-braces: the engine dispatches its own event
 * for `is_logged_out()` reasons (401/403/406) and for 405, so those never
 * reach `connectFailure` in practice. Kept because they cost nothing and the
 * engine's routing is not ours to depend on.
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
			return CLIENT_OUTDATED_STATUS
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
	offlineSyncCompleted: (_, { ctx }) =>
		emitConnectionUpdate(ctx, {
			receivedPendingNotifications: true
		}),
	// The engine dispatches `Disconnected` only for an *unexpected* loop exit,
	// and every terminal path marks `expected_disconnect` first — so this is
	// normally "the Fibonacci backoff is already running".
	//
	// The exception is `sock.setAutoReconnect(false)`: `client/lifecycle.rs`
	// dispatches `Disconnected` and only *then* tests the flag and breaks out
	// of the run loop. Treating that as transient would leave the socket
	// reporting `connecting` forever, with the wasm client never freed and the
	// consumer's reconnect handler never firing.
	disconnected: (_, dispatchCtx) => {
		if (dispatchCtx.callbacks?.isAutoReconnectEnabled?.() === false) {
			emitClose(dispatchCtx, 'Connection closed', DisconnectReason.connectionClosed)
			return
		}
		// The pause timer survives a retrying drop. It is the only pending
		// transition to `messaging-history.status: paused`, and this socket
		// lives on — clearing it left a RECENT sync that had reported progress
		// below 100 with neither `paused` nor `complete` if the reconnect
		// produced no further chunk, hanging consumers waiting on hydration.
		emitRetrying(dispatchCtx.ctx)
	},
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
	// Pairing failed, but the engine keeps its loop and re-emits a QR — nothing
	// about the client is dead, so this must not read as `close`. It still
	// belongs on the bus: the QR the user was shown is spent, and `connecting`
	// clears it while telling the consumer a fresh one is coming.
	pairError: (evt, { ctx }) => {
		ctx.logger.error({ err: evt.error }, 'pairing failed; the engine will retry')
		emitRetrying(ctx)
	},
	loggedOut: (evt, dispatchCtx) =>
		emitClose(dispatchCtx, evt.reason ? `Logged out: ${evt.reason}` : 'Logged out', DisconnectReason.loggedOut),
	connectFailure: (evt, dispatchCtx) => {
		// Map bridge `ConnectFailureReason` wire codes onto Baileys'
		// DisconnectReason. Defaults to connectionClosed for unknown codes.
		// LoggedOut paths (401/403/406) drive bots' "should I re-pair?"
		// branch — folding them into connectionClosed kept that broken.
		// "Reconnectable" is only true while the engine is allowed to reconnect.
		// With `setAutoReconnect(false)` the run loop breaks on the next pass,
		// so reporting `connecting` for a 500/503 would leave the socket stuck
		// in that state with nothing left to restore it.
		if (isReconnectableConnectFailure(evt.reason) && dispatchCtx.callbacks?.isAutoReconnectEnabled?.() !== false) {
			dispatchCtx.ctx.logger.warn(
				{ reason: evt.reason, message: evt.message },
				'connect failure; the engine will retry'
			)
			emitRetrying(dispatchCtx.ctx)
			return
		}

		const status = mapConnectFailureToDisconnect(evt.reason)
		emitClose(dispatchCtx, evt.message ?? 'Connection failure', status)
	},
	// NOT a close. The engine dispatches `StreamError` only from its catch-all
	// `<stream:error>` branch — an unknown code, an `<ack/>` it still owes the
	// server, or `<xml-not-well-formed>` — and it keeps or deliberately recycles
	// the connection in every one of those. This used to report
	// `DisconnectReason.badSession`, the code bots use to wipe credentials and
	// re-pair, so a routine stream recycle could destroy a working session. The
	// coded stream errors (401/409/515/516) never arrive here; they dispatch
	// `loggedOut` / `streamReplaced` of their own.
	streamError: (evt, { ctx }) => ctx.logger.warn({ code: evt.code }, 'stream error; the connection is preserved'),
	streamReplaced: (_, dispatchCtx) =>
		emitClose(dispatchCtx, 'Connection replaced', DisconnectReason.connectionReplaced),
	// Carries the wire code (405), not `DisconnectReason.badSession`. Upstream
	// does the same for stream errors — `+node.attrs.code` first, `badSession`
	// only as the no-code fallback (`Utils/generics.ts` `getErrorCodeFromStreamError`).
	// badSession is 500, the code bots use to wipe credentials and re-pair; an
	// outdated build is the one failure where wiping a perfectly good session
	// helps nobody, and the next connect fails identically.
	clientOutdated: (_, dispatchCtx) => emitClose(dispatchCtx, 'Client outdated', CLIENT_OUTDATED_STATUS),
	temporaryBan: (evt, dispatchCtx) => {
		// Surface the wire code + expire on the Boom so consumers reading
		// `lastDisconnect.error.data` can act on the specific reason.
		const reason = describeTempBan(evt.code)
		const message = evt.expire
			? `Temporary ban (${reason}); expires at ${new Date(evt.expire * 1000).toISOString()}`
			: `Temporary ban (${reason})`
		emitClose(dispatchCtx, message, DisconnectReason.forbidden, { code: evt.code, expire: evt.expire })
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
		emitMessageUpsert(ctx, [waMsg], messageUpsertMetadata(evt))

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
				// `timestampMs` is an int64 proto field → a protobufjs `Long`
				// object from the bridge; `toNumber` is Long-safe (plain
				// `Number()` would yield NaN and corrupt the edit timestamp).
				const tsMs = protocolMsg.timestampMs
				const editedTs = tsMs != null ? Math.floor(toNumber(tsMs) / 1000) : (evt.timestamp ?? waMsg.messageTimestamp)
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

		if (evt.action.type === 'create') {
			// The neutral bridge marker intentionally carries no Baileys-shaped
			// metadata. Resolve it here, at the compatibility boundary, then emit
			// the same complete lifecycle and ordering as upstream.
			void (async () => {
				try {
					const bridgeMetadata = await (await ctx.getClient()).getGroupMetadata(evt.groupJid)
					const metadata = bridgeGroupMetadataToBaileys(bridgeMetadata)
					ctx.ev.emit('chats.upsert', [
						{ id: metadata.id, name: metadata.subject, conversationTimestamp: metadata.creation }
					])
					ctx.ev.emit('groups.upsert', [
						{
							...metadata,
							author: evt.author,
							authorPn: evt.authorPn,
							authorUsername: evt.authorUsername
						}
					])
					ctx.ev.emit('messages.upsert', {
						messages: [buildGroupCreateStubMessage(evt, metadata, fromMe)],
						type: 'append'
					})
				} catch (err) {
					ctx.logger.warn({ err, groupJid: evt.groupJid }, 'group create notification: metadata resolution failed')
				}
			})()
			return
		}

		// Upstream upserts the synthesized notification message before
		// process-message derives high-level group/chat events from it.
		const stubMessages = buildGroupNotificationStubMessages(evt, fromMe)
		if (stubMessages.length > 0) {
			ctx.ev.emit('messages.upsert', { messages: stubMessages, type: 'append' })
		}

		// Dispatch via discriminator instead of `as never` so TS validates
		// payload ↔ event-name pairing.
		const domainEvent = buildGroupNotificationDomainEvent(evt)
		if (domainEvent) {
			if (domainEvent.name === 'groups.update') ctx.ev.emit('groups.update', domainEvent.payload)
			else ctx.ev.emit('group-participants.update', domainEvent.payload)
		}

		// Fan out `group.join-request` for membership_approval_request /
		// created_membership_requests / revoked_membership_requests.
		// Upstream emits one event per affected participant.
		for (const joinReq of buildGroupJoinRequestEvents(evt)) {
			ctx.ev.emit('group.join-request', joinReq)
		}

		const chatUpdates = buildGroupNotificationChatUpdates(evt)
		if (chatUpdates.length > 0) ctx.ev.emit('chats.update', chatUpdates)
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
	labelEdit: (evt, { ctx }) =>
		// Upstream `labels.edit` carries a `Label`. A delete arrives with
		// `deleted: true` (consumers remove it from their store).
		ctx.ev.emit('labels.edit', {
			id: evt.labelId,
			name: evt.name,
			color: evt.color,
			deleted: evt.deleted,
			predefinedId: evt.predefinedId
		}),
	labelAssociation: (evt, { ctx }) =>
		// Inbound sync only ever carries chat associations (the bridge event
		// has a `chat_jid`); message-label associations are a separate path.
		ctx.ev.emit('labels.association', {
			association: { type: LabelAssociationType.Chat, chatId: evt.chatJid, labelId: evt.labelId },
			type: evt.labeled ? 'add' : 'remove'
		}),

	// ── Calls ──
	incomingCall: (evt, { ctx, callbacks }) => {
		callbacks?.onIncomingCall?.(evt)
		const isGroup = isJidGroup(evt.from)
		// Canonical call actions use the exact public Baileys status spelling;
		// missed-call notifications are normalized to `timeout` by the adapter.
		const status: WACallUpdateType = evt.action.type
		const callEvt: WACallEvent = {
			chatId: evt.from,
			from: evt.action.callCreator ?? evt.from,
			...(evt.action.callCreator ? { callCreator: evt.action.callCreator } : {}),
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
	dirtyState: (evt, { callbacks }) => callbacks?.onDirtyState?.(evt),
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
		if (evt.opName === 'MessageCappingInfoNotification') {
			const payload = extractMessageCappingPayload(evt.payload)
			if (payload) ctx.ev.emit('message-capping.update', payload)
			else ctx.logger.warn({ payload: evt.payload }, 'message-capping push: payload missing expected fields')
			return
		}
		ctx.logger.trace(
			{ opName: evt.opName, offline: evt.offline },
			'bridge mex notification with no Baileys mapping (drop)'
		)
	},
	serverAck: (evt, { ctx }) => {
		// The public CB surface comes exclusively from Event::RawNode. Rebuilding
		// an ACK from this semantic event would drop optional wire attributes and
		// emit the same stanza twice whenever raw forwarding is enabled.
		if (evt.class === 'message' && evt.error) {
			ctx.logger.warn(
				{ msgId: evt.id, from: evt.from, error: evt.error },
				'outgoing message was rejected by the server'
			)
			ctx.ev.emit('messages.update', [
				{
					key: { remoteJid: evt.from, fromMe: true, id: evt.id },
					update: {
						status: WAMessageStatus.ERROR,
						messageStubParameters: [evt.error]
					}
				}
			])
			return
		}

		ctx.logger.debug(
			{ msgId: evt.id, class: evt.class, from: evt.from, timestamp: evt.timestamp },
			'server acknowledged outgoing stanza'
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
	chatClear: (evt, { ctx }) => ctx.ev.emit('messages.delete', { jid: evt.jid, all: true }),
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

	historySync: (evt, { ctx, historySync }) => {
		// 1:1 with upstream `process-message.ts:371-376`. `isLatest` is true
		// when this is the first history sync the bot has seen since
		// pairing — upstream tracks it in `creds.processedHistoryMessages`,
		// but in baileyrs the bridge owns creds, so we approximate with the
		// `INITIAL_BOOTSTRAP` syncType which only fires once per pair. Bots
		// gating "first hydrate" logic on `isLatest` see the same boolean.
		const HSType = WAProto.HistorySync.HistorySyncType
		const isInitial = evt.syncType === HSType.INITIAL_BOOTSTRAP
		// The bridge may split one chunk into bounded batches (isFinalBatch=false
		// on all but the last). `isLatest`/`progress` are chunk-level signals, so
		// they only fire on the final batch — intermediate batches just append
		// data. A non-batched bridge omits the flag → `!== false` keeps the old
		// single-event behavior.
		const isFinalBatch = evt.isFinalBatch !== false
		if (isFinalBatch && isInitial && !historySync.initialBootstrapComplete) {
			historySync.initialBootstrapComplete = true
			ctx.ev.emit('messaging-history.status', {
				syncType: HSType.INITIAL_BOOTSTRAP,
				status: 'complete',
				explicit: true
			})
		}
		if (isFinalBatch && evt.syncType === HSType.RECENT && !historySync.recentSyncComplete) {
			clearHistorySyncPausedTimeout(historySync)
			if (evt.progress === 100) {
				historySync.recentSyncComplete = true
				ctx.ev.emit('messaging-history.status', { syncType: HSType.RECENT, status: 'complete', explicit: true })
			} else {
				historySync.pausedTimeout = setTimeout(() => {
					if (!historySync.recentSyncComplete) {
						historySync.recentSyncComplete = true
						ctx.ev.emit('messaging-history.status', {
							syncType: HSType.RECENT,
							status: 'paused',
							explicit: false
						})
					}
					historySync.pausedTimeout = undefined
				}, HISTORY_SYNC_PAUSED_TIMEOUT_MS)
				historySync.pausedTimeout.unref?.()
			}
		}
		const payload: BaileysEventMap['messaging-history.set'] = {
			chats: evt.chats,
			contacts: evt.contacts,
			messages: evt.messages,
			isLatest: evt.syncType === HSType.ON_DEMAND ? undefined : isInitial && isFinalBatch,
			progress: isFinalBatch ? evt.progress : undefined,
			syncType: evt.syncType,
			pastParticipants: evt.pastParticipants,
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

const dispatchCanonicalEvent = (canonical: CanonicalEvent, dispatchCtx: DispatchCtx) => {
	// Type-safe table lookup. The runtime cast through `DispatcherFn` is a
	// no-op TS-wise (the table is exhaustively typed) — needed only because TS
	// cannot follow the discriminator across an indexed mapped type.
	const dispatcher = DISPATCHERS[canonical.type] as DispatcherFn<typeof canonical.type>
	try {
		dispatcher(canonical, dispatchCtx)
	} catch (err) {
		// One bad event must not poison the rest of the pipeline.
		dispatchCtx.ctx.logger.error({ err, type: canonical.type }, 'dispatcher threw — dropping event')
	}
}

type CanonicalAt = (index: number) => CanonicalEvent | null

/** Aggregate adjacent ordinary messages while preserving every side-effecting
 * event boundary. Both bridge object events and protobuf-wire batches enter
 * through this single state machine. */
const dispatchCanonicalBatch = (
	ctx: SocketContext,
	dispatchCtx: DispatchCtx,
	count: number,
	canonicalAt: CanonicalAt
) => {
	let pending: PendingMessageUpsert | undefined

	for (let index = 0; index < count; index++) {
		const canonical = canonicalAt(index)
		if (!canonical) continue

		// Only ordinary messages can share one messages.upsert emission.
		// Flush before every other event or a message with secondary
		// channels (reaction, revoke, edit, member-label) to preserve the
		// exact observable order of those side effects.
		if (canonical.type !== CANONICAL_MESSAGE_EVENT || hasMessageSideEffects(canonical)) {
			if (pending) {
				emitMessageUpsert(ctx, pending.messages, pending)
				pending = undefined
			}
			dispatchCanonicalEvent(canonical, dispatchCtx)
			continue
		}

		if (ctx.fullConfig.shouldIgnoreJid?.(canonical.chatJid)) continue

		try {
			const metadata = messageUpsertMetadata(canonical)
			const message = canonicalMessageToWAMessage(canonical)
			if (pending && hasSameUpsertMetadata(pending, metadata)) {
				pending.messages.push(message)
			} else {
				if (pending) emitMessageUpsert(ctx, pending.messages, pending)
				pending = { ...metadata, messages: [message] }
			}
		} catch (err) {
			ctx.logger.error({ err, type: CANONICAL_MESSAGE_EVENT }, 'dispatcher threw — dropping event')
		}
	}

	if (pending) emitMessageUpsert(ctx, pending.messages, pending)
}

/**
 * Create typed single and batch handlers for the bridge. The bridge only uses
 * the batch capability when adjacent messages are already queued, while this
 * layer owns all Baileys-specific translation and EventEmitter aggregation.
 */
export const makeEventHandlers = (ctx: SocketContext, callbacks?: EventCallbacks): WhatsAppEventCallbacks => {
	const dispatchCtx: DispatchCtx = {
		ctx,
		callbacks,
		historySync: { initialBootstrapComplete: false, recentSyncComplete: false }
	}

	callbacks?.onCleanup?.(() => clearHistorySyncPausedTimeout(dispatchCtx.historySync))

	const onEvent = (event: WhatsAppEvent) => {
		const canonical = adaptBridgeEvent(event, ctx.logger)
		if (canonical) dispatchCanonicalEvent(canonical, dispatchCtx)
	}

	const onMessageBatch = (batch: MessageWireBatch) => {
		// The batch crosses as one buffer; the decoder validates its header and
		// returns views over it, so payload count and metadata count agree by
		// construction.
		let view: MessageWireBatchView
		try {
			view = decodeMessageWireBatch(batch)
		} catch (err) {
			ctx.logger.error({ err }, 'failed to decode the message wire batch')
			return
		}
		const { messageData, messageOffsets, infos } = view

		// Decode through the runtime facade so each payload materializes as a
		// hydrated runtime instance: `WebMessageInfo.fromObject` then keeps the
		// message subtree via its instanceof short-circuit instead of walking
		// and reallocating the whole tree — the dominant per-message allocation
		// cost on the hot path. Lenient like the history-sync decoder: one
		// malformed payload is skipped, not fatal to the batch.
		const messages: unknown[] = Array.from({ length: infos.length })
		const reader = new BinaryReader(messageData)
		for (let index = 0; index < infos.length; index++) {
			try {
				const start = messageOffsets[index]!
				const end = messageOffsets[index + 1]!
				reader.pos = start
				messages[index] = WAProto.Message.decode(reader, end - start)
			} catch (err) {
				messages[index] = null
				ctx.logger.warn({ err, index }, 'skipping malformed wire message')
			}
		}
		dispatchCanonicalBatch(ctx, dispatchCtx, infos.length, index =>
			adaptBridgeMessageWire(messages[index], infos[index]!, ctx.logger)
		)
	}

	const onHistorySyncBatch = (batch: HistorySyncWireBatch) => {
		const decoded = decodeHistorySyncWireBatch(batch, ctx.logger)
		onEvent(decoded.event)
		return decoded.skippedConversations
	}

	// Packed receipt/ack batches reconstruct the single-event wire shape and
	// reuse the same adapter path, so transport is the only thing that changes.
	const onReceiptBatch = (batch: ReceiptWireBatch) => {
		let receipts: ReceiptWireData[]
		try {
			receipts = decodeReceiptWireBatch(batch)
		} catch (err) {
			ctx.logger.error({ err }, 'failed to decode receipt wire batch')
			return
		}
		// The decoded payload matches the single-event wire shape; the union's
		// declared type is narrower than the adapter's tolerance.
		for (const data of receipts) onEvent({ type: 'receipt', data } as unknown as WhatsAppEvent)
	}

	const onServerAckBatch = (batch: ServerAckWireBatch) => {
		let acks: ServerAckWireData[]
		try {
			acks = decodeServerAckWireBatch(batch)
		} catch (err) {
			ctx.logger.error({ err }, 'failed to decode server-ack wire batch')
			return
		}
		for (const data of acks) onEvent({ type: 'server_ack', data } as unknown as WhatsAppEvent)
	}

	// Opting the two packed paths into the bridge's borrowing contract, which
	// lets it hand every batch out of one reused buffer instead of allocating
	// per batch. Both handlers already satisfied the contract unchanged: each
	// decodes as its first act, and `decodeReceiptWireBatch` /
	// `decodeServerAckWireBatch` materialise every field rather than keeping a
	// view, so nothing points at the buffer once they return. Neither is async,
	// and no exception escapes them — the decode is guarded here and the
	// dispatch is guarded in `dispatchCanonicalEvent` — both of which the
	// contract requires, since either one drops the whole session back to a
	// buffer per batch.
	//
	// Declaring a borrowing name replaces its copying counterpart as the sink,
	// so the pair below is the whole opt-in. There is deliberately none for
	// messages: `decodeMessageWireBatch` returns views over the batch, so reuse
	// would alias the decoded result and not just the buffer.
	return {
		onEvent,
		onMessageBatch,
		onHistorySyncBatch,
		onReceiptBatch,
		onServerAckBatch,
		onReceiptBatchBorrowed: onReceiptBatch,
		onServerAckBatchBorrowed: onServerAckBatch,
		historySyncConversationTypes: CONVERSATION_HISTORY_SYNC_TYPES
	}
}

/** Legacy single-event helper retained for direct consumers and tests. */
export const makeEventHandler = (ctx: SocketContext, callbacks?: EventCallbacks) =>
	makeEventHandlers(ctx, callbacks).onEvent
