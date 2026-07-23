import type { WAMessage, WAMessageKey } from '../Types/index.ts'
import { WAMessageStubType } from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { decryptEventResponsePayload, decryptPollVotePayload } from 'whatsapp-rust-bridge'
import {
	areJidsSameUser,
	isHostedLidUser,
	isHostedPnUser,
	isJidBroadcast,
	isJidStatusBroadcast,
	jidDecode,
	jidEncode,
	jidNormalizedUser
} from '../WABinary/index.ts'
import { Boom } from './boom.ts'
import { getContentType, normalizeMessageContent } from './messages.ts'

const REAL_MSG_STUB_TYPES = new Set([
	WAMessageStubType.CALL_MISSED_GROUP_VIDEO,
	WAMessageStubType.CALL_MISSED_GROUP_VOICE,
	WAMessageStubType.CALL_MISSED_VIDEO,
	WAMessageStubType.CALL_MISSED_VOICE
])

const REAL_MSG_REQ_ME_STUB_TYPES = new Set([WAMessageStubType.GROUP_PARTICIPANT_ADD])

/** Whether an envelope carries user-visible content rather than a control message. */
export const isRealMessage = (message: WAMessage): boolean => {
	const normalizedContent = normalizeMessageContent(message.message)
	const hasSomeContent = !!getContentType(normalizedContent)
	return (
		(!!normalizedContent ||
			REAL_MSG_STUB_TYPES.has(message.messageStubType!) ||
			REAL_MSG_REQ_ME_STUB_TYPES.has(message.messageStubType!)) &&
		hasSomeContent &&
		!normalizedContent?.protocolMessage &&
		!normalizedContent?.reactionMessage &&
		!normalizedContent?.pollUpdateMessage
	)
}

export const shouldIncrementChatUnread = (message: WAMessage): boolean =>
	!message.key.fromMe && !message.messageStubType

const normalizeMessageJid = (jid: string | null | undefined): string | undefined => {
	if (!jid) return undefined

	const hostedPn = isHostedPnUser(jid)
	if (!hostedPn && !isHostedLidUser(jid)) return jidNormalizedUser(jid)

	const user = jidDecode(jid)?.user
	return user ? jidEncode(user, hostedPn ? 's.whatsapp.net' : 'lid') : jidNormalizedUser(jid)
}

/** Normalize device/hosted JIDs and nested reaction/poll keys in place. */
export const cleanMessage = (message: WAMessage, meId: string, meLid: string) => {
	message.key.remoteJid = normalizeMessageJid(message.key.remoteJid)
	message.key.participant = normalizeMessageJid(message.key.participant)

	const content = normalizeMessageContent(message.message)
	if (content?.reactionMessage) normaliseKey(content.reactionMessage.key!)
	if (content?.pollUpdateMessage) normaliseKey(content.pollUpdateMessage.pollCreationMessageKey!)

	function normaliseKey(msgKey: WAMessageKey) {
		if (!message.key.fromMe) {
			msgKey.fromMe = !msgKey.fromMe
				? areJidsSameUser(msgKey.participant || msgKey.remoteJid!, meId) ||
					areJidsSameUser(msgKey.participant || msgKey.remoteJid!, meLid)
				: false
			msgKey.remoteJid = message.key.remoteJid
			msgKey.participant ||= message.key.participant
		}
	}
}

/** Return the conversation JID represented by a message key. */
export const getChatId = ({ remoteJid, participant, fromMe }: WAMessageKey): string => {
	if (!remoteJid) {
		throw new Boom('Cannot derive chat id: message key is missing remoteJid', {
			data: { remoteJid, participant, fromMe }
		})
	}
	if (isJidBroadcast(remoteJid) && !isJidStatusBroadcast(remoteJid) && !fromMe) {
		if (!participant) {
			throw new Boom('Cannot derive chat id: broadcast message key is missing participant', {
				data: { remoteJid, fromMe }
			})
		}
		return participant
	}
	return remoteJid
}

type PollContext = {
	pollCreatorJid: string
	pollMsgId: string
	pollEncKey: Uint8Array
	voterJid: string
}

type EventContext = {
	eventCreatorJid: string
	eventMsgId: string
	eventEncKey: Uint8Array
	responderJid: string
}

export function decryptPollVote(
	{ encPayload, encIv }: proto.Message.IPollEncValue,
	{ pollCreatorJid, pollMsgId, pollEncKey, voterJid }: PollContext
) {
	return proto.Message.PollVoteMessage.decode(
		decryptPollVotePayload(encPayload!, encIv!, pollEncKey, pollMsgId, pollCreatorJid, voterJid)
	)
}

export function decryptEventResponse(
	{ encPayload, encIv }: proto.Message.IPollEncValue,
	{ eventCreatorJid, eventMsgId, eventEncKey, responderJid }: EventContext
) {
	return proto.Message.EventResponseMessage.decode(
		decryptEventResponsePayload(encPayload!, encIv!, eventEncKey, eventMsgId, eventCreatorJid, responderJid)
	)
}
