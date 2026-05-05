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

import type { proto } from 'whatsapp-rust-bridge/proto-types'
import type { Chat, Contact, LIDMapping, WAMessage } from '../Types/index.ts'
import { WAProto } from '../Types/index.ts'
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser } from '../WABinary/jid-utils.ts'
import { toNumber } from './generics.ts'

const STUB = WAProto.WebMessageInfo.StubType

const extractPnFromMessages = (messages: proto.IHistorySyncMsg[]): string | undefined => {
	for (const msgItem of messages) {
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
	syncType?: number
	progress?: number
}

/**
 * Walk a decoded HistorySync proto and extract the upstream
 * `messaging-history.set` payload. Mirrors upstream's behavior exactly,
 * including the side-effect of removing `chat.messages` (kept only as a
 * 1-element preview after the walk).
 */
export const processHistoryMessage = (item: proto.IHistorySync): ProcessedHistorySync => {
	const messages: WAMessage[] = []
	const contacts: Contact[] = []
	const chats: Chat[] = []
	const lidPnMappings: LIDMapping[] = []

	// LID-PN mappings flow on every sync type.
	for (const m of item.phoneNumberToLidMappings || []) {
		if (m.lidJid && m.pnJid) lidPnMappings.push({ lid: m.lidJid, pn: m.pnJid })
	}

	const syncType = item.syncType ?? undefined

	switch (syncType) {
		case WAProto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP:
		case WAProto.HistorySync.HistorySyncType.RECENT:
		case WAProto.HistorySync.HistorySyncType.FULL:
		case WAProto.HistorySync.HistorySyncType.ON_DEMAND: {
			for (const conversation of item.conversations || []) {
				// `Conversation` is widened to `Chat` because upstream's
				// definition treats them as compatible — the runtime shape
				// matches.
				const chat = conversation as Chat
				contacts.push({
					id: chat.id!,
					name: chat.displayName || chat.name || chat.username || undefined,
					username: chat.username || undefined,
					lid: chat.lidJid || chat.accountLid || undefined,
					phoneNumber: chat.pnJid || undefined
				})

				const chatId = chat.id!
				const isLid = isLidUser(chatId) || isHostedLidUser(chatId)
				const isPn = isPnUser(chatId) || isHostedPnUser(chatId)
				if (isLid && chat.pnJid) {
					lidPnMappings.push({ lid: chatId, pn: chat.pnJid })
				} else if (isPn && chat.lidJid) {
					lidPnMappings.push({ lid: chat.lidJid, pn: chatId })
				} else if (isLid && !chat.pnJid) {
					// Fallback: pull PN from a userReceipt on a fromMe message
					// in this chat. Empty when the chat has no fromMe history.
					const pnFromReceipt = extractPnFromMessages(chat.messages || [])
					if (pnFromReceipt) lidPnMappings.push({ lid: chatId, pn: pnFromReceipt })
				}

				const msgs = chat.messages || []
				// Upstream mutates the chat in place: drops the full message
				// list, keeps only the latest as a preview. Consumers that
				// keyed off `chat.messages` for full history previously broke
				// after this call too — that's the upstream contract.
				delete chat.messages

				for (const histMsg of msgs) {
					const message = histMsg.message as WAMessage | undefined
					if (!message) continue
					messages.push(message)

					if (!chat.messages?.length) {
						chat.messages = [{ message }]
					}

					if (!message.key?.fromMe && !chat.lastMessageRecvTimestamp) {
						chat.lastMessageRecvTimestamp = toNumber(message.messageTimestamp)
					}

					// Extract verifiedName side-channel when WhatsApp sent a
					// privacy-mode stub for the participant.
					if (
						(message.messageStubType === STUB.BIZ_PRIVACY_MODE_TO_BSP ||
							message.messageStubType === STUB.BIZ_PRIVACY_MODE_TO_FB) &&
						message.messageStubParameters?.[0]
					) {
						contacts.push({
							id: message.key.participant || message.key.remoteJid!,
							verifiedName: message.messageStubParameters[0]
						})
					}
				}

				chats.push(chat)
			}
			break
		}
		case WAProto.HistorySync.HistorySyncType.PUSH_NAME: {
			for (const c of item.pushnames || []) {
				if (c.id) contacts.push({ id: c.id, notify: c.pushname || undefined })
			}
			break
		}
		// NON_BLOCKING_DATA / STATUS_V3 / etc. fall through with empty
		// arrays — upstream behaves the same.
	}

	return {
		chats,
		contacts,
		messages,
		lidPnMappings,
		syncType,
		progress: item.progress ?? undefined
	}
}
