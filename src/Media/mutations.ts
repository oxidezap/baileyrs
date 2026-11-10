/**
 * Portable message-mutation helpers for the event buffer.
 *
 * `updateMessageWithReceipt` / `updateMessageWithReaction` move verbatim
 * from `Utils/messages.ts` so `Utils/event-buffer.ts` (in the host graph)
 * no longer pulls the send path, the media pipeline, or any `node:`
 * import. `getKeyAuthor` is a two-line pure helper, duplicated here rather
 * than importing `Utils/generics.ts` (which is Node-bound).
 */

import type { WAMessage, MessageUserReceipt } from '../Types/index.ts'
import type { proto } from '../WAProto/runtime.ts'

/** Resolve the upstream-visible author identity, preferring alternate addressing fields. */
export const getKeyAuthor = (key: WAMessage['key'] | undefined | null, meId = 'me') =>
	(key?.fromMe ? meId : key?.participantAlt || key?.remoteJidAlt || key?.participant || key?.remoteJid) || ''

/** Remove undefined own properties in place, matching upstream Baileys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trimUndefined(obj: { [key: string]: any }) {
	for (const key in obj) {
		if (obj[key] === undefined) delete obj[key]
	}
	return obj
}

/** Upsert one receipt into a message's `userReceipt` collection. */
export const updateMessageWithReceipt = (msg: Pick<WAMessage, 'userReceipt'>, receipt: MessageUserReceipt): void => {
	msg.userReceipt = msg.userReceipt || []
	const existing = msg.userReceipt.find(item => item.userJid === receipt.userJid)
	if (existing) Object.assign(existing, receipt)
	else msg.userReceipt.push(receipt)
}

/** Replace the previous reaction from the same author, then append the latest. */
export const updateMessageWithReaction = (msg: Pick<WAMessage, 'reactions'>, reaction: proto.IReaction): void => {
	const author = getKeyAuthor(reaction.key || {})
	const reactions = (msg.reactions || []).filter(item => getKeyAuthor(item.key || {}) !== author)
	reaction.text = reaction.text || ''
	reactions.push(reaction)
	msg.reactions = reactions
}
