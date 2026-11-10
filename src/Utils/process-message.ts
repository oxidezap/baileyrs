/** Node-facing message helpers; crypto defaults to the auto-initializing bridge root. */
import { decryptEventResponsePayload, decryptPollVotePayload } from '@oxidezap/whatsapp-rust-bridge'
import {
	cleanMessage,
	decryptEventResponse as decryptEventResponseCore,
	decryptPollVote as decryptPollVoteCore,
	getChatId,
	isRealMessage,
	shouldIncrementChatUnread,
	type MessageCryptoRuntime
} from './process-message-core.ts'

const nodeCrypto: MessageCryptoRuntime = { decryptPollVotePayload, decryptEventResponsePayload }

export { cleanMessage, getChatId, isRealMessage, shouldIncrementChatUnread }
export const decryptPollVote = (
	...args: [Parameters<typeof decryptPollVoteCore>[0], Parameters<typeof decryptPollVoteCore>[1]]
) => decryptPollVoteCore(args[0], args[1], nodeCrypto)
export const decryptEventResponse = (
	...args: [Parameters<typeof decryptEventResponseCore>[0], Parameters<typeof decryptEventResponseCore>[1]]
) => decryptEventResponseCore(args[0], args[1], nodeCrypto)
