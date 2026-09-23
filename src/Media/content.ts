/**
 * Portable message-content helpers: content-type detection and envelope
 * normalization (ephemeral / view-once / template unwrapping).
 *
 * Extracted verbatim from `Utils/messages.ts` (`getContentType`,
 * `normalizeMessageContent` + its private helpers) so the event pipeline
 * (`Utils/process-message.ts`, `Socket/events.ts`) can run on hosts without
 * pulling the send path, the media pipeline, or any `node:` import. No
 * behavioral change: the differential suite pins both functions against
 * the originals.
 */

import type { WAMessageContent } from '../Types/index.ts'
import type { proto } from '../WAProto/runtime.ts'

/**
 * The content keys that carry almost every message on a live socket, settled by
 * identity before the structural predicate runs. Every name here already
 * satisfies that predicate, so this only shortcuts the substring scan; it never
 * changes which key wins.
 */
const isCommonContentKey = (key: string) => {
	switch (key) {
		case 'conversation':
		case 'extendedTextMessage':
		case 'imageMessage':
		case 'videoMessage':
		case 'audioMessage':
		case 'stickerMessage':
		case 'documentMessage':
		case 'reactionMessage':
		case 'protocolMessage':
		case 'pollCreationMessage':
			return true
		default:
			return false
	}
}

/** Get the key to access the true type of content */
export const getContentType = (content: proto.IMessage | undefined) => {
	if (!content) {
		return undefined
	}

	// The answer stays positional (the first own key naming content wins), but
	// the scan is an indexed loop with an early return instead of `Array.find`,
	// so no closure is allocated and the common keys never reach `includes`.
	//
	// Deliberately still `Object.keys` and not `for..in`: a decoded
	// `WAProto.Message` inherits a default for every field of the schema, so
	// `for..in` would enumerate ~100 prototype keys per call (and would have to
	// filter them back out with `hasOwn` to stay positional) where `Object.keys`
	// yields only the handful that were actually set.
	const keys = Object.keys(content)
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!
		if (isCommonContentKey(key)) {
			return key as keyof typeof content
		}

		if (key.includes('Message') && key !== 'senderKeyDistributionMessage') {
			return key as keyof typeof content
		}
	}

	return undefined
}

const getFutureProofMessage = (message: WAMessageContent | null | undefined) =>
	message?.ephemeralMessage ||
	message?.viewOnceMessage ||
	message?.documentWithCaptionMessage ||
	message?.viewOnceMessageV2 ||
	message?.viewOnceMessageV2Extension ||
	message?.editedMessage ||
	message?.associatedChildMessage ||
	message?.groupStatusMessage ||
	message?.groupStatusMessageV2

const extractFromTemplateMessage = (
	msg: proto.Message.TemplateMessage.IHydratedFourRowTemplate | proto.Message.IButtonsMessage
) => {
	if (msg.imageMessage) {
		return { imageMessage: msg.imageMessage }
	} else if (msg.documentMessage) {
		return { documentMessage: msg.documentMessage }
	} else if (msg.videoMessage) {
		return { videoMessage: msg.videoMessage }
	} else if (msg.locationMessage) {
		return { locationMessage: msg.locationMessage }
	} else {
		return {
			conversation: 'contentText' in msg ? msg.contentText : 'hydratedContentText' in msg ? msg.hydratedContentText : ''
		}
	}
}

/**
 * Normalizes ephemeral, view once messages to regular message content
 * Eg. image messages in ephemeral messages, in view once messages etc.
 * @param content
 * @returns
 */
export const normalizeMessageContent = (content: WAMessageContent | null | undefined): WAMessageContent | undefined => {
	if (!content) {
		return undefined
	}

	// set max iterations to prevent an infinite loop
	for (let i = 0; i < 5; i++) {
		const inner = getFutureProofMessage(content)
		if (!inner) {
			break
		}

		content = inner.message
	}

	return content!
}

/**
 * Extract the true message content from a message
 * Eg. extracts the inner message from a disappearing message/view once message
 */
export const extractMessageContent = (content: WAMessageContent | undefined | null): WAMessageContent | undefined => {
	content = normalizeMessageContent(content)

	if (content?.buttonsMessage) {
		return extractFromTemplateMessage(content.buttonsMessage)
	}

	if (content?.templateMessage?.hydratedFourRowTemplate) {
		return extractFromTemplateMessage(content?.templateMessage?.hydratedFourRowTemplate)
	}

	if (content?.templateMessage?.hydratedTemplate) {
		return extractFromTemplateMessage(content?.templateMessage?.hydratedTemplate)
	}

	if (content?.templateMessage?.fourRowTemplate) {
		return extractFromTemplateMessage(content?.templateMessage?.fourRowTemplate)
	}

	return content
}
