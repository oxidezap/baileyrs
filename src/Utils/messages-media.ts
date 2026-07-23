import type { IAudioMetadata } from 'music-metadata'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { MEDIA_HKDF_KEY_MAPPING, type MediaType } from '../Defaults/index.ts'
import type {
	BaileysEventMap,
	BinaryNode,
	MediaDecryptionKeyInfo,
	MessageType,
	WAGenericMediaMessage,
	WAMediaUpload,
	WAMessageContent,
	WAMessageKey
} from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { getBinaryNodeChild, getBinaryNodeChildBuffer } from '../WABinary/generic-utils.ts'
import { jidNormalizedUser } from '../WABinary/jid-utils.ts'
import { Boom } from './boom.ts'
import { aesDecryptGCM, aesEncryptGCM, hkdf } from './crypto.ts'
import type { ILogger } from './logger.ts'

const randomId = () => globalThis.crypto.randomUUID()

const getTmpFilesDirectory = () => tmpdir()

const getImageProcessingLibrary = async () => {
	//@ts-ignore
	const [jimp, sharp] = await Promise.all([import('jimp').catch(() => {}), import('sharp').catch(() => {})])

	if (sharp) {
		return { sharp }
	}

	if (jimp) {
		return { jimp }
	}

	throw new Boom('No image processing library available')
}

export const hkdfInfoKey = (type: MediaType): string => `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`

export async function getMediaKeys(
	buffer: Uint8Array | string | null | undefined,
	mediaType: MediaType
): Promise<MediaDecryptionKeyInfo> {
	if (!buffer) throw new Boom('Cannot derive from empty media key')
	if (typeof buffer === 'string') buffer = Buffer.from(buffer.replace('data:;base64,', ''), 'base64')
	const expandedMediaKey = hkdf(buffer, 112, { info: hkdfInfoKey(mediaType) })
	return {
		iv: expandedMediaKey.slice(0, 16),
		cipherKey: expandedMediaKey.slice(16, 48),
		macKey: expandedMediaKey.slice(48, 80)
	}
}

/** Extracts video thumb using FFMPEG */
const extractVideoThumb = async (
	path: string,
	destPath: string,
	time: string,
	size: { width: number; height: number }
) =>
	new Promise<void>((resolve, reject) => {
		execFile(
			'ffmpeg',
			['-ss', time, '-i', path, '-y', '-vf', `scale=${size.width}:-1`, '-vframes', '1', '-f', 'image2', destPath],
			err => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			}
		)
	})

export const extractImageThumb = async (bufferOrFilePath: Readable | Buffer | string, width = 32) => {
	// TODO: Move entirely to sharp, removing jimp as it supports readable streams
	// This will have positive speed and performance impacts as well as minimizing RAM usage.
	if (bufferOrFilePath instanceof Readable) {
		bufferOrFilePath = await toBuffer(bufferOrFilePath)
	}

	const lib = await getImageProcessingLibrary()
	if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
		const img = lib.sharp.default(bufferOrFilePath)
		const dimensions = await img.metadata()

		const buffer = await img.resize(width).jpeg({ quality: 50 }).toBuffer()
		return {
			buffer,
			original: {
				width: dimensions.width,
				height: dimensions.height
			}
		}
	} else if ('jimp' in lib && typeof lib.jimp?.Jimp === 'object') {
		const JimpClass = lib.jimp.Jimp as {
			read: (input: Buffer | string) => Promise<{
				width: number
				height: number
				resize: (opts: unknown) => { getBuffer: (mime: string, opts: unknown) => Promise<Buffer> }
			}>
		}
		const jimp = await JimpClass.read(bufferOrFilePath)
		const dimensions = {
			width: jimp.width,
			height: jimp.height
		}
		const buffer = await jimp
			.resize({ w: width, mode: lib.jimp.ResizeStrategy.BILINEAR })
			.getBuffer('image/jpeg', { quality: 50 })
		return {
			buffer,
			original: dimensions
		}
	} else {
		throw new Boom('No image processing library available')
	}
}

export const encodeBase64EncodedStringForUpload = (b64: string): string =>
	encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))

export const generateProfilePicture = async (
	mediaUpload: WAMediaUpload,
	dimensions?: { width: number; height: number }
): Promise<{ img: Buffer }> => {
	const buffer = Buffer.isBuffer(mediaUpload) ? mediaUpload : await toBuffer((await getStream(mediaUpload)).stream)
	const { width = 640, height = 640 } = dimensions || {}
	const lib = await getImageProcessingLibrary()
	if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
		return { img: await lib.sharp.default(buffer).resize(width, height).jpeg({ quality: 50 }).toBuffer() }
	}
	if ('jimp' in lib && typeof lib.jimp?.Jimp === 'function') {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const jimp = await (lib.jimp.Jimp as any).read(buffer)
		const min = Math.min(jimp.width, jimp.height)
		const cropped = jimp.crop({ x: 0, y: 0, w: min, h: min })
		return {
			img: await cropped
				.resize({ w: width, h: height, mode: lib.jimp.ResizeStrategy.BILINEAR })
				.getBuffer('image/jpeg', { quality: 50 })
		}
	}
	throw new Boom('No image processing library available')
}

export const mediaMessageSHA256B64 = (message: WAMessageContent): string | null | undefined => {
	const media = Object.values(message)[0] as WAGenericMediaMessage
	return media?.fileSha256 && Buffer.from(media.fileSha256).toString('base64')
}

/** Returns audio duration in seconds, parsed via `music-metadata`. */
export async function getAudioDuration(buffer: Buffer | string | Readable) {
	const musicMetadata = await import('music-metadata')
	let metadata: IAudioMetadata
	const options = {
		duration: true
	}
	if (Buffer.isBuffer(buffer)) {
		metadata = await musicMetadata.parseBuffer(buffer, undefined, options)
	} else if (typeof buffer === 'string') {
		metadata = await musicMetadata.parseFile(buffer, options)
	} else {
		metadata = await musicMetadata.parseStream(buffer, undefined, options)
	}

	return metadata.format.duration
}

/**
  referenced from and modifying https://github.com/wppconnect-team/wa-js/blob/main/src/chat/functions/prepareAudioWaveform.ts
 */
export async function getAudioWaveform(buffer: Buffer | string | Readable, logger?: ILogger) {
	try {
		// @ts-ignore
		const { default: decoder } = await import('audio-decode')
		let audioData: Buffer
		if (Buffer.isBuffer(buffer)) {
			audioData = buffer
		} else if (typeof buffer === 'string') {
			const rStream = createReadStream(buffer)
			audioData = await toBuffer(rStream)
		} else {
			audioData = await toBuffer(buffer)
		}

		const audioBuffer = await decoder(audioData)

		const rawData = audioBuffer.getChannelData(0) // We only need to work with one channel of data
		const samples = 64 // Number of samples we want to have in our final data set
		const blockSize = Math.floor(rawData.length / samples) // the number of samples in each subdivision
		const filteredData: number[] = []
		for (let i = 0; i < samples; i++) {
			const blockStart = blockSize * i // the location of the first sample in the block
			let sum = 0
			for (let j = 0; j < blockSize; j++) {
				sum = sum + Math.abs(rawData[blockStart + j]) // find the sum of all the samples in the block
			}

			filteredData.push(sum / blockSize) // divide the sum by the block size to get the average
		}

		// This guarantees that the largest data point will be set to 1, and the rest of the data will scale proportionally.
		const multiplier = Math.pow(Math.max(...filteredData), -1)
		const normalizedData = filteredData.map(n => n * multiplier)

		// Generate waveform like WhatsApp
		const waveform = new Uint8Array(normalizedData.map(n => Math.floor(100 * n)))

		return waveform
	} catch (e) {
		logger?.debug('Failed to generate waveform: ' + e)
	}
}

export const toReadable = (buffer: Buffer) => {
	const readable = new Readable({ read: () => {} })
	readable.push(buffer)
	readable.push(null)
	return readable
}

export const toBuffer = async (stream: Readable) => {
	const chunks: Buffer[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}

	stream.destroy()
	return Buffer.concat(chunks)
}

export const getStream = async (item: WAMediaUpload, opts?: RequestInit & { maxContentLength?: number }) => {
	if (Buffer.isBuffer(item)) {
		return { stream: toReadable(item), type: 'buffer' } as const
	}

	if ('stream' in item) {
		return { stream: item.stream, type: 'readable' } as const
	}

	const urlStr = item.url.toString()

	if (urlStr.startsWith('data:')) {
		const buffer = Buffer.from(urlStr.split(',')[1]!, 'base64')
		return { stream: toReadable(buffer), type: 'buffer' } as const
	}

	if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
		return { stream: await getHttpStream(item.url, opts), type: 'remote' } as const
	}

	return { stream: createReadStream(item.url), type: 'file' } as const
}

/** generates a thumbnail for a given media, if required */
export async function generateThumbnail(
	bufferOrPath: Buffer | string,
	mediaType: 'video' | 'image',
	options: {
		logger?: ILogger
	}
) {
	let thumbnail: string | undefined
	let originalImageDimensions: { width: number; height: number } | undefined
	if (mediaType === 'image') {
		const { buffer, original } = await extractImageThumb(bufferOrPath)
		thumbnail = buffer.toString('base64')
		if (original.width && original.height) {
			originalImageDimensions = {
				width: original.width,
				height: original.height
			}
		}
	} else if (mediaType === 'video') {
		// Video thumbnails need ffmpeg + file on disk
		let filePath: string
		let needsCleanup = false
		if (Buffer.isBuffer(bufferOrPath)) {
			filePath = join(getTmpFilesDirectory(), 'vid-' + randomId())
			await fs.writeFile(filePath, bufferOrPath)
			needsCleanup = true
		} else {
			filePath = bufferOrPath
		}

		const imgFilename = join(getTmpFilesDirectory(), randomId() + '.jpg')
		try {
			await extractVideoThumb(filePath, imgFilename, '00:00:00', { width: 32, height: 32 })
			const buff = await fs.readFile(imgFilename)
			thumbnail = buff.toString('base64')

			await fs.unlink(imgFilename)
		} catch (err) {
			options.logger?.debug('could not generate video thumb: ' + err)
		}

		if (needsCleanup) {
			try {
				await fs.unlink(filePath)
			} catch {
				/* ignore */
			}
		}
	}

	return {
		thumbnail,
		originalImageDimensions
	}
}

export const getHttpStream = async (url: string | URL, options: RequestInit & { isStream?: true } = {}) => {
	const response = await fetch(url.toString(), {
		dispatcher: options.dispatcher,
		method: 'GET',
		headers: options.headers as HeadersInit
	})
	if (!response.ok) {
		throw new Boom(`Failed to fetch stream from ${url}`, { statusCode: response.status, data: { url } })
	}

	// @ts-ignore Node18+ Readable.fromWeb exists
	return response.body instanceof Readable ? response.body : Readable.fromWeb(response.body as WebReadableStream)
}

export type MediaDownloadOptions = {
	options?: RequestInit
}

export const DEF_MEDIA_HOST = 'mmg.whatsapp.net'

export const getUrlFromDirectPath = (directPath: string, host: string = DEF_MEDIA_HOST): string =>
	`https://${host}${directPath}`

export function extensionForMediaMessage(message: WAMessageContent): string {
	const getExtension = (mimetype: string) => mimetype.split(';')[0]?.split('/')[1]
	const type = Object.keys(message)[0] as Exclude<MessageType, 'toJSON'>
	if (type === 'locationMessage' || type === 'liveLocationMessage' || type === 'productMessage') return '.jpeg'
	return getExtension((message[type] as WAGenericMediaMessage).mimetype!)!
}

const getMediaRetryKey = (mediaKey: Buffer | Uint8Array) =>
	hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' })

export const encryptMediaRetryRequest = (
	key: WAMessageKey,
	mediaKey: Buffer | Uint8Array,
	meId: string
): BinaryNode => {
	const receiptBuffer = proto.ServerErrorReceipt.encode({ stanzaId: key.id }).finish()
	const iv = randomBytes(12)
	const ciphertext = aesEncryptGCM(receiptBuffer, getMediaRetryKey(mediaKey), iv, Buffer.from(key.id!))
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
	msgId: string
): proto.MediaRetryNotification =>
	proto.MediaRetryNotification.decode(aesDecryptGCM(ciphertext, getMediaRetryKey(mediaKey), iv, Buffer.from(msgId)))
