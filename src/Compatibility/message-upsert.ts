import type { BaileysEventMap, WAMessage } from '../Types/index.ts'
import type { SocketContext } from '../Socket/types.ts'

type MessageUpsert = BaileysEventMap['messages.upsert']

export interface MessageUpsertMetadata {
	type: MessageUpsert['type']
	requestId?: string
}

/** Emit one canonical public message-upsert payload from any socket path. */
export const emitMessageUpsert = (ctx: SocketContext, messages: WAMessage[], metadata: MessageUpsertMetadata): void => {
	const payload: MessageUpsert = { messages, type: metadata.type }
	if (metadata.requestId) payload.requestId = metadata.requestId
	ctx.ev.emit('messages.upsert', payload)
}
