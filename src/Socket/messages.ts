import { sendReportingUpstreamFailure } from '../Compatibility/all-encryptions-failed.ts'
import { sendDroppingDerivedNodes } from '../Compatibility/derived-stanza-nodes.ts'
import { encodeProtoCompat } from '../Compatibility/encode-proto.ts'
import { EMPTY_RELAY_NODES, planMessageRelay, resolveMessageId } from '../Compatibility/message-relay.ts'
import { receiptMessageKeys } from '../Compatibility/message-keys.ts'
import type {
	AnyMessageContent,
	BaileysEventMap,
	MessageGenerationOptions,
	MessageReceiptType,
	MessageRelayOptions,
	WAMessage,
	WAMessageContent,
	WAMessageKey
} from '../Types/index.ts'
import { MESSAGE_RECEIPT_TYPES, WAProto } from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import { Boom } from '../Utils/boom.ts'
import { generateWAMessage, getContentType, normalizeMessageContent } from '../Utils/messages.ts'
import { jidNormalizedUser } from '../WABinary/index.ts'
import type { SocketContext } from './types.ts'

/** Extract the media content from a WAMessage (image, video, audio, document, sticker) */
function getMediaContent(content: WAMessageContent | null | undefined) {
	return (
		content?.imageMessage ||
		content?.videoMessage ||
		content?.audioMessage ||
		content?.documentMessage ||
		content?.stickerMessage
	)
}

type NormalizedUserJid = { userId: string; jid: string }
const normalizedUserJids = new WeakMap<SocketContext, NormalizedUserJid>()

const getNormalizedUserJid = (ctx: SocketContext): string | undefined => {
	const userId = ctx.getUser()?.id
	if (!userId) return undefined

	const cached = normalizedUserJids.get(ctx)
	if (cached?.userId === userId) return cached.jid

	const jid = jidNormalizedUser(userId)
	normalizedUserJids.set(ctx, { userId, jid })
	return jid
}

export const makeMessageMethods = (ctx: SocketContext) => ({
	sendMessage: async (
		jid: string,
		content: AnyMessageContent,
		options?: Omit<MessageGenerationOptions, 'waClient' | 'logger' | 'userJid' | 'mediaInNote'>
	): Promise<WAMessage> => {
		const client = await ctx.getClient()
		const userJid = getNormalizedUserJid(ctx) ?? ''

		// SocketConfig contains transport/auth/cache state that message
		// generation neither reads nor owns. Copying all of it here retained a
		// large object graph and repeated dozens of property writes per send.
		// `options` is the one generation default shared with the socket; every
		// other generation knob belongs to this call's typed options.
		const generationOptions: MessageGenerationOptions = {
			...options,
			options: options?.options ?? ctx.fullConfig.options,
			logger: ctx.logger,
			userJid,
			waClient: client
		}
		const fullMsg = await generateWAMessage(jid, content, generationOptions)

		const msg = normalizeMessageContent(fullMsg.message)
		if (!msg) throw new Boom('Failed to generate message content', { statusCode: 400 })

		const contentType = getContentType(msg)

		if (contentType === 'protocolMessage') {
			const protoMsg = msg.protocolMessage
			if (protoMsg?.type === WAProto.Message.ProtocolMessage.Type.REVOKE && protoMsg?.key?.id) {
				if (options?.messageId) {
					// The core has no revoke variant that takes a stanza id, so
					// the option cannot be honoured here. Saying so beats the
					// silent drop this option used to get on every path.
					ctx.logger.warn(
						{ jid, messageId: options.messageId },
						'messageId option cannot be honoured for a revoke: the core assigns the stanza id itself'
					)
				}

				// Group revokes need the original sender's participant JID —
				// without it the server rejects the revoke. The bridge
				// signature is `revokeMessage(jid, message_id, participant?)`.
				// Caller passes participant via `message.delete.participant`
				// which lands on `protoMsg.key.participant` in the generated
				// proto.
				await client.revokeMessage(jid, protoMsg.key.id, protoMsg.key.participant ?? null)
				return fullMsg
			}

			if (
				protoMsg?.type === WAProto.Message.ProtocolMessage.Type.MESSAGE_EDIT &&
				protoMsg?.key?.id &&
				protoMsg?.editedMessage
			) {
				const editBytes = WAProto.Message.encode(protoMsg.editedMessage).finish()
				// Edit-path counterpart of `options.messageId` on a plain send, and
				// deliberately not `resolveMessageId`: the engine treats any supplied
				// stanza id as borrowed and binds no id-keyed state to it, so an edit
				// nobody asked to pin would silently lose its retry-cache entry and
				// outbound secret. Absent stays absent. `||` and not `??` because an
				// empty id means unspecified everywhere else in this API.
				const editStanzaId = options?.messageId || undefined
				const newMsgId = await client.editMessageBytes(jid, protoMsg.key.id, editBytes, editStanzaId)
				fullMsg.key.id = newMsgId || fullMsg.key.id
				return fullMsg
			}
		}

		const msgBytes = encodeProtoCompat('Message', msg as Record<string, unknown>)
		// The with-options sends are the same core send as the plain ones, with
		// the stanza id supplied by the caller instead of drawn by the engine.
		// The id resolves through the same place `relayMessage` resolves it.
		const messageId = resolveMessageId(ctx.getUser(), options?.messageId)
		const msgId = await sendReportingUpstreamFailure(() =>
			jid === 'status@broadcast' && options?.statusJidList?.length
				? client.sendStatusMessageBytesWithOptions(msgBytes, options.statusJidList, messageId, EMPTY_RELAY_NODES, false)
				: client.relayMessageBytesWithOptions(jid, msgBytes, messageId, EMPTY_RELAY_NODES, false, false)
		)

		fullMsg.key.id = msgId || fullMsg.key.id

		// Local echo of the message we just sent. Suppressed when
		// `emitOwnEvents=false` so callers that explicitly opted out of seeing
		// their own outbound messages don't get them looped back. This is the
		// upstream-Baileys semantics of `emitOwnEvents` — it controls THIS
		// echo, not inbound `fromMe` messages from other linked devices.
		if (ctx.fullConfig.emitOwnEvents !== false) {
			ctx.ev.emit('messages.upsert', {
				messages: [fullMsg],
				type: 'append'
			} as BaileysEventMap['messages.upsert'])
		}

		return fullMsg
	},

	updateMediaMessage: async (message: WAMessage): Promise<WAMessage> => {
		const client = await ctx.getClient()

		const content = normalizeMessageContent(message.message)
		const mediaContent = getMediaContent(content)
		if (!mediaContent) {
			throw new Boom('Not a media message', { statusCode: 400 })
		}

		const mediaKey = mediaContent.mediaKey
		if (!mediaKey) {
			throw new Boom('Message has no media key', { statusCode: 400 })
		}

		const key = message.key
		const newDirectPath = await client.requestMediaReupload(
			key.id!,
			key.remoteJid!,
			mediaKey instanceof Uint8Array ? mediaKey : new Uint8Array(mediaKey),
			!!key.fromMe,
			key.participant ?? null
		)

		// Update the message with the new direct path
		// (download uses directPath via Rust bridge, url is informational)
		mediaContent.directPath = newDirectPath

		ctx.logger.debug({ directPath: newDirectPath, msgId: key.id }, 'media reupload successful')

		ctx.ev.emit('messages.update', [
			{
				key: message.key,
				update: { message: message.message }
			}
		])

		return message
	},

	/**
	 * Low-level message relay — sends a raw proto.IMessage with full control
	 * over the message ID. Use `sendMessage` for the high-level API that handles
	 * media upload, message generation, link previews, etc.
	 *
	 * Returns the message ID used on the wire.
	 *
	 * @param jid Recipient JID
	 * @param message Raw protobuf Message (snake_case keys)
	 * @param options Relay options
	 */
	relayMessage: async (jid: string, message: WAProto.IMessage, options: MessageRelayOptions): Promise<string> => {
		const client = await ctx.getClient()
		const plan = planMessageRelay(jid, options, ctx.getUser())
		ctx.logger.debug(
			{
				jid,
				kind: plan.kind,
				messageId: plan.messageId,
				extraNodes: plan.kind === 'retransmission' ? 0 : plan.nodes.length
			},
			'relayMessage compatibility plan'
		)

		// The message goes to the bridge as the caller built it: the core settles
		// messageSecret / reportingTokenVersion itself, reusing a caller-set secret
		// rather than replacing it, so nothing here has to be dropped.
		const bytes = encodeProtoCompat('Message', message)
		if (plan.kind === 'retransmission') {
			await client.retransmitMessageBytes(jid, bytes, plan.input)
			return plan.messageId
		}

		// Both sends go through the same retry: a caller node the engine derives
		// is refused the same way whether the message is bound for a chat or for
		// status, and the escape hatch — a node it does not derive — survives
		// either way.
		const drop = (tag: string) =>
			ctx.logger.debug(
				{ jid, messageId: plan.messageId, tag },
				'dropped an additionalNodes entry the engine derives from the message'
			)

		if (plan.kind === 'status') {
			return sendReportingUpstreamFailure(() =>
				sendDroppingDerivedNodes(
					plan.nodes,
					nodes =>
						client.sendStatusMessageBytesWithOptions(
							bytes,
							plan.recipients,
							plan.messageId,
							nodes,
							plan.refreshDevices
						),
					drop
				)
			)
		}

		return sendReportingUpstreamFailure(() =>
			sendDroppingDerivedNodes(
				plan.nodes,
				nodes =>
					client.relayMessageBytesWithOptions(
						jid,
						bytes,
						plan.messageId,
						nodes,
						plan.refreshGroupMetadata,
						plan.refreshDevices
					),
				drop
			)
		)
	},

	readMessages: async (keys: WAMessageKey[]) => {
		const receiptKeys = receiptMessageKeys(keys)
		if (receiptKeys.length) await (await ctx.getClient()).readMessages(receiptKeys)
	},

	/**
	 * Send a receipt for messages. The bridge handles most receipt types automatically
	 * (delivered, sender). Use `readMessages` for the common case of sending read receipts.
	 *
	 * Supported types via bridge: 'read', 'read-self', 'played'
	 * Auto-handled by bridge: 'sender', 'inactive', undefined (delivered)
	 * Not supported: 'hist_sync', 'peer_msg' (logged as warning)
	 */
	sendReceipt: async (jid: string, participant: string | undefined, messageIds: string[], type: MessageReceiptType) => {
		// Ahead of the empty-list exit: the types this method handles elsewhere
		// resolve without sending anything, so a typo looked like a no-op.
		assertArgumentDomain('sendReceipt', 'type', type, MESSAGE_RECEIPT_TYPES)
		if (!messageIds.length) return

		if (type === 'read' || type === 'read-self') {
			const keys = messageIds.map(id => ({
				remoteJid: jid,
				id,
				...(participant ? { participant } : {})
			}))
			await (await ctx.getClient()).readMessages(keys)
		} else if (type === 'played') {
			// Voice/video-note played receipts. The bridge (and core) pick the wire
			// type (`played` vs `played-self` for newsletters) and the `participant`
			// attr from the chat jid, so we just hand over the keys — same shape as
			// readMessages.
			const keys = messageIds.map(id => ({
				remoteJid: jid,
				id,
				...(participant ? { participant } : {})
			}))
			await (await ctx.getClient()).markPlayed(keys)
		} else {
			// delivered/sender/inactive receipts are sent automatically by the Rust bridge
			// hist_sync/peer_msg require bridge-side support
			ctx.logger.debug(
				{ type, jid, count: messageIds.length },
				'sendReceipt: type handled automatically by bridge or not yet supported'
			)
		}
	},

	/**
	 * Send receipts for multiple message keys, grouped by JID and participant.
	 */
	sendReceipts: async (keys: WAMessageKey[], type: MessageReceiptType) => {
		assertArgumentDomain('sendReceipts', 'type', type, MESSAGE_RECEIPT_TYPES)
		const client = await ctx.getClient()
		const receiptKeys = receiptMessageKeys(keys)

		if (type === 'read' || type === 'read-self') {
			if (receiptKeys.length) {
				await client.readMessages(receiptKeys)
			}
		} else if (type === 'played') {
			if (receiptKeys.length) {
				await client.markPlayed(receiptKeys)
			}
		} else {
			ctx.logger.debug(
				{ type, count: keys.length },
				'sendReceipts: type handled automatically by bridge or not yet supported'
			)
		}
	},

	/**
	 * Request resend of a placeholder message via PeerDataOperationRequest.
	 * Wraps the request in a protocolMessage and relays it to the chat.
	 */
	requestPlaceholderResend: async (
		messageKey: WAMessageKey,
		msgData?: Partial<WAMessage>
	): Promise<string | undefined> => {
		void msgData
		const message: WAProto.IMessage = {
			protocolMessage: {
				peerDataOperationRequestMessage: {
					peerDataOperationRequestType: WAProto.Message.PeerDataOperationRequestType.PLACEHOLDER_MESSAGE_RESEND,
					placeholderMessageResendRequest: [{ messageKey }]
				},
				type: WAProto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
			}
		}

		const bytes = encodeProtoCompat('Message', message)
		return (await ctx.getClient()).relayMessageBytes(messageKey.remoteJid!, bytes, null)
	}
})
