import type { NewChatMessageCapInfo } from '../Types/index.ts'

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** Locate the public capping payload inside the neutral MEX response wrapper. */
export const extractMessageCappingPayload = (value: unknown): NewChatMessageCapInfo | null => {
	const root = asRecord(value)
	if (!root) return null
	const data = asRecord(root.data) ?? root
	const nested = asRecord(data.xwa2_notify_new_chat_messages_capping_info_update)
	if (nested) return nested as NewChatMessageCapInfo

	// Also accept an already-extracted payload for bridge callers that strip the
	// GraphQL data wrapper before dispatching the neutral MEX notification.
	if (
		'total_quota' in root ||
		'used_quota' in root ||
		'capping_status' in root ||
		'mv_status' in root ||
		'ote_status' in root
	) {
		return root as NewChatMessageCapInfo
	}
	return null
}
