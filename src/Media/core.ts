/**
 * Portable media core: retry crypto, direct-path helpers, HKDF key
 * derivation, extension/base64 helpers and the retry-node codec.
 *
 * No filesystem, no child processes, no image/audio libraries, no Node
 * streams: every input and output is `Uint8Array` (or a string), randomness
 * comes from `Runtime/bytes.ts`, AES-GCM goes through the bridge-exposed
 * primitives in `Utils/crypto.ts` (OpenSSL on Node, WASM fallback on
 * hosts), and HKDF/SHA-256 come from the bridge + portable bytes.
 * Anything needing `fs`, `ffmpeg`, `sharp`/`jimp`, `music-metadata`,
 * `audio-decode` or Node `Readable` lives in `Utils/messages-media.ts`
 * (the Node half) and stays there.
 */

import type { MediaType } from '../Defaults/index.ts'
import { MEDIA_HKDF_KEY_MAPPING } from '../Defaults/index.ts'
import type {
	BaileysEventMap,
	BinaryNode,
	MediaDecryptionKeyInfo,
	WAGenericMediaMessage,
	WAMessageContent,
	WAMessageKey
} from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { base64Decode, base64Encode, utf8Encode } from '../Runtime/bytes.ts'
import { hostRuntime } from '../Runtime/host.ts'
import { makeMediaCryptoRuntime } from '../Runtime/bridge.ts'
import type { MediaCryptoRuntime } from '../Runtime/types.ts'
import { getBinaryNodeChild, getBinaryNodeChildBuffer } from '../WABinary/generic-utils.ts'
import { jidNormalizedUser } from '../WABinary/jid-utils.ts'
import { Boom } from '../Utils/boom.ts'

export const hkdfInfoKey = (type: MediaType): string => `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`

const defaultCryptoRuntime = makeMediaCryptoRuntime(hostRuntime)

const stripDataPrefix = (value: string): string => value.replace('data:;base64,', '')

/** Derive the IV + cipher + MAC keys for a media decryption. Accepts raw bytes or base64. */
export async function getMediaKeys(
	buffer: Uint8Array | string | null | undefined,
	mediaType: MediaType,
	runtime: MediaCryptoRuntime = defaultCryptoRuntime
): Promise<MediaDecryptionKeyInfo> {
	if (!buffer) throw new Boom('Cannot derive from empty media key')
	const keyBytes = typeof buffer === 'string' ? base64Decode(stripDataPrefix(buffer)) : buffer
	const expandedMediaKey = runtime.hkdf(keyBytes, 112, { info: hkdfInfoKey(mediaType) })
	return {
		iv: expandedMediaKey.slice(0, 16),
		cipherKey: expandedMediaKey.slice(16, 48),
		macKey: expandedMediaKey.slice(48, 80)
	}
}

/** URL-safe base64 without padding, for upload query params. */
export const encodeBase64EncodedStringForUpload = (b64: string): string =>
	encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))

export const mediaMessageSHA256B64 = (message: WAMessageContent): string | null | undefined => {
	const media = Object.values(message)[0] as WAGenericMediaMessage
	const digest = media?.fileSha256
	if (digest == null) return digest
	return typeof digest === 'string' ? digest : base64Encode(digest)
}

export const DEF_MEDIA_HOST = 'mmg.whatsapp.net'

export const getUrlFromDirectPath = (directPath: string, host: string = DEF_MEDIA_HOST): string =>
	`https://${host}${directPath}`

export function extensionForMediaMessage(message: WAMessageContent): string {
	const getExtension = (mimetype: string) => mimetype.split(';')[0]?.split('/')[1]
	const type = Object.keys(message)[0] as keyof WAMessageContent
	if (type === 'locationMessage' || type === 'liveLocationMessage' || type === 'productMessage') return '.jpeg'
	return getExtension((message[type] as WAGenericMediaMessage).mimetype!)!
}

const getMediaRetryKey = (mediaKey: Uint8Array, runtime: MediaCryptoRuntime) =>
	runtime.hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' })

export const encryptMediaRetryRequest = (
	key: WAMessageKey,
	mediaKey: Uint8Array,
	meId: string,
	runtime: MediaCryptoRuntime = defaultCryptoRuntime
): BinaryNode => {
	const receiptBuffer = proto.ServerErrorReceipt.encode({ stanzaId: key.id }).finish()
	const iv = runtime.randomBytes(12)
	const ciphertext = runtime.aesGcm256Encrypt(
		getMediaRetryKey(mediaKey, runtime),
		iv,
		utf8Encode(key.id!),
		receiptBuffer
	)
	return {
		tag: 'receipt',
		attrs: { id: key.id!, to: jidNormalizedUser(meId), type: 'server-error' },
		content: [
			{
				tag: 'encrypt',
				attrs: {},
				content: [
					{ tag: 'enc_p', attrs: {}, content: ciphertext },
					{ tag: 'enc_iv', attrs: {}, content: iv }
				]
			},
			{
				tag: 'rmr',
				attrs: {
					jid: key.remoteJid!,
					from_me: (!!key.fromMe).toString(),
					...(key.participant ? { participant: key.participant } : {})
				}
			}
		]
	}
}

const MEDIA_RETRY_STATUS_MAP = {
	[proto.MediaRetryNotification.ResultType.SUCCESS]: 200,
	[proto.MediaRetryNotification.ResultType.DECRYPTION_ERROR]: 412,
	[proto.MediaRetryNotification.ResultType.NOT_FOUND]: 404,
	[proto.MediaRetryNotification.ResultType.GENERAL_ERROR]: 418
} as const

export const getStatusCodeForMediaRetry = (code: number): 200 | 412 | 404 | 418 =>
	MEDIA_RETRY_STATUS_MAP[code as keyof typeof MEDIA_RETRY_STATUS_MAP]

export const decodeMediaRetryNode = (node: BinaryNode): BaileysEventMap['messages.media-update'][number] => {
	const retryNode = getBinaryNodeChild(node, 'rmr')!
	const event: BaileysEventMap['messages.media-update'][number] = {
		key: {
			id: node.attrs.id,
			remoteJid: retryNode.attrs.jid,
			fromMe: retryNode.attrs.from_me === 'true',
			participant: retryNode.attrs.participant
		}
	}
	const errorNode = getBinaryNodeChild(node, 'error')
	if (errorNode) {
		const errorCode = +errorNode.attrs.code!
		event.error = new Boom(`Failed to re-upload media (${errorCode})`, {
			data: errorNode.attrs,
			statusCode: getStatusCodeForMediaRetry(errorCode)
		})
	} else {
		const encryptedInfoNode = getBinaryNodeChild(node, 'encrypt')
		const ciphertext = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_p')
		const iv = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_iv')
		if (ciphertext && iv) event.media = { ciphertext, iv }
		else event.error = new Boom('Failed to re-upload media (missing ciphertext)', { statusCode: 404 })
	}
	return event
}

export const decryptMediaRetryData = (
	{ ciphertext, iv }: { ciphertext: Uint8Array; iv: Uint8Array },
	mediaKey: Uint8Array,
	msgId: string,
	runtime: MediaCryptoRuntime = defaultCryptoRuntime
): proto.MediaRetryNotification =>
	proto.MediaRetryNotification.decode(
		runtime.aesGcm256Decrypt(getMediaRetryKey(mediaKey, runtime), iv, utf8Encode(msgId), ciphertext)
	)
