/**
 * Port of upstream Baileys' `Utils/history.ts:processHistoryMessage`.
 *
 * Walks a decoded `proto.IHistorySync` and produces the
 * `messaging-history.set` payload (chats, contacts, messages, lidPnMappings).
 * The bridge already decoded the proto for us — this module only handles
 * the structured walk + normalization that upstream consumers expect.
 *
 * 1:1 with upstream (`Baileys/src/Utils/history.ts:47-139`); changes here
 * are limited to swapping upstream imports for baileyrs equivalents and
 * keeping the WAProto namespace as our re-export.
 */

import { inflateZlib } from '@oxidezap/whatsapp-rust-bridge'
import { proto } from '../WAProto/runtime.ts'
import type { Chat, Contact, LIDMapping, WAMessage } from '../Types/index.ts'
import { WAProto } from '../Types/index.ts'
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser } from '../WABinary/jid-utils.ts'
import { Boom } from './boom.ts'
import { toNumber } from './generics.ts'
import type { ILogger } from './logger.ts'
import { downloadContentFromMessage, normalizeMessageContent } from './messages.ts'
import { createSparseArray } from './sparse-array.ts'

const STUB = WAProto.WebMessageInfo.StubType

const extractPnFromMessages = (messages: proto.IHistorySyncMsg[]): string | undefined => {
	for (let index = 0; index < messages.length; index++) {
		const msgItem = messages[index]!
		const message = msgItem.message
		// Only extract from outgoing messages (fromMe: true) in 1:1 chats —
		// userReceipt.userJid is the recipient's JID, so it only makes sense
		// when WE were the sender.
		if (!message?.key?.fromMe || !message.userReceipt?.length) continue
		const userJid = message.userReceipt[0]?.userJid
		if (userJid && (isPnUser(userJid) || isHostedPnUser(userJid))) return userJid
	}
	return undefined
}

export interface ProcessedHistorySync {
	chats: Chat[]
	contacts: Contact[]
	messages: WAMessage[]
	lidPnMappings: LIDMapping[]
	syncType: proto.HistorySync.HistorySyncType | null | undefined
	progress: number | null | undefined
	pastParticipants?: proto.IPastParticipants[] | null
}

/** Sync types whose conversation records are part of the public history payload. */
export const CONVERSATION_HISTORY_SYNC_TYPES: readonly number[] = Object.freeze([
	WAProto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,
	WAProto.HistorySync.HistorySyncType.RECENT,
	WAProto.HistorySync.HistorySyncType.FULL,
	WAProto.HistorySync.HistorySyncType.ON_DEMAND
])

export const isConversationHistorySync = (syncType: number | null | undefined): boolean =>
	syncType != null && CONVERSATION_HISTORY_SYNC_TYPES.includes(syncType)

/**
 * Walk a decoded HistorySync proto and extract the upstream
 * `messaging-history.set` payload. Mirrors upstream's behavior exactly,
 * including the side-effect of removing `chat.messages` (kept only as a
 * 1-element preview after the walk).
 */
export const processHistoryMessage = (item: proto.IHistorySync, logger?: ILogger): ProcessedHistorySync => {
	let messages: WAMessage[] = []
	let contacts: Contact[] = []
	let chats: Chat[] = []
	const sourceMappings = item.phoneNumberToLidMappings || []
	const lidPnMappings = createSparseArray<LIDMapping>(sourceMappings.length)
	let lidPnMappingCount = 0

	// LID-PN mappings flow on every sync type.
	for (let index = 0; index < sourceMappings.length; index++) {
		const m = sourceMappings[index]!
		if (m.lidJid && m.pnJid) lidPnMappings[lidPnMappingCount++] = { lid: m.lidJid, pn: m.pnJid }
	}
	lidPnMappings.length = lidPnMappingCount

	const syncType = item.syncType
	logger?.trace({ progress: item.progress }, 'processing history of type ' + syncType?.toString())

	if (isConversationHistorySync(syncType)) {
		const conversations = item.conversations || []
		let expectedMessages = 0
		for (let index = 0; index < conversations.length; index++) {
			expectedMessages += conversations[index]!.messages?.length || 0
		}

		// History arrives as many small bridge batches. Allocate each result
		// backing store once instead of repeatedly growing it while walking the
		// decoded conversations; invalid entries are compacted by the counters.
		messages = createSparseArray<WAMessage>(expectedMessages)
		contacts = createSparseArray<Contact>(conversations.length)
		chats = createSparseArray<Chat>(conversations.length)
		lidPnMappings.length = lidPnMappingCount + conversations.length
		let messageCount = 0
		let contactCount = 0
		let chatCount = 0

		for (let conversationIndex = 0; conversationIndex < conversations.length; conversationIndex++) {
			const conversation = conversations[conversationIndex]!
			// `Conversation` is widened to `Chat` because upstream's
			// definition treats them as compatible — the runtime shape
			// matches.
			const chat = conversation as Chat
			const chatId = chat.id
			if (!chatId) {
				// Server bug or malformed history blob — skip rather than
				// propagate undefined ids that downstream consumers
				// dereference unconditionally.
				continue
			}
			contacts[contactCount++] = {
				id: chatId,
				name: chat.displayName || chat.name || chat.username || undefined,
				username: chat.username || undefined,
				lid: chat.lidJid || chat.accountLid || undefined,
				phoneNumber: chat.pnJid || undefined
			}

			const isLid = isLidUser(chatId) || isHostedLidUser(chatId)
			const isPn = isPnUser(chatId) || isHostedPnUser(chatId)
			if (isLid && chat.pnJid) {
				lidPnMappings[lidPnMappingCount++] = { lid: chatId, pn: chat.pnJid }
			} else if (isPn && chat.lidJid) {
				lidPnMappings[lidPnMappingCount++] = { lid: chat.lidJid, pn: chatId }
			} else if (isLid && !chat.pnJid) {
				// Fallback: pull PN from a userReceipt on a fromMe message
				// in this chat. Empty when the chat has no fromMe history.
				const pnFromReceipt = extractPnFromMessages(chat.messages || [])
				if (pnFromReceipt) lidPnMappings[lidPnMappingCount++] = { lid: chatId, pn: pnFromReceipt }
			}

			const msgs = chat.messages || []
			// Upstream mutates the chat in place: drops the full message
			// list, keeps only the latest as a preview. Consumers that
			// keyed off `chat.messages` for full history previously broke
			// after this call too — that's the upstream contract.
			delete chat.messages

			for (let messageIndex = 0; messageIndex < msgs.length; messageIndex++) {
				const histMsg = msgs[messageIndex]!
				const message = histMsg.message as WAMessage | undefined
				if (!message) continue
				messages[messageCount++] = message

				if (!chat.messages?.length) {
					// `chat.messages` is typed as `proto.IHistorySyncMsg[]`
					// but we want to store the WAMessage we already
					// extracted. The runtime shape `{ message }` matches
					// IHistorySyncMsg's optional `message` slot — cast is
					// intentional and isolated to this preview-only field.
					chat.messages = [{ message } as never]
				}

				if (!message.key?.fromMe && !chat.lastMessageRecvTimestamp) {
					chat.lastMessageRecvTimestamp = toNumber(message.messageTimestamp)
				}

				// Extract verifiedName side-channel when WhatsApp sent a
				// privacy-mode stub for the participant. Skip when the
				// stub carries no addressable target (defensive — server
				// always populates one of the two slots in practice).
				if (
					(message.messageStubType === STUB.BIZ_PRIVACY_MODE_TO_BSP ||
						message.messageStubType === STUB.BIZ_PRIVACY_MODE_TO_FB) &&
					message.messageStubParameters?.[0]
				) {
					const verifiedNameId = message.key?.participant ?? message.key?.remoteJid
					if (verifiedNameId) {
						contacts[contactCount++] = {
							id: verifiedNameId,
							verifiedName: message.messageStubParameters[0]
						}
					}
				}
			}

			chats[chatCount++] = chat
		}
		messages.length = messageCount
		contacts.length = contactCount
		chats.length = chatCount
		lidPnMappings.length = lidPnMappingCount
	} else if (syncType === WAProto.HistorySync.HistorySyncType.PUSH_NAME) {
		const pushnames = item.pushnames || []
		contacts = createSparseArray<Contact>(pushnames.length)
		let contactCount = 0
		for (let index = 0; index < pushnames.length; index++) {
			const c = pushnames[index]!
			if (c.id) contacts[contactCount++] = { id: c.id, notify: c.pushname || undefined }
		}
		contacts.length = contactCount
	}
	// NON_BLOCKING_DATA / STATUS_V3 / etc. fall through with empty
	// arrays — upstream behaves the same.

	return {
		chats,
		contacts,
		messages,
		lidPnMappings,
		syncType,
		progress: item.progress,
		pastParticipants: item.pastParticipants
	}
}

/** Download, decrypt and inflate an external history-sync blob. */
export const downloadHistory = async (
	msg: proto.Message.IHistorySyncNotification,
	options: RequestInit
): Promise<proto.HistorySync> => {
	const stream = await downloadContentFromMessage(msg, 'md-msg-hist', { options })
	const compressed: Buffer[] = []
	for await (const chunk of stream) compressed.push(chunk as Buffer)
	return proto.HistorySync.decode(inflateZlib(Buffer.concat(compressed)))
}

/** Resolve inline or external history-sync content and normalize its public payload. */
export const downloadAndProcessHistorySyncNotification = async (
	msg: proto.Message.IHistorySyncNotification,
	options: RequestInit,
	logger?: ILogger
): Promise<ProcessedHistorySync> => {
	const historyMsg = msg.initialHistBootstrapInlinePayload
		? proto.HistorySync.decode(inflateZlib(msg.initialHistBootstrapInlinePayload))
		: await downloadHistory(msg, options)

	return processHistoryMessage(historyMsg, logger)
}

/** Extract a history-sync notification through the same wrapper normalization as upstream. */
export const getHistoryMsg = (message: proto.IMessage): proto.Message.IHistorySyncNotification => {
	const normalizedContent = message ? normalizeMessageContent(message) : undefined
	const historySyncNotification = normalizedContent?.protocolMessage?.historySyncNotification
	if (!historySyncNotification) {
		throw new Boom('Message does not contain a history sync notification', { statusCode: 400 })
	}
	return historySyncNotification
}
