import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import type { UploadMediaResult, WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import {
	CALL_AUDIO_PREFIX,
	CALL_VIDEO_PREFIX,
	MEDIA_KEYS,
	type MediaType,
	URL_REGEX,
	WA_DEFAULT_EPHEMERAL
} from '../Defaults/index.ts'
import type {
	AnyMediaMessageContent,
	AnyMessageContent,
	MessageContentGenerationOptions,
	MessageGenerationOptions,
	MessageGenerationOptionsFromContent,
	MessageWithContextInfo,
	WAMediaUpload,
	WAMessage,
	WAMessageContent,
	WATextMessage
} from '../Types/index.ts'
import { WAMessageStatus, WAProto } from '../Types/index.ts'
import { isJidGroup, isJidNewsletter, isJidStatusBroadcast, jidNormalizedUser } from '../WABinary/index.ts'
import { Boom } from './boom.ts'
import { unixTimestampSeconds } from './generics.ts'
import type { ILogger } from './logger.ts'
import {
	generateThumbnail,
	getAudioDuration,
	getAudioWaveform,
	getStream,
	type MediaDownloadOptions,
	toBuffer
} from './messages-media.ts'

type ExtractByKey<T, K extends PropertyKey> = T extends Record<K, unknown> ? T : never
type RequireKey<T, K extends keyof T> = T & {
	[P in K]-?: Exclude<T[P], null | undefined>
}

type WithKey<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? RequireKey<T, K> : never) : never

type MediaUploadData = {
	media: WAMediaUpload
	caption?: string
	ptt?: boolean
	ptv?: boolean
	seconds?: number
	gifPlayback?: boolean
	fileName?: string
	/**
	 * Pre-encoded JPEG thumbnail bytes. Accept `string` (legacy upstream Baileys
	 * shape — base64) so callers migrating from `@whiskeysockets/baileys` keep
	 * compiling; we coerce to `Uint8Array` before handing the value to the
	 * proto encoder, which (unlike protobufjs) does not auto-decode base64.
	 */
	jpegThumbnail?: string | Uint8Array | Buffer
	mimetype?: string
	width?: number
	height?: number
	waveform?: Uint8Array
	backgroundArgb?: number
}

const MIMETYPE_MAP: { [T in MediaType]?: string } = {
	image: 'image/jpeg',
	video: 'video/mp4',
	document: 'application/pdf',
	audio: 'audio/ogg; codecs=opus',
	sticker: 'image/webp',
	'product-catalog-image': 'image/jpeg'
}

const MessageTypeProto = {
	image: WAProto.Message.ImageMessage,
	video: WAProto.Message.VideoMessage,
	audio: WAProto.Message.AudioMessage,
	sticker: WAProto.Message.StickerMessage,
	document: WAProto.Message.DocumentMessage
} as const

/**
 * Uses a regex to test whether the string contains a URL, and returns the URL if it does.
 * @param text eg. hello https://google.com
 * @returns the URL, eg. https://google.com
 */
export const extractUrlFromText = (text: string) => text.match(URL_REGEX)?.[0]

export const generateLinkPreviewIfRequired = async (
	text: string,
	getUrlInfo: MessageGenerationOptions['getUrlInfo'],
	logger: MessageGenerationOptions['logger']
) => {
	if (!getUrlInfo) return
	const url = extractUrlFromText(text)
	if (url) {
		try {
			const urlInfo = await getUrlInfo(url)
			return urlInfo
		} catch (error: unknown) {
			// ignore if fails
			logger?.warn({ trace: (error as Error).stack }, 'url generation failed')
		}
	}
}

const assertColor = (color: number | string): number => {
	if (typeof color === 'number') {
		return color > 0 ? color : 0xffffffff + Number(color) + 1
	}

	let hex = color.trim().replace('#', '')
	if (hex.length <= 6) {
		hex = 'FF' + hex.padStart(6, '0')
	}

	return parseInt(hex, 16)
}

export const prepareWAMessageMedia = async (
	message: AnyMediaMessageContent,
	options: MessageContentGenerationOptions
) => {
	const logger = options.logger

	let mediaType: (typeof MEDIA_KEYS)[number] | undefined
	for (const key of MEDIA_KEYS) {
		if (key in message) {
			mediaType = key
		}
	}

	if (!mediaType) {
		throw new Boom('Invalid media type', { statusCode: 400 })
	}

	const messageRecord = message as Record<string, unknown>
	const uploadData: MediaUploadData = {
		...message,
		media: messageRecord[mediaType] as WAMediaUpload
	}
	delete (uploadData as Record<string, unknown>)[mediaType]
	// check if cacheable + generate cache key
	const cacheableKey =
		typeof uploadData.media === 'object' &&
		'url' in uploadData.media &&
		!!uploadData.media.url &&
		!!options.mediaCache &&
		mediaType + ':' + uploadData.media.url.toString()

	if (mediaType === 'document' && !uploadData.fileName) {
		uploadData.fileName = 'file'
	}

	if (!uploadData.mimetype) {
		uploadData.mimetype = MIMETYPE_MAP[mediaType]
	}

	if (cacheableKey) {
		const mediaBuff = await options.mediaCache!.get<Buffer>(cacheableKey)
		if (mediaBuff) {
			logger?.debug({ cacheableKey }, 'got media cache hit')

			const obj = proto.Message.decode(mediaBuff)
			const key = `${mediaType}Message`

			// `obj[key]` is a discriminated-union slot; cache hits always store
			// a media submessage (not e.g. `conversation: string`), so cast to
			// `object` for `Object.assign`'s benefit.
			Object.assign(obj[key as keyof proto.Message] as object, { ...uploadData, media: undefined })

			return obj
		}
	}

	// Read media into buffer — needed for both upload and metadata extraction
	const { stream } = await getStream(uploadData.media, options.options)
	const buffer = await toBuffer(stream)

	const effectiveMediaType = options.mediaTypeOverride || mediaType

	// Run upload + metadata extraction in parallel
	let uploadResult: UploadMediaResult

	if (options.processMedia) {
		// User-provided processing pipeline (streaming encrypt, custom thumbnails, etc.)
		const { upload, metadata } = await options.processMedia(buffer, effectiveMediaType, options.waClient)
		uploadResult = upload
		if (metadata) {
			if (metadata.jpegThumbnail !== undefined) uploadData.jpegThumbnail = metadata.jpegThumbnail
			if (metadata.width !== undefined) uploadData.width = metadata.width
			if (metadata.height !== undefined) uploadData.height = metadata.height
			if (metadata.seconds !== undefined) uploadData.seconds = metadata.seconds
			if (metadata.waveform !== undefined) uploadData.waveform = metadata.waveform
		}
	} else if (options.upload) {
		// Legacy upstream-Baileys compat: { upload: sock.waUploadToServer }.
		// Same plaintext-in / UploadMediaResult-out contract as waClient.uploadMedia.
		const [result] = await Promise.all([
			options.upload(buffer, { mediaType: effectiveMediaType }),
			extractBuiltInMetadata(buffer, mediaType, uploadData, options)
		])
		uploadResult = result
	} else {
		// Default: in-memory encrypt + upload via Rust, built-in metadata extraction
		const [result] = await Promise.all([
			options.waClient.uploadMedia(buffer, effectiveMediaType),
			extractBuiltInMetadata(buffer, mediaType, uploadData, options)
		])
		uploadResult = result
	}

	// Coerce any string-form `jpegThumbnail` (the legacy upstream Baileys output)
	// into bytes — the bridge's ts-proto encoder reads `.byteLength` directly
	// and throws `invalid uint32: undefined` on strings. Done here (not at
	// extraction time) so values arriving via `processMedia`, link-preview
	// builders, or direct user input go through the same coercion.
	if (typeof uploadData.jpegThumbnail === 'string') {
		uploadData.jpegThumbnail = Buffer.from(uploadData.jpegThumbnail, 'base64')
	}

	const obj = WAProto.Message.fromObject({
		[`${mediaType}Message`]: MessageTypeProto[mediaType as keyof typeof MessageTypeProto].fromObject({
			url: uploadResult.url,
			directPath: uploadResult.directPath,
			mediaKey: uploadResult.mediaKey,
			fileEncSha256: uploadResult.fileEncSha256,
			fileSha256: uploadResult.fileSha256,
			fileLength: uploadResult.fileLength,
			mediaKeyTimestamp: unixTimestampSeconds(),
			...uploadData,
			media: undefined
		} as Record<string, unknown>)
	})

	if (uploadData.ptv) {
		obj.ptvMessage = obj.videoMessage
		delete obj.videoMessage
	}

	if (obj.stickerMessage) {
		obj.stickerMessage.stickerSentTs = Date.now()
	}

	if (cacheableKey) {
		logger?.debug({ cacheableKey }, 'set cache')
		await options.mediaCache!.set(cacheableKey, WAProto.Message.encode(obj).finish())
	}

	return obj
}

/** Extract metadata (thumbnail, duration, waveform) from buffer using built-in JS libraries */
async function extractBuiltInMetadata(
	buffer: Buffer,
	mediaType: string,
	uploadData: MediaUploadData,
	options: { logger?: ILogger; backgroundColor?: string }
) {
	try {
		const requiresThumbnailComputation =
			(mediaType === 'image' || mediaType === 'video') && typeof uploadData.jpegThumbnail === 'undefined'
		const requiresDurationComputation = mediaType === 'audio' && typeof uploadData.seconds === 'undefined'
		const requiresWaveformProcessing = mediaType === 'audio' && uploadData.ptt === true
		const requiresAudioBackground = options.backgroundColor && mediaType === 'audio' && uploadData.ptt === true

		if (requiresThumbnailComputation) {
			const { thumbnail, originalImageDimensions } = await generateThumbnail(buffer, mediaType, options)
			uploadData.jpegThumbnail = thumbnail
			if (!uploadData.width && originalImageDimensions) {
				uploadData.width = originalImageDimensions.width
				uploadData.height = originalImageDimensions.height
			}
		}

		if (requiresDurationComputation) {
			uploadData.seconds = await getAudioDuration(buffer)
		}

		if (requiresWaveformProcessing) {
			uploadData.waveform = await getAudioWaveform(buffer, options.logger)
		}

		if (requiresAudioBackground) {
			uploadData.backgroundArgb = await assertColor(options.backgroundColor!)
		}
	} catch (error) {
		options.logger?.warn({ trace: (error as Error).stack }, 'failed to obtain extra info')
	}
}

export const prepareDisappearingMessageSettingContent = (ephemeralExpiration?: number) => {
	ephemeralExpiration = ephemeralExpiration || 0
	const content: WAMessageContent = {
		ephemeralMessage: {
			message: {
				protocolMessage: {
					type: WAProto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
					ephemeralExpiration
				}
			}
		}
	}
	return WAProto.Message.fromObject(content)
}

/**
 * Generate forwarded message content like WA does
 * @param message the message to forward
 * @param options.forceForward will show the message as forwarded even if it is from you
 */
export const generateForwardMessageContent = (message: WAMessage, forceForward?: boolean) => {
	let content = message.message
	if (!content) {
		throw new Boom('no content in message', { statusCode: 400 })
	}

	content = normalizeMessageContent(content)
	// Shallow clone — only the inner message object gets modified (contextInfo)
	content = { ...content! }

	let key = Object.keys(content)[0] as keyof proto.IMessage

	let score = (content?.[key] as { contextInfo: proto.IContextInfo })?.contextInfo?.forwardingScore || 0
	score += message.key.fromMe && !forceForward ? 0 : 1
	if (key === 'conversation') {
		content.extendedTextMessage = { text: content[key] }
		delete content.conversation

		key = 'extendedTextMessage'
	}

	const key_ = content?.[key] as { contextInfo: proto.IContextInfo }
	if (score > 0) {
		key_.contextInfo = { forwardingScore: score, isForwarded: true }
	} else {
		key_.contextInfo = {}
	}

	return content
}

export const hasNonNullishProperty = <K extends PropertyKey>(
	message: AnyMessageContent,
	key: K
): message is ExtractByKey<AnyMessageContent, K> => {
	return (
		typeof message === 'object' &&
		message !== null &&
		key in message &&
		(message as Record<PropertyKey, unknown>)[key] !== null &&
		(message as Record<PropertyKey, unknown>)[key] !== undefined
	)
}

function hasOptionalProperty<T, K extends PropertyKey>(obj: T, key: K): obj is WithKey<T, K> {
	return typeof obj === 'object' && obj !== null && key in obj && (obj as Record<PropertyKey, unknown>)[key] !== null
}

export const generateWAMessageContent = async (
	message: AnyMessageContent,
	options: MessageContentGenerationOptions
) => {
	let m: WAMessageContent = {}
	if (hasNonNullishProperty(message, 'text')) {
		const extContent = { text: message.text } as WATextMessage

		let urlInfo = message.linkPreview
		if (typeof urlInfo === 'undefined') {
			urlInfo = await generateLinkPreviewIfRequired(message.text, options.getUrlInfo, options.logger)
		}

		if (urlInfo) {
			extContent.matchedText = urlInfo['matched-text']
			extContent.jpegThumbnail = urlInfo.jpegThumbnail
			extContent.description = urlInfo.description
			extContent.title = urlInfo.title
			extContent.previewType = 0

			const img = urlInfo.highQualityThumbnail
			if (img) {
				extContent.thumbnailDirectPath = img.directPath
				extContent.mediaKey = img.mediaKey
				extContent.mediaKeyTimestamp = img.mediaKeyTimestamp
				extContent.thumbnailWidth = img.width
				extContent.thumbnailHeight = img.height
				extContent.thumbnailSha256 = img.fileSha256
				extContent.thumbnailEncSha256 = img.fileEncSha256
			}
		}

		if (options.backgroundColor) {
			extContent.backgroundArgb = await assertColor(options.backgroundColor)
		}

		if (options.font) {
			extContent.font = options.font
		}

		m.extendedTextMessage = extContent
	} else if (hasNonNullishProperty(message, 'contacts')) {
		const contactLen = message.contacts.contacts.length
		if (!contactLen) {
			throw new Boom('require atleast 1 contact', { statusCode: 400 })
		}

		if (contactLen === 1) {
			m.contactMessage = WAProto.Message.ContactMessage.create(message.contacts.contacts[0])
		} else {
			m.contactsArrayMessage = WAProto.Message.ContactsArrayMessage.create(message.contacts)
		}
	} else if (hasNonNullishProperty(message, 'location')) {
		m.locationMessage = WAProto.Message.LocationMessage.create(message.location)
	} else if (hasNonNullishProperty(message, 'react')) {
		if (!message.react.senderTimestampMs) {
			message.react.senderTimestampMs = Date.now()
		}

		m.reactionMessage = WAProto.Message.ReactionMessage.create(message.react)
	} else if (hasNonNullishProperty(message, 'delete')) {
		m.protocolMessage = {
			key: message.delete,
			type: WAProto.Message.ProtocolMessage.Type.REVOKE
		}
	} else if (hasNonNullishProperty(message, 'forward')) {
		m = generateForwardMessageContent(message.forward, message.force)
	} else if (hasNonNullishProperty(message, 'disappearingMessagesInChat')) {
		const exp =
			typeof message.disappearingMessagesInChat === 'boolean'
				? message.disappearingMessagesInChat
					? WA_DEFAULT_EPHEMERAL
					: 0
				: message.disappearingMessagesInChat
		m = prepareDisappearingMessageSettingContent(exp)
	} else if (hasNonNullishProperty(message, 'groupInvite')) {
		m.groupInviteMessage = {}
		m.groupInviteMessage.inviteCode = message.groupInvite.inviteCode
		m.groupInviteMessage.inviteExpiration = message.groupInvite.inviteExpiration
		m.groupInviteMessage.caption = message.groupInvite.text

		m.groupInviteMessage.groupJid = message.groupInvite.jid
		m.groupInviteMessage.groupName = message.groupInvite.subject
		//TODO: use built-in interface and get disappearing mode info etc.
		//TODO: cache / use store!?
		if (options.getProfilePicUrl) {
			const pfpUrl = await options.getProfilePicUrl(message.groupInvite.jid, 'preview')
			if (pfpUrl) {
				const resp = await fetch(pfpUrl, { method: 'GET', dispatcher: options?.options?.dispatcher })
				if (resp.ok) {
					const buf = Buffer.from(await resp.arrayBuffer())
					m.groupInviteMessage.jpegThumbnail = buf
				}
			}
		}
	} else if (hasNonNullishProperty(message, 'pin')) {
		m.pinInChatMessage = {}
		m.messageContextInfo = {}

		m.pinInChatMessage.key = message.pin
		m.pinInChatMessage.type = message.type
		m.pinInChatMessage.senderTimestampMs = Date.now()

		m.messageContextInfo.messageAddOnDurationInSecs =
			message.type === proto.PinInChat.Type.PIN_FOR_ALL ? message.time || 86400 : 0
	} else if (hasNonNullishProperty(message, 'buttonReply')) {
		switch (message.type) {
			case 'template':
				m.templateButtonReplyMessage = {
					selectedDisplayText: message.buttonReply.displayText,
					selectedId: message.buttonReply.id,
					selectedIndex: message.buttonReply.index
				}
				break
			case 'plain':
				m.buttonsResponseMessage = {
					selectedButtonId: message.buttonReply.id,
					selectedDisplayText: message.buttonReply.displayText,
					type: proto.Message.ButtonsResponseMessage.Type.DISPLAY_TEXT
				}
				break
		}
	} else if (hasOptionalProperty(message, 'ptv') && message.ptv) {
		const { videoMessage } = await prepareWAMessageMedia({ video: message.video }, options)
		m.ptvMessage = videoMessage
	} else if (hasNonNullishProperty(message, 'product')) {
		const { imageMessage } = await prepareWAMessageMedia({ image: message.product.productImage }, options)
		m.productMessage = WAProto.Message.ProductMessage.create({
			...message,
			product: {
				...message.product,
				productImage: imageMessage
			}
		})
	} else if (hasNonNullishProperty(message, 'listReply')) {
		m.listResponseMessage = { ...message.listReply }
	} else if (hasNonNullishProperty(message, 'event')) {
		m.eventMessage = {}
		const startTime = Math.floor(message.event.startDate.getTime() / 1000)

		if (message.event.call && options.getCallLink) {
			const token = await options.getCallLink(message.event.call, { startTime })
			m.eventMessage.joinLink = (message.event.call === 'audio' ? CALL_AUDIO_PREFIX : CALL_VIDEO_PREFIX) + token
		}

		m.eventMessage.name = message.event.name
		m.eventMessage.description = message.event.description
		m.eventMessage.startTime = startTime
		m.eventMessage.endTime = message.event.endDate ? Math.floor(message.event.endDate.getTime() / 1000) : undefined
		m.eventMessage.isCanceled = message.event.isCancelled ?? false
		m.eventMessage.extraGuestsAllowed = message.event.extraGuestsAllowed
		m.eventMessage.isScheduleCall = message.event.isScheduleCall ?? false
		m.eventMessage.location = message.event.location
	} else if (hasNonNullishProperty(message, 'poll')) {
		message.poll.selectableCount ||= 0
		message.poll.toAnnouncementGroup ||= false

		if (!Array.isArray(message.poll.values)) {
			throw new Boom('Invalid poll values', { statusCode: 400 })
		}

		if (message.poll.selectableCount < 0 || message.poll.selectableCount > message.poll.values.length) {
			throw new Boom(`poll.selectableCount in poll should be >= 0 and <= ${message.poll.values.length}`, {
				statusCode: 400
			})
		}

		const pollCreationMessage = {
			name: message.poll.name,
			selectableOptionsCount: message.poll.selectableCount,
			options: message.poll.values.map(optionName => ({ optionName }))
		}

		if (message.poll.toAnnouncementGroup) {
			// poll v2 is for community announcement groups (single select and multiple)
			m.pollCreationMessageV2 = pollCreationMessage
		} else {
			if (message.poll.selectableCount === 1) {
				//poll v3 is for single select polls
				m.pollCreationMessageV3 = pollCreationMessage
			} else {
				// poll for multiple choice polls
				m.pollCreationMessage = pollCreationMessage
			}
		}
	} else if (hasNonNullishProperty(message, 'sharePhoneNumber')) {
		m.protocolMessage = {
			type: proto.Message.ProtocolMessage.Type.SHARE_PHONE_NUMBER
		}
	} else if (hasNonNullishProperty(message, 'requestPhoneNumber')) {
		m.requestPhoneNumberMessage = {}
	} else if (hasNonNullishProperty(message, 'limitSharing')) {
		m.protocolMessage = {
			type: proto.Message.ProtocolMessage.Type.LIMIT_SHARING,
			limitSharing: {
				sharingLimited: message.limitSharing === true,
				trigger: 1,
				limitSharingSettingTimestamp: Date.now(),
				initiatedByMe: true
			}
		}
	} else {
		m = await prepareWAMessageMedia(message, options)
	}

	if (hasOptionalProperty(message, 'viewOnce') && !!message.viewOnce) {
		m = { viewOnceMessage: { message: m } }
	}

	if (
		(hasOptionalProperty(message, 'mentions') && message.mentions?.length) ||
		(hasOptionalProperty(message, 'mentionAll') && message.mentionAll)
	) {
		const messageType = Object.keys(m)[0]! as Extract<keyof proto.IMessage, MessageWithContextInfo>
		const key = m[messageType]
		// `key` is a freshly-created plain object (e.g. `{ text: 'hi' }`) — its
		// `contextInfo` slot is declared by the proto schema but not yet an own
		// property, so `'contextInfo' in key` is false and the legacy guarded
		// assignment silently skipped the mention payload. Match upstream
		// Baileys: create `contextInfo` if absent, then merge.
		if (key && typeof key === 'object') {
			const target = key as { contextInfo?: proto.IContextInfo }
			const ci = (target.contextInfo ??= {})
			if (message.mentions?.length) {
				ci.mentionedJid = message.mentions
			}

			if (message.mentionAll) {
				ci.nonJidMentions = 1
			}
		}
	}

	if (hasOptionalProperty(message, 'edit')) {
		m = {
			protocolMessage: {
				key: message.edit,
				editedMessage: m,
				timestampMs: Date.now(),
				type: WAProto.Message.ProtocolMessage.Type.MESSAGE_EDIT
			}
		}
	}

	if (hasOptionalProperty(message, 'contextInfo') && !!message.contextInfo) {
		const messageType = Object.keys(m)[0]! as Extract<keyof proto.IMessage, MessageWithContextInfo>
		const key = m[messageType]
		if (key) {
			key.contextInfo = key.contextInfo ? Object.assign(key.contextInfo, message.contextInfo) : message.contextInfo
		}
	}

	return WAProto.Message.create(m)
}

export const generateWAMessageFromContent = (
	jid: string,
	message: WAMessageContent,
	options: MessageGenerationOptionsFromContent
) => {
	// set timestamp to now
	// if not specified
	if (!options.timestamp) {
		options.timestamp = new Date()
	}

	const innerMessage = normalizeMessageContent(message)!
	const key = getContentType(innerMessage)! as Exclude<keyof proto.IMessage, 'conversation'>
	const timestamp = unixTimestampSeconds(options.timestamp)
	const { quoted, userJid } = options

	if (quoted && !isJidNewsletter(jid)) {
		const participant = quoted.key.fromMe
			? userJid // TODO: Add support for LIDs
			: quoted.participant || quoted.key.participant || quoted.key.remoteJid

		let quotedMsg = normalizeMessageContent(quoted.message)!
		const msgType = getContentType(quotedMsg)!
		// strip any redundant properties
		quotedMsg = proto.Message.create({ [msgType]: quotedMsg[msgType] })

		const quotedContent = quotedMsg[msgType]
		if (typeof quotedContent === 'object' && quotedContent && 'contextInfo' in quotedContent) {
			delete quotedContent.contextInfo
		}

		const contextInfo: proto.IContextInfo =
			('contextInfo' in innerMessage[key]! && innerMessage[key]?.contextInfo) || {}
		contextInfo.participant = jidNormalizedUser(participant!)
		contextInfo.stanzaId = quoted.key.id
		contextInfo.quotedMessage = quotedMsg

		// if a participant is quoted, then it must be a group
		// hence, remoteJid of group must also be entered
		if (jid !== quoted.key.remoteJid) {
			contextInfo.remoteJid = quoted.key.remoteJid
		}

		if (contextInfo && innerMessage[key]) {
			/* @ts-ignore */
			innerMessage[key].contextInfo = contextInfo
		}
	}

	if (
		// if we want to send a disappearing message
		!!options?.ephemeralExpiration &&
		// and it's not a protocol message -- delete, toggle disappear message
		key !== 'protocolMessage' &&
		// already not converted to disappearing message
		key !== 'ephemeralMessage' &&
		// newsletters don't support ephemeral messages
		!isJidNewsletter(jid)
	) {
		/* @ts-ignore */
		innerMessage[key].contextInfo = {
			...((innerMessage[key] as Record<string, unknown>).contextInfo as Record<string, unknown>),
			expiration: options.ephemeralExpiration || WA_DEFAULT_EPHEMERAL
			//ephemeralSettingTimestamp: options.ephemeralOptions.eph_setting_ts?.toString()
		}
	}

	message = WAProto.Message.create(message)

	const messageJSON = {
		key: {
			remoteJid: jid,
			fromMe: true,
			id: options?.messageId || '' // Rust generates the real message ID
		},
		message: message,
		messageTimestamp: timestamp,
		messageStubParameters: [],
		participant: isJidGroup(jid) || isJidStatusBroadcast(jid) ? userJid : undefined, // TODO: Add support for LIDs
		status: WAMessageStatus.PENDING
	}
	return WAProto.WebMessageInfo.fromObject(messageJSON) as WAMessage
}

export const generateWAMessage = async (jid: string, content: AnyMessageContent, options: MessageGenerationOptions) => {
	options.logger = options?.logger?.child({ msgId: options.messageId })
	;(options as MessageContentGenerationOptions).jid = jid
	return generateWAMessageFromContent(jid, await generateWAMessageContent(content, options), options)
}

/** Get the key to access the true type of content */
export const getContentType = (content: proto.IMessage | undefined) => {
	if (content) {
		const keys = Object.keys(content)
		const key = keys.find(k => (k === 'conversation' || k.includes('Message')) && k !== 'senderKeyDistributionMessage')
		return key as keyof typeof content
	}
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

export type DownloadMediaMessageContext = {
	reuploadRequest: (msg: WAMessage) => Promise<WAMessage>
	logger: ILogger
	/** Bridge client for media download — handles CDN failover, auth refresh,
	 *  HMAC-SHA256 verification, and AES-256-CBC decryption internally. */
	waClient: Pick<WasmWhatsAppClient, 'downloadMedia' | 'downloadMediaStream'>
}

/**
 * Downloads the given message. Throws an error if it's not a media message.
 *
 * Uses the Rust bridge for download — provides CDN failover, automatic auth
 * refresh on 401/404, HMAC-SHA256 integrity verification, and AES-256-CBC
 * decryption. Requires `ctx.waClient` (the bridge client).
 */
export const downloadMediaMessage = async <Type extends 'buffer' | 'stream'>(
	message: WAMessage,
	type: Type,
	options: MediaDownloadOptions,
	ctx: DownloadMediaMessageContext
) => {
	return (await downloadMsg()) as Type extends 'buffer' ? Buffer : Readable

	async function downloadMsg() {
		const mContent = extractMessageContent(message.message)
		if (!mContent) {
			throw new Boom('No message present', { statusCode: 400, data: message })
		}

		const contentType = getContentType(mContent)
		let mediaType = String(contentType)?.replace('Message', '') as MediaType
		const media = mContent[contentType!]

		if (!media || typeof media !== 'object' || (!('url' in media) && !('thumbnailDirectPath' in media))) {
			throw new Boom(`"${String(contentType)}" message is not a media message`)
		}

		if ('thumbnailDirectPath' in media && !('url' in media)) {
			mediaType = 'thumbnail-link'
		}

		if (!('directPath' in media) || !media.directPath || !('mediaKey' in media) || !media.mediaKey) {
			throw new Boom('Media message missing directPath or mediaKey', { statusCode: 400 })
		}

		const mediaObj = media as {
			directPath: string
			mediaKey: Uint8Array
			fileSha256?: Uint8Array
			fileEncSha256?: Uint8Array
			fileLength?: number | null
		}
		if (!mediaObj.fileSha256 || !mediaObj.fileEncSha256) {
			throw new Boom('Media message missing fileSha256 or fileEncSha256', { statusCode: 400 })
		}

		const args = [
			mediaObj.directPath,
			mediaObj.mediaKey,
			mediaObj.fileSha256,
			mediaObj.fileEncSha256,
			Number(mediaObj.fileLength || 0),
			mediaType
		] as const

		if (type === 'buffer') {
			const data = await ctx.waClient.downloadMedia(...args)
			return Buffer.from(data)
		}

		// Stream mode: Web ReadableStream from Rust → Node.js Readable
		const webStream = ctx.waClient.downloadMediaStream(...args)
		return Readable.fromWeb(webStream as WebReadableStream)
	}
}

/**
 * Module-level pointer to the most-recently created bridge client. Updated by
 * `makeWASocket` so standalone helpers like {@link downloadContentFromMessage}
 * (which carry no socket reference) can find the bridge without forcing the
 * caller to plumb `waClient` through. Multi-account hosts that juggle several
 * sockets should pass `opts.client` explicitly; otherwise this points at the
 * client created last.
 */
let activeBridgeClient: WasmWhatsAppClient | undefined
let activeBridgeLogger: ILogger | undefined

export const _registerActiveBridgeClient = (client: WasmWhatsAppClient, logger?: ILogger) => {
	activeBridgeClient = client
	activeBridgeLogger = logger
}

const noopLogger: ILogger = {
	level: 'silent',
	child: () => noopLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
}

/**
 * Upstream-Baileys-compatible standalone media download. Builds a synthetic
 * `WAMessage` from the supplied media subcontent (image/video/audio/etc fields)
 * and routes it through {@link downloadMediaMessage}, so CDN failover, auth
 * refresh, HMAC verification, and AES-256-CBC decryption all happen inside the
 * Rust bridge — same code path as `sock.downloadMedia`.
 *
 * The bridge client is required. Pass it explicitly via `opts.client` for
 * multi-account hosts; otherwise the helper falls back to the most-recently
 * created bridge client (registered automatically by `makeWASocket`).
 */
export const downloadContentFromMessage = async (
	mediaContent: {
		directPath?: string | null
		mediaKey?: Uint8Array | null
		fileSha256?: Uint8Array | null
		fileEncSha256?: Uint8Array | null
		fileLength?: number | Long | null
		url?: string | null
	},
	type: MediaType,
	opts: MediaDownloadOptions & { client?: WasmWhatsAppClient; logger?: ILogger } = {}
): Promise<Readable> => {
	const client = opts.client ?? activeBridgeClient
	if (!client) {
		throw new Boom(
			'downloadContentFromMessage: no bridge client available. ' +
				'Pass `opts.client = sock.waClient`, or call after `makeWASocket()` has initialized.',
			{ statusCode: 500 }
		)
	}

	const fakeMessage = {
		key: {} as WAMessage['key'],
		message: { [`${type}Message`]: mediaContent } as WAMessageContent
	} as WAMessage

	return downloadMediaMessage(fakeMessage, 'stream', opts, {
		logger: opts.logger ?? activeBridgeLogger ?? noopLogger,
		reuploadRequest: async (m: WAMessage) => m,
		waClient: client
	})
}

type Long = { low: number; high: number; unsigned: boolean }
type VoteAggregation = { name: string; voters: string[] }

/**
 * Aggregate votes from a poll message.
 *
 * Takes a poll creation message and its accumulated poll updates (from
 * `messages.update` events) and returns the vote tally per option.
 *
 * `pollUpdates` should contain pre-decrypted votes where `vote.selectedOptions`
 * are the SHA-256 hashes of the voted option names.
 *
 * @example
 * ```ts
 * sock.ev.on('messages.update', event => {
 *   for (const { key, update } of event) {
 *     if (update.pollUpdates) {
 *       const pollMsg = await getMessageFromStore(key)
 *       const votes = getAggregateVotesInPollMessage({
 *         message: pollMsg.message,
 *         pollUpdates: pollMsg.pollUpdates
 *       })
 *       console.log(votes) // [{ name: 'Yes', voters: ['jid1'] }, ...]
 *     }
 *   }
 * })
 * ```
 */
export function getAggregateVotesInPollMessage(
	{ message, pollUpdates }: Pick<WAMessage, 'pollUpdates' | 'message'>,
	meId?: string
): VoteAggregation[] {
	const opts =
		message?.pollCreationMessage?.options ||
		message?.pollCreationMessageV2?.options ||
		message?.pollCreationMessageV3?.options ||
		[]

	// Build hash→name lookup: SHA-256(optionName) hex → optionName
	// Use synchronous hash via crypto.subtle is async, so we pre-build
	// using the raw bytes from selectedOptions and match by position.
	const voteHashMap: Record<string, VoteAggregation> = {}
	for (const opt of opts) {
		const name = opt.optionName || ''
		voteHashMap[name] = { name, voters: [] }
	}

	for (const update of pollUpdates || []) {
		const { vote } = update
		if (!vote?.selectedOptions?.length) continue

		const voter = update.pollUpdateMessageKey ? getKeyAuthor(update.pollUpdateMessageKey, meId) : 'unknown'

		for (const optionHash of vote.selectedOptions) {
			const hashHex = Buffer.from(optionHash).toString('hex')

			// Try to find the matching option name
			if (!voteHashMap[hashHex]) {
				voteHashMap[hashHex] = { name: hashHex, voters: [] }
			}

			voteHashMap[hashHex].voters.push(voter)
		}
	}

	return Object.values(voteHashMap)
}

/** Get the author of a message key */
function getKeyAuthor(key: proto.IMessageKey, meId?: string): string {
	return (key.fromMe ? meId : key.participant || key.remoteJid) || 'unknown'
}
