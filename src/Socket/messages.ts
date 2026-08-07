import { encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { planMessageRelay } from '../Compatibility/message-relay.ts'
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
import { WAProto } from '../Types/index.ts'
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

/**
 * Drop `messageContextInfo` before handing the proto to the Rust bridge so the
 * bridge can fill in its own `messageSecret` / `reportingTokenVersion`.
 *
 * Exception: pin messages need `messageAddOnDurationInSecs` (86400 / 604800 /
 * 2592000 to pin, 0 to unpin). The bridge does not set this field, so we save
 * it across the delete and restore it on a fresh contextInfo.
 *
 * Mutates `msg` in place.
 *
 * `contentType` is a parameter so the send path can hand over the type it has
 * already resolved rather than have it scanned out of `msg` a second time.
 */
export function stripContextInfoForBridge(msg: WAMessageContent, contentType = getContentType(msg)): void {
	const pinAddOnDuration =
		contentType === 'pinInChatMessage' ? msg.messageContextInfo?.messageAddOnDurationInSecs : undefined
	delete (msg as Record<string, unknown>).messageContextInfo
	if (pinAddOnDuration !== undefined && pinAddOnDuration !== null) {
		msg.messageContextInfo = { messageAddOnDurationInSecs: pinAddOnDuration }
	}
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
				const newMsgId = await client.editMessageBytes(jid, protoMsg.key.id, editBytes)
				fullMsg.key.id = newMsgId || fullMsg.key.id
				return fullMsg
			}
		}

		stripContextInfoForBridge(msg, contentType)

		let msgId: string
		const msgBytes = encodeProto('Message', msg as Record<string, unknown>)
		if (jid === 'status@broadcast' && options?.statusJidList?.length) {
			msgId = await client.sendStatusMessageBytes(msgBytes, options.statusJidList)
		} else {
			msgId = await client.sendMessageBytes(jid, msgBytes)
		}

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

		stripContextInfoForBridge(message as WAMessageContent)

		const bytes = encodeProto('Message', message)
		if (plan.kind === 'retransmission') {
			await client.retransmitMessageBytes(jid, bytes, plan.input)
			return plan.messageId
		}

		if (plan.kind === 'status') {
			return client.sendStatusMessageBytesWithOptions(
				bytes,
				plan.recipients,
				plan.messageId,
				plan.nodes,
				plan.refreshDevices
			)
		}

		return client.relayMessageBytesWithOptions(
			jid,
			bytes,
			plan.messageId,
			plan.nodes,
			plan.refreshGroupMetadata,
			plan.refreshDevices
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

		const bytes = encodeProto('Message', message)
		return (await ctx.getClient()).relayMessageBytes(messageKey.remoteJid!, bytes, null)
	}
})
