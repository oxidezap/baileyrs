import type { Readable } from 'stream'
import type { URL } from 'url'
import type { UploadMediaResult, WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import { proto } from '../../WAProto/index.js'
import type { MediaType } from '../Defaults/index'
import type { GroupMetadata } from './GroupMetadata'
import type { CacheStore } from './Socket'

// export the WAMessage Prototypes
export { proto as WAProto }
export type WAMessage = proto.IWebMessageInfo & {
	key: WAMessageKey
	messageStubParameters?: string[]
	category?: string
	retryCount?: number
}
export type WAMessageContent = proto.IMessage
export type WAContactMessage = proto.Message.IContactMessage
export type WAContactsArrayMessage = proto.Message.IContactsArrayMessage
export type WAMessageKey = proto.IMessageKey & {
	remoteJidAlt?: string
	participantAlt?: string
	server_id?: string
	addressingMode?: string
	isViewOnce?: boolean // TODO: remove out of the message key, place in WebMessageInfo
}
export type WATextMessage = proto.Message.IExtendedTextMessage
export type WAContextInfo = proto.IContextInfo
export type WALocationMessage = proto.Message.ILocationMessage
export type WAGenericMediaMessage =
	| proto.Message.IVideoMessage
	| proto.Message.IImageMessage
	| proto.Message.IAudioMessage
	| proto.Message.IDocumentMessage
	| proto.Message.IStickerMessage
export const WAMessageStubType = proto.WebMessageInfo.StubType
export const WAMessageStatus = proto.WebMessageInfo.Status
import { Buffer } from 'node:buffer'
import type { ILogger } from '../Utils/logger'
export type WAMediaPayloadURL = { url: URL | string }
export type WAMediaPayloadStream = { stream: Readable }
export type WAMediaUpload = Buffer | WAMediaPayloadStream | WAMediaPayloadURL
/** Set of message types that are supported by the library */
export type MessageType = keyof proto.Message

export enum WAMessageAddressingMode {
	PN = 'pn',
	LID = 'lid'
}

export type MessageWithContextInfo =
	| 'imageMessage'
	| 'contactMessage'
	| 'locationMessage'
	| 'extendedTextMessage'
	| 'documentMessage'
	| 'audioMessage'
	| 'videoMessage'
	| 'call'
	| 'contactsArrayMessage'
	| 'liveLocationMessage'
	| 'templateMessage'
	| 'stickerMessage'
	| 'groupInviteMessage'
	| 'templateButtonReplyMessage'
	| 'productMessage'
	| 'listMessage'
	| 'orderMessage'
	| 'listResponseMessage'
	| 'buttonsMessage'
	| 'buttonsResponseMessage'
	| 'interactiveMessage'
	| 'interactiveResponseMessage'
	| 'pollCreationMessage'
	| 'requestPhoneNumberMessage'
	| 'messageHistoryBundle'
	| 'eventMessage'
	| 'newsletterAdminInviteMessage'
	| 'albumMessage'
	| 'stickerPackMessage'
	| 'pollResultSnapshotMessage'
	| 'messageHistoryNotice'

export type MessageReceiptType =
	| 'read'
	| 'read-self'
	| 'hist_sync'
	| 'peer_msg'
	| 'sender'
	| 'inactive'
	| 'played'
	| undefined

export type MediaConnInfo = {
	auth: string
	ttl: number
	hosts: { hostname: string; maxContentLengthBytes: number }[]
	fetchDate: Date
}

export interface WAUrlInfo {
	'canonical-url': string
	'matched-text': string
	title: string
	description?: string
	jpegThumbnail?: Buffer
	highQualityThumbnail?: proto.Message.IImageMessage
	originalThumbnailUrl?: string
}

// types to generate WA messages
type Mentionable = {
	/** list of jids that are mentioned in the accompanying text */
	mentions?: string[]
	/** mention all */
	mentionAll?: boolean
}
type Contextable = {
	/** add contextInfo to the message */
	contextInfo?: proto.IContextInfo
}
type ViewOnce = {
	viewOnce?: boolean
}

type Editable = {
	edit?: WAMessageKey
}
type WithDimensions = {
	width?: number
	height?: number
}

export type PollMessageOptions = {
	name: string
	selectableCount?: number
	values: string[]
	toAnnouncementGroup?: boolean
}

export type EventMessageOptions = {
	name: string
	description?: string
	startDate: Date
	endDate?: Date
	location?: WALocationMessage
	call?: 'audio' | 'video'
	isCancelled?: boolean
	isScheduleCall?: boolean
	extraGuestsAllowed?: boolean
}

type SharePhoneNumber = {
	sharePhoneNumber: boolean
}

type RequestPhoneNumber = {
	requestPhoneNumber: boolean
}

export type AnyMediaMessageContent = (
	| ({
			image: WAMediaUpload
			caption?: string
			jpegThumbnail?: string
	  } & Mentionable &
			Contextable &
			WithDimensions)
	| ({
			video: WAMediaUpload
			caption?: string
			gifPlayback?: boolean
			jpegThumbnail?: string
			/** if set to true, will send as a `video note` */
			ptv?: boolean
	  } & Mentionable &
			Contextable &
			WithDimensions)
	| {
			audio: WAMediaUpload
			/** if set to true, will send as a `voice note` */
			ptt?: boolean
			/** optionally tell the duration of the audio */
			seconds?: number
	  }
	| ({
			sticker: WAMediaUpload
			isAnimated?: boolean
	  } & WithDimensions)
	| ({
			document: WAMediaUpload
			mimetype: string
			fileName?: string
			caption?: string
	  } & Contextable)
) & { mimetype?: string } & Editable

export type ButtonReplyInfo = {
	displayText: string
	id: string
	index: number
}

export type GroupInviteInfo = {
	inviteCode: string
	inviteExpiration: number
	text: string
	jid: string
	subject: string
}

export type WASendableProduct = Omit<proto.Message.ProductMessage.IProductSnapshot, 'productImage'> & {
	productImage: WAMediaUpload
}

export type AnyRegularMessageContent = (
	| ({
			text: string
			linkPreview?: WAUrlInfo | null
	  } & Mentionable &
			Contextable &
			Editable)
	| AnyMediaMessageContent
	| { event: EventMessageOptions }
	| ({
			poll: PollMessageOptions
	  } & Mentionable &
			Contextable &
			Editable)
	| {
			contacts: {
				displayName?: string
				contacts: proto.Message.IContactMessage[]
			}
	  }
	| {
			location: WALocationMessage
	  }
	| { react: proto.Message.IReactionMessage }
	| {
			buttonReply: ButtonReplyInfo
			type: 'template' | 'plain'
	  }
	| {
			groupInvite: GroupInviteInfo
	  }
	| {
			listReply: Omit<proto.Message.IListResponseMessage, 'contextInfo'>
	  }
	| {
			pin: WAMessageKey
			type: proto.PinInChat.Type
			/**
			 * 24 hours, 7 days, 30 days
			 */
			time?: 86400 | 604800 | 2592000
	  }
	| {
			product: WASendableProduct
			businessOwnerJid?: string
			body?: string
			footer?: string
	  }
	| SharePhoneNumber
	| RequestPhoneNumber
) &
	ViewOnce

export type AnyMessageContent =
	| AnyRegularMessageContent
	| {
			forward: WAMessage
			force?: boolean
	  }
	| {
			/** Delete your message or anyone's message in a group (admin required) */
			delete: WAMessageKey
	  }
	| {
			disappearingMessagesInChat: boolean | number
	  }
	| {
			limitSharing: boolean
	  }

export type GroupMetadataParticipants = Pick<GroupMetadata, 'participants'>

type MinimalRelayOptions = {
	/** override the message ID with a custom provided string */
	messageId?: string
	/** should we use group metadata cache, or fetch afresh from the server; default assumed to be "true" */
	useCachedGroupMetadata?: boolean
}

export type MessageRelayOptions = MinimalRelayOptions & {
	/** only send to a specific participant; used when a message decryption fails for a single user */
	participant?: { jid: string; count: number }
	/** jid list of participants for status@broadcast */
	statusJidList?: string[]
}

export type MiscMessageGenerationOptions = MinimalRelayOptions & {
	/** optional, if you want to manually set the timestamp of the message */
	timestamp?: Date
	/** the message you want to quote */
	quoted?: WAMessage
	/** disappearing messages settings */
	ephemeralExpiration?: number | string
	/** timeout for media upload to WA server */
	mediaUploadTimeoutMs?: number
	/** jid list of participants for status@broadcast */
	statusJidList?: string[]
	/** backgroundcolor for status */
	backgroundColor?: string
	/** font type for status */
	font?: number
	/** if it is broadcast */
	broadcast?: boolean
}
export type MessageGenerationOptionsFromContent = MiscMessageGenerationOptions & {
	userJid: string
}

export type MediaMetadata = {
	jpegThumbnail?: string
	width?: number
	height?: number
	seconds?: number
	waveform?: Uint8Array
}

export type MediaGenerationOptions = {
	logger?: ILogger
	mediaTypeOverride?: MediaType
	/** Bridge client — handles encryption + upload internally */
	waClient: Pick<WasmWhatsAppClient, 'uploadMedia' | 'encryptMediaStream' | 'uploadEncryptedMediaStream'>
	/** cache media so it does not have to be uploaded again */
	mediaCache?: CacheStore

	mediaUploadTimeoutMs?: number

	options?: RequestInit

	backgroundColor?: string

	font?: number

	/**
	 * Optional: custom media processing pipeline.
	 * Called with the raw media buffer. Must return upload result + optional metadata.
	 *
	 * Use this for large files (streaming encrypt to temp file → streaming upload)
	 * or custom thumbnail generation (ffmpeg, etc.).
	 *
	 * If not provided: default in-memory path via waClient.uploadMedia().
	 */
	processMedia?: (
		media: Buffer,
		mediaType: MediaType,
		waClient: MediaGenerationOptions['waClient']
	) => Promise<{
		upload: UploadMediaResult
		metadata?: Partial<MediaMetadata>
	}>
}
export type MessageContentGenerationOptions = MediaGenerationOptions & {
	getUrlInfo?: (text: string) => Promise<WAUrlInfo | undefined>
	getProfilePicUrl?: (jid: string, type: 'image' | 'preview') => Promise<string | undefined>
	getCallLink?: (type: 'audio' | 'video', event?: { startTime: number }) => Promise<string | undefined>
	jid?: string
}
export type MessageGenerationOptions = MessageContentGenerationOptions & MessageGenerationOptionsFromContent

/**
 * Type of message upsert
 * 1. notify => notify the user, this message was just received
 * 2. append => append the message to the chat history, no notification required
 */
export type MessageUpsertType = 'append' | 'notify'

export type MessageUserReceipt = proto.IUserReceipt

export type WAMessageUpdate = { update: Partial<WAMessage>; key: WAMessageKey }

export type WAMessageCursor = { before: WAMessageKey | undefined } | { after: WAMessageKey | undefined }

export type MessageUserReceiptUpdate = { key: WAMessageKey; receipt: MessageUserReceipt }

export type MinimalMessage = Pick<WAMessage, 'key' | 'messageTimestamp'>
