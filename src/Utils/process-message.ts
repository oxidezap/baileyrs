import type { WAMessage, WAMessageKey } from '../Types/index.ts'
import { WAMessageStubType } from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { decryptEventResponsePayload, decryptPollVotePayload } from '@oxidezap/whatsapp-rust-bridge'
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

/**
 * WhatsApp Web's rules, which upstream Baileys does not always follow.
 *
 * **A field with nothing to normalise stays absent.** `WAWebMsgKey` only assigns
 * the participant it was given — `h !== void 0 && (this.participant = h)` — and
 * builds the message's identity by joining the parts that are present, so an
 * empty string there would change what the key serialises to. Upstream runs
 * every field through `jidNormalizedUser`, which answers `''` for a jid it was
 * not given, and so writes `participant: ''` onto every direct-message key.
 * Matching that would mean copying a bug into the key handed back to callers.
 *
 * **A hosted jid is re-encoded onto its plain server**, and the fallback that
 * used to keep `@hosted` when the user part was empty is gone. WA Web accepts
 * hosted only as `<digits>:99@hosted` (`WAWebWidValidator`), and every jid that
 * reached the old fallback is one it rejects outright — so there is no
 * behaviour to preserve there, and agreeing with upstream costs nothing. Valid
 * hosted jids already agreed.
 */
const normalizeMessageJid = (jid: string | null | undefined): string | undefined => {
	if (!jid) return undefined

	const hostedPn = isHostedPnUser(jid)
	if (!hostedPn && !isHostedLidUser(jid)) return jidNormalizedUser(jid)

	return jidEncode(jidDecode(jid)?.user ?? null, hostedPn ? 's.whatsapp.net' : 'lid')
}

/** Normalize device/hosted JIDs and nested reaction/poll keys in place. */
export const cleanMessage = (message: WAMessage, meId: string, meLid: string) => {
	// Normalise the fields that are there; do not add the ones that are not.
	//
	// Writing the result unconditionally put the property on the key even when
	// there was nothing to normalise, so a direct-message key — which carries no
	// participant — still gained one holding `undefined`, and `Object.keys` and a
	// spread saw it. `WAWebMsgKey` assigns the participant it was given and
	// leaves the key without one otherwise, and that absence is load-bearing
	// there: it joins the parts that are present into the id the message is
	// stored under.
	//
	// A field the caller did provide is normalised even when it comes back with
	// nothing, which is the empty string upstream writes — they provided it, so
	// it is theirs to have normalised, and leaving a `null` in place would only
	// swap one falsy spelling for another.
	for (const field of ['remoteJid', 'participant'] as const) {
		if (!Object.hasOwn(message.key, field) && message.key[field] == null) continue
		message.key[field] = normalizeMessageJid(message.key[field]) ?? ''
	}

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
