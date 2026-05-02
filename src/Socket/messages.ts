import { encodeProto } from 'whatsapp-rust-bridge'
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
import { unixTimestampSeconds } from '../Utils/generics.ts'
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
 */
export function stripContextInfoForBridge(msg: WAMessageContent): void {
	const contentType = getContentType(msg)
	const pinAddOnDuration =
		contentType === 'pinInChatMessage' ? msg.messageContextInfo?.messageAddOnDurationInSecs : undefined
	delete (msg as Record<string, unknown>).messageContextInfo
	if (pinAddOnDuration !== undefined && pinAddOnDuration !== null) {
		msg.messageContextInfo = { messageAddOnDurationInSecs: pinAddOnDuration }
	}
}

export const makeMessageMethods = (ctx: SocketContext) => ({
	sendMessage: async (
		jid: string,
		content: AnyMessageContent,
		options?: Omit<MessageGenerationOptions, 'waClient' | 'logger' | 'userJid' | 'mediaInNote'>
	): Promise<WAMessage | undefined> => {
		const client = await ctx.getClient()
		const user = ctx.getUser()
		const userJid = user?.id ? jidNormalizedUser(user.id) : ''

		const fullMsg = await generateWAMessage(jid, content, {
			...ctx.fullConfig,
			...options,
			logger: ctx.logger,
			userJid,
			waClient: client
		})

		const msg = normalizeMessageContent(fullMsg.message)
		if (!msg) throw new Boom('Failed to generate message content', { statusCode: 400 })

		const contentType = getContentType(msg)

		if (contentType === 'protocolMessage') {
			const protoMsg = msg.protocolMessage
			if (protoMsg?.type === WAProto.Message.ProtocolMessage.Type.REVOKE && protoMsg?.key?.id) {
				await client.revokeMessage(jid, protoMsg.key.id)
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

		stripContextInfoForBridge(msg)

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
	 * Returns a {@link WAMessage} envelope (matching upstream Baileys' shape) so
	 * callers can do `const msg = await relayMessage(...)` and forward `msg.key`
	 * to subsequent operations. The returned `key.id` is the server-assigned id.
	 *
	 * @param jid Recipient JID
	 * @param message Raw protobuf Message (snake_case keys)
	 * @param options Relay options (messageId, statusJidList)
	 */
	relayMessage: async (
		jid: string,
		message: WAProto.IMessage,
		{ messageId, statusJidList }: MessageRelayOptions = {}
	): Promise<WAMessage> => {
		const client = await ctx.getClient()
		const user = ctx.getUser()
		const userJid = user?.id ? jidNormalizedUser(user.id) : undefined

		stripContextInfoForBridge(message as WAMessageContent)

		const bytes = encodeProto('Message', message)
		const id =
			jid === 'status@broadcast' && statusJidList?.length
				? await client.sendStatusMessageBytes(bytes, statusJidList)
				: await client.relayMessageBytes(jid, bytes, messageId ?? null)

		return {
			key: {
				id,
				remoteJid: jid,
				fromMe: true,
				...(userJid ? { participant: userJid } : {})
			},
			message,
			messageTimestamp: unixTimestampSeconds()
		} as WAMessage
	},

	readMessages: async (keys: { remoteJid: string; id: string; participant?: string }[]) => {
		await (await ctx.getClient()).readMessages(keys)
	},

	/**
	 * Send a receipt for messages. The bridge handles most receipt types automatically
	 * (delivered, sender). Use `readMessages` for the common case of sending read receipts.
	 *
	 * Supported types via bridge: 'read', 'read-self'
	 * Auto-handled by bridge: 'sender', 'inactive', undefined (delivered)
	 * Not supported: 'played', 'hist_sync', 'peer_msg' (logged as warning)
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
		} else {
			// delivered/sender/inactive receipts are sent automatically by the Rust bridge
			// played/hist_sync/peer_msg require bridge-side support
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

		if (type === 'read' || type === 'read-self') {
			const readKeys = keys
				.filter(k => !k.fromMe && k.remoteJid && k.id)
				.map(k => ({ remoteJid: k.remoteJid!, id: k.id!, ...(k.participant ? { participant: k.participant } : {}) }))
			if (readKeys.length) {
				await client.readMessages(readKeys)
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
		_msgData?: Partial<WAMessage>
	): Promise<string | undefined> => {
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
