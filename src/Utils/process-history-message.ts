/** Node-facing history helpers. The portable walk lives in the core module. */
import { inflateZlib } from '@oxidezap/whatsapp-rust-bridge'
import { Buffer } from 'node:buffer'
import { proto } from '../WAProto/runtime.ts'
import { downloadContentFromMessage } from './messages.ts'
import { normalizeMessageContent } from '../Media/content.ts'
import type { ILogger } from './logger.ts'
import {
	CONVERSATION_HISTORY_SYNC_TYPES,
	isConversationHistorySync,
	processHistoryMessage,
	type ProcessedHistorySync
} from './process-history-message-core.ts'

export { CONVERSATION_HISTORY_SYNC_TYPES, isConversationHistorySync, processHistoryMessage }
export type { ProcessedHistorySync }

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
/** Extract a history-sync notification through the upstream-compatible wrapper. */
export const getHistoryMsg = (message: proto.IMessage): proto.Message.IHistorySyncNotification | undefined => {
	const normalizedContent = message ? normalizeMessageContent(message) : undefined
	return normalizedContent?.protocolMessage?.historySyncNotification ?? undefined
}

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
