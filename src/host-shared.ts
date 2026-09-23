import { DisconnectReason as socketDisconnectReason } from './Types/index.ts'
import * as mediaCore from './Media/core.ts'
import type { HostMediaCryptoRuntime } from './host-types.ts'

export type BinaryNode = {
	tag: string
	attrs: Record<string, string>
	content?: BinaryNode[] | string | Uint8Array
}

export type WAMessageKey = {
	remoteJid?: string | null
	fromMe?: boolean | null
	id?: string | null
	participant?: string | null
}

export type WAMessage = {
	key: WAMessageKey
	message?: Record<string, unknown> | null
	messageTimestamp?: number | { low: number; high: number; unsigned?: boolean } | null
	pushName?: string | null
	[key: string]: unknown
}

export type Chat = { id?: string; [key: string]: unknown }
export type Contact = { id: string; [key: string]: unknown }
export type MediaType =
	| 'audio'
	| 'document'
	| 'gif'
	| 'image'
	| 'ppic'
	| 'product'
	| 'ptt'
	| 'sticker'
	| 'video'
	| 'thumbnail-document'
	| 'thumbnail-image'
	| 'thumbnail-video'
	| 'thumbnail-link'
	| 'md-msg-hist'
	| 'md-app-state'
	| 'product-catalog-image'
	| 'payment-bg-image'
	| 'ptv'
	| 'biz-cover-photo'

export type MediaDecryptionKeyInfo = { iv: Uint8Array; cipherKey: Uint8Array; macKey?: Uint8Array }
export type MediaRetryUpdate = {
	key: WAMessageKey
	error?: unknown
	media?: { ciphertext: Uint8Array; iv: Uint8Array }
}

export type DisconnectReason = number
export const DisconnectReason: {
	[code: number]: string
	connectionClosed: number
	connectionLost: number
	connectionReplaced: number
	timedOut: number
	loggedOut: number
	badSession: number
	restartRequired: number
	multideviceMismatch: number
	forbidden: number
	unavailableService: number
} = socketDisconnectReason

export const hkdfInfoKey = (type: MediaType): string => mediaCore.hkdfInfoKey(type)
export const getMediaKeys = (
	buffer: Uint8Array | string | null | undefined,
	mediaType: MediaType,
	runtime?: HostMediaCryptoRuntime
): Promise<MediaDecryptionKeyInfo> => mediaCore.getMediaKeys(buffer, mediaType, runtime)
export const encodeBase64EncodedStringForUpload = (value: string): string =>
	mediaCore.encodeBase64EncodedStringForUpload(value)
export const mediaMessageSHA256B64 = (message: Record<string, unknown>): string | null | undefined =>
	mediaCore.mediaMessageSHA256B64(message as never)
export const DEF_MEDIA_HOST: string = mediaCore.DEF_MEDIA_HOST
export const getUrlFromDirectPath = (directPath: string, host?: string): string =>
	mediaCore.getUrlFromDirectPath(directPath, host)
export const extensionForMediaMessage = (message: Record<string, unknown>): string =>
	mediaCore.extensionForMediaMessage(message as never)
export const encryptMediaRetryRequest = (
	key: WAMessageKey,
	mediaKey: Uint8Array,
	meId: string,
	runtime?: HostMediaCryptoRuntime
): BinaryNode => mediaCore.encryptMediaRetryRequest(key as never, mediaKey, meId, runtime)
export const getStatusCodeForMediaRetry = (code: number): 200 | 412 | 404 | 418 =>
	mediaCore.getStatusCodeForMediaRetry(code)
export const decodeMediaRetryNode = (node: BinaryNode): MediaRetryUpdate => mediaCore.decodeMediaRetryNode(node)
export const decryptMediaRetryData = (
	data: { ciphertext: Uint8Array; iv: Uint8Array },
	mediaKey: Uint8Array,
	msgId: string,
	runtime?: HostMediaCryptoRuntime
): unknown => mediaCore.decryptMediaRetryData(data, mediaKey, msgId, runtime)
