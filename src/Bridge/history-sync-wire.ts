import { BinaryReader, type HistorySyncWireBatch, type WhatsAppEvent } from 'whatsapp-rust-bridge'
import { proto as WAProto } from 'whatsapp-rust-bridge/proto-types'
import type { ILogger } from '../Utils/logger.ts'
import { isConversationHistorySync } from '../Utils/process-history-message.ts'
import { createSparseArray } from '../Utils/sparse-array.ts'

const HISTORY_SYNC_EVENT_TYPE = 'history_sync' as const

export interface DecodedHistorySyncWireBatch {
	event: Extract<WhatsAppEvent, { type: typeof HISTORY_SYNC_EVENT_TYPE }>
	skippedConversations: number
}

/**
 * Decode bridge-framed conversation protobufs directly into the JS objects
 * consumed by baileyrs. The bridge owns only bounded inflate/framing; all
 * Baileys-specific normalization remains on this side of the boundary.
 */
export const decodeHistorySyncWireBatch = (
	batch: HistorySyncWireBatch,
	logger: ILogger
): DecodedHistorySyncWireBatch => {
	const wireData = batch.conversationData
	const wireOffsets = batch.conversationOffsets
	const shouldDecodeConversations = isConversationHistorySync(batch.syncType)
	const conversationCount = Math.max(0, wireOffsets.length - 1)
	const conversations = shouldDecodeConversations
		? createSparseArray<ReturnType<typeof WAProto.Conversation.decode>>(conversationCount)
		: []
	let decodedConversations = 0
	let skippedConversations = 0

	if (shouldDecodeConversations) {
		const reader = new BinaryReader(wireData)
		for (let index = 0; index < conversationCount; index++) {
			try {
				const start = wireOffsets[index]!
				const end = wireOffsets[index + 1]!
				reader.pos = start
				const conversation = WAProto.Conversation.decode(reader, end - start)
				conversations[decodedConversations++] = conversation
			} catch (err) {
				skippedConversations++
				logger.warn({ err, index }, 'skipping malformed history-sync conversation')
			}
		}
	}
	conversations.length = decodedConversations

	const { conversationData: _wireData, conversationOffsets: _wireOffsets, ...data } = batch
	data.conversations = conversations
	return {
		event: { type: HISTORY_SYNC_EVENT_TYPE, data },
		skippedConversations
	}
}
