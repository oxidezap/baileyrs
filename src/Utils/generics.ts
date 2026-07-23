import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { Boom } from './boom.ts'
import { Curve, signedKeyPair } from './crypto.ts'
const baileysVersion = DEFAULT_CONNECTION_CONFIG.version
import type {
	AuthenticationCreds,
	BaileysEventEmitter,
	BaileysEventMap,
	BinaryNode,
	ConnectionState,
	WACallUpdateType,
	WAMessageKey,
	WAVersion
} from '../Types/index.ts'
import { DisconnectReason } from '../Types/index.ts'
import { getAllBinaryNodeChildren } from '../WABinary/generic-utils.ts'
import { jidDecode } from '../WABinary/jid-utils.ts'

/** Resolve the upstream-visible author identity, preferring alternate addressing fields. */
export const getKeyAuthor = (key: WAMessageKey | undefined | null, meId = 'me') =>
	(key?.fromMe ? meId : key?.participantAlt || key?.remoteJidAlt || key?.participant || key?.remoteJid) || ''

export const isStringNullOrEmpty = (value: string | null | undefined): value is null | undefined | '' =>
	value == null || value === ''

export const writeRandomPadMax16 = (msg: Uint8Array): Buffer<ArrayBuffer> => {
	const padLength = (randomBytes(1)[0]! & 0x0f) + 1
	return Buffer.concat([msg, Buffer.alloc(padLength, padLength)]) as Buffer<ArrayBuffer>
}

export const unpadRandomMax16 = (e: Uint8Array | Buffer): Uint8Array<ArrayBuffer> => {
	const bytes = new Uint8Array(e)
	if (bytes.length === 0) throw new Error('unpadPkcs7 given empty bytes')
	const padLength = bytes[bytes.length - 1]!
	if (padLength > bytes.length) {
		throw new Error(`unpad given ${bytes.length} bytes, but pad is ${padLength}`)
	}
	return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length - padLength)
}

/** Hash a sorted participant list using WhatsApp's compact v2 representation. */
export const generateParticipantHashV2 = (participants: string[]): string => {
	participants.sort()
	const hash = createHash('sha256')
		.update(Buffer.from(participants.join('')))
		.digest('base64')
	return `2:${hash.slice(0, 6)}`
}

export const encodeWAMessage = (message: proto.IMessage): Buffer<ArrayBuffer> =>
	writeRandomPadMax16(proto.Message.encode(message).finish())

export const generateRegistrationId = (): number => Uint16Array.from(randomBytes(2))[0]! & 16_383

export const encodeBigEndian = (value: number, length = 4): Uint8Array => {
	let remaining = value
	const bytes = new Uint8Array(length)
	for (let index = length - 1; index >= 0; index--) {
		bytes[index] = remaining & 0xff
		remaining >>>= 8
	}
	return bytes
}

/** unix timestamp of a date in seconds */
export const unixTimestampSeconds = (date?: Date) => Math.floor((date ? date.getTime() : Date.now()) / 1000)

/**
 * Coerce a protobuf timestamp into a plain JS number. Matches upstream
 * Baileys' `Utils/generics.ts:toNumber` — protobufjs may hand us a `Long`
 * (`{ low, high, toNumber() }`), a plain number, or `null`/`undefined`.
 *
 * When the value is a Long without a `.toNumber()` method, we fall back to
 * `low` only when `high === 0` — otherwise the value exceeds 32 bits and
 * dropping `high` would silently truncate (e.g. messageTimestamps in ms
 * past 2038). For oversized values we still call into Number conversion
 * manually so the caller gets a usable approximation rather than a
 * zero-shifted lie.
 */
export const toNumber = (
	t: { toNumber?: () => number; low?: number; high?: number } | number | null | undefined
): number => {
	if (t == null) return 0
	if (typeof t === 'number') return t
	if (typeof t === 'object') {
		if (typeof t.toNumber === 'function') return t.toNumber()
		if (typeof t.low === 'number') {
			// Reconstruct from low/high pair when present. JS numbers
			// preserve precision up to 2^53; protobuf int64 can exceed
			// that, but timestamps in ms / seconds are well within range
			// for the next ~284k years, so this is safe in practice.
			const high = typeof t.high === 'number' ? t.high : 0
			return high * 0x100000000 + (t.low >>> 0)
		}
	}
	return 0
}

/**
 * Promise-based timeout. Mirrors upstream Baileys' `delay` so bot code that
 * destructures `delay` from the package keeps working unchanged.
 */
export type DebouncedTimeout = ReturnType<typeof debouncedTimeout>

export const debouncedTimeout = (intervalMs = 1000, task?: () => void) => {
	let timeout: NodeJS.Timeout | undefined
	return {
		start: (newIntervalMs?: number, newTask?: () => void) => {
			task = newTask || task
			intervalMs = newIntervalMs || intervalMs
			if (timeout) clearTimeout(timeout)
			timeout = setTimeout(() => task?.(), intervalMs)
		},
		cancel: () => {
			if (timeout) clearTimeout(timeout)
			timeout = undefined
		},
		setTask: (newTask: () => void) => (task = newTask),
		setInterval: (newInterval: number) => (intervalMs = newInterval)
	}
}

export const delay = (ms: number): Promise<void> => delayCancellable(ms).delay

export const delayCancellable = (ms: number) => {
	const stack = new Error().stack
	let timeout: NodeJS.Timeout
	let rejectDelay!: (error: unknown) => void
	const delayPromise = new Promise<void>((resolve, reject) => {
		timeout = setTimeout(resolve, ms)
		rejectDelay = reject
	})
	const cancel = () => {
		clearTimeout(timeout)
		rejectDelay(new Boom('Cancelled', { statusCode: 500, data: { stack } }))
	}
	return { delay: delayPromise, cancel }
}

export async function promiseTimeout<T>(
	ms: number | undefined,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	promise: (resolve: (v: T) => void, reject: (error: any) => void) => void
): Promise<T> {
	if (!ms) return new Promise<T>(promise)

	const stack = new Error().stack
	const cancellable = delayCancellable(ms)
	const result = new Promise<T>((resolve, reject) => {
		cancellable.delay
			.then(() => reject(new Boom('Timed Out', { statusCode: DisconnectReason.timedOut, data: { stack } })))
			.catch(reject)
		promise(resolve, reject)
	})
	return result.finally(cancellable.cancel)
}

export const generateMessageIDV2 = (userId?: string): string => {
	const data = Buffer.alloc(44)
	data.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)))
	if (userId) {
		const decoded = jidDecode(userId)
		if (decoded?.user) {
			data.write(decoded.user, 8)
			data.write('@c.us', 8 + decoded.user.length)
		}
	}
	randomBytes(16).copy(data, 28)
	return `3EB0${createHash('sha256').update(data).digest('hex').toUpperCase().substring(0, 18)}`
}

export const generateMessageID = (): string => `3EB0${randomBytes(18).toString('hex').toUpperCase()}`

export function bindWaitForEvent<T extends keyof BaileysEventMap>(ev: BaileysEventEmitter, event: T) {
	return async (check: (update: BaileysEventMap[T]) => Promise<boolean | undefined>, timeoutMs?: number) => {
		let listener!: (item: BaileysEventMap[T]) => void
		let closeListener!: (state: Partial<ConnectionState>) => void
		await promiseTimeout<void>(timeoutMs, (resolve, reject) => {
			closeListener = ({ connection, lastDisconnect }) => {
				if (connection === 'close') {
					reject(
						lastDisconnect?.error || new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
					)
				}
			}
			ev.on('connection.update', closeListener)
			listener = async update => {
				if (await check(update)) resolve()
			}
			ev.on(event, listener)
		}).finally(() => {
			ev.off(event, listener)
			ev.off('connection.update', closeListener)
		})
	}
}

export const bindWaitForConnectionUpdate = (ev: BaileysEventEmitter) => bindWaitForEvent(ev, 'connection.update')

interface BufferLike {
	type?: string
	buffer?: boolean
	data?: unknown
	value?: unknown
}

/**
 * JSON replacer/reviver pair for serializing `Buffer`/`Uint8Array` values as
 * `{ type: 'Buffer', data: <base64> }`. API-compatible with the upstream Baileys
 * `BufferJSON` helper — drop-in replacement for legacy auth-state code that
 * persists creds via `JSON.stringify(state, BufferJSON.replacer)`.
 */
export const BufferJSON = {
	replacer: (_: string, value: unknown) => {
		// Buffer.toJSON() fires before replacer sees the value, so by the time we
		// get here the replacer mostly sees `{ type: 'Buffer', data: [..] }`. Cover
		// both that case and the rare raw-Buffer case (e.g. inside a Map serializer).
		if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
			return { type: 'Buffer', data: Buffer.from(value).toString('base64') }
		}

		if (value !== null && typeof value === 'object' && (value as BufferLike).type === 'Buffer') {
			const data = (value as BufferLike).data
			if (Array.isArray(data) || data instanceof Uint8Array || Buffer.isBuffer(data)) {
				return { type: 'Buffer', data: Buffer.from(data as ArrayLike<number>).toString('base64') }
			}
		}

		return value
	},
	reviver: (_: string, value: unknown) => {
		if (
			value !== null &&
			value !== undefined &&
			typeof value === 'object' &&
			((value as BufferLike).type === 'Buffer' || (value as BufferLike).buffer === true)
		) {
			const data = (value as BufferLike).data ?? (value as BufferLike).value
			return typeof data === 'string'
				? Buffer.from(data, 'base64')
				: Buffer.from((Array.isArray(data) ? data : []) as number[])
		}

		return value
	}
}

/** Seed a fresh `auth.creds` object with valid Signal key material. */
export const initAuthCreds = (): AuthenticationCreds => {
	const signedIdentityKey = Curve.generateKeyPair()
	return {
		noiseKey: Curve.generateKeyPair(),
		pairingEphemeralKeyPair: Curve.generateKeyPair(),
		signedIdentityKey,
		signedPreKey: signedKeyPair(signedIdentityKey, 1),
		registrationId: randomBytes(2).readUInt16BE() & 0x3fff,
		advSecretKey: randomBytes(32).toString('base64'),
		processedHistoryMessages: [],
		nextPreKeyId: 1,
		firstUnuploadedPreKeyId: 1,
		accountSyncCounter: 0,
		accountSettings: { unarchiveChats: false },
		registered: false,
		pairingCode: undefined,
		lastPropHash: undefined,
		routingInfo: undefined,
		additionalData: undefined
	}
}

/** Remove undefined own properties in place, matching upstream Baileys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trimUndefined(obj: { [key: string]: any }) {
	for (const key in obj) {
		if (obj[key] === undefined) delete obj[key]
	}
	return obj
}

export const fetchLatestWaWebVersion = async (options: RequestInit = {}) => {
	try {
		const defaultHeaders = {
			'sec-fetch-site': 'none',
			'user-agent':
				'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
		}

		const headers = { ...defaultHeaders, ...options.headers }

		const response = await fetch('https://web.whatsapp.com/sw.js', {
			...options,
			method: 'GET',
			headers
		})

		if (!response.ok) {
			throw new Boom(`Failed to fetch sw.js: ${response.statusText}`, { statusCode: response.status })
		}

		const data = await response.text()
		const regex = /\\?"client_revision\\?":\s*(\d+)/
		const match = data.match(regex)

		if (!match?.[1]) {
			return {
				version: baileysVersion,
				isLatest: false,
				error: { message: 'Could not find client revision in the fetched content' }
			}
		}

		return {
			version: [2, 3000, +match[1]] as WAVersion,
			isLatest: true
		}
	} catch (error) {
		return { version: baileysVersion, isLatest: false, error }
	}
}

/** Fetch the version declared by the current upstream Baileys source. */
export const fetchLatestBaileysVersion = async (options: RequestInit = {}) => {
	const sourceUrl = 'https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/index.ts'
	try {
		const response = await fetch(sourceUrl, {
			dispatcher: options.dispatcher,
			method: 'GET',
			headers: options.headers
		})
		if (!response.ok) {
			throw new Boom(`Failed to fetch latest Baileys version: ${response.statusText}`, {
				statusCode: response.status
			})
		}

		const source = await response.text()
		const match = source.match(/const version = \[(\d+),\s*(\d+),\s*(\d+)\]/)
		if (!match) throw new Error('Could not parse version from Defaults/index.ts')
		return {
			version: [Number(match[1]), Number(match[2]), Number(match[3])] as WAVersion,
			isLatest: true as const
		}
	} catch (error) {
		return { version: baileysVersion, isLatest: false as const, error }
	}
}

/** Unique message tag prefix for MD clients. */
export const generateMdTagPrefix = (): string => {
	const bytes = randomBytes(4)
	return `${bytes.readUInt16BE()}.${bytes.readUInt16BE(2)}-`
}

const STATUS_MAP: Record<string, proto.WebMessageInfo.Status> = {
	sender: proto.WebMessageInfo.Status.SERVER_ACK,
	played: proto.WebMessageInfo.Status.PLAYED,
	read: proto.WebMessageInfo.Status.READ,
	'read-self': proto.WebMessageInfo.Status.READ
}

export const getStatusFromReceiptType = (type: string | undefined): proto.WebMessageInfo.Status | undefined =>
	type === undefined ? proto.WebMessageInfo.Status.DELIVERY_ACK : STATUS_MAP[type]

const STREAM_ERROR_CODES: Record<string, DisconnectReason> = {
	conflict: DisconnectReason.connectionReplaced
}

export const getErrorCodeFromStreamError = (node: BinaryNode): { reason: string; statusCode: number } => {
	const [reasonNode] = getAllBinaryNodeChildren(node)
	let reason = reasonNode?.tag || 'unknown'
	const statusCode = +(node.attrs.code || STREAM_ERROR_CODES[reason] || DisconnectReason.badSession)
	if (statusCode === DisconnectReason.restartRequired) reason = 'restart required'
	return { reason, statusCode }
}

export const getCallStatusFromNode = ({ tag, attrs }: BinaryNode): WACallUpdateType => {
	switch (tag) {
		case 'offer':
		case 'offer_notice':
			return 'offer'
		case 'terminate':
			return attrs.reason === 'timeout' ? 'timeout' : 'terminate'
		case 'preaccept':
			return 'preaccept'
		case 'transport':
			return 'transport'
		case 'relaylatency':
			return 'relaylatency'
		case 'reject':
			return 'reject'
		case 'accept':
			return 'accept'
		default:
			return 'ringing'
	}
}

const UNEXPECTED_SERVER_CODE_TEXT = 'Unexpected server response: '

export const getCodeFromWSError = (error: Error): number => {
	let statusCode = 500
	if (error?.message?.includes(UNEXPECTED_SERVER_CODE_TEXT)) {
		const code = +error.message.slice(UNEXPECTED_SERVER_CODE_TEXT.length)
		if (!Number.isNaN(code) && code >= 400) statusCode = code
	} else if (
		(typeof (error as Error & { code?: unknown }).code === 'string' &&
			(error as Error & { code: string }).code.startsWith('E')) ||
		error?.message?.includes('timed out')
	) {
		statusCode = 408
	}
	return statusCode
}

export const isWABusinessPlatform = (platform: string): platform is 'smba' | 'smbi' =>
	platform === 'smbi' || platform === 'smba'

const CROCKFORD_CHARACTERS = '123456789ABCDEFGHJKLMNPQRSTVWXYZ'

export function bytesToCrockford(buffer: Buffer): string {
	let value = 0
	let bitCount = 0
	const crockford: string[] = []
	for (const byte of buffer) {
		value = (value << 8) | (byte & 0xff)
		bitCount += 8
		while (bitCount >= 5) {
			crockford.push(CROCKFORD_CHARACTERS.charAt((value >>> (bitCount - 5)) & 31))
			bitCount -= 5
		}
	}
	if (bitCount > 0) crockford.push(CROCKFORD_CHARACTERS.charAt((value << (5 - bitCount)) & 31))
	return crockford.join('')
}

export function encodeNewsletterMessage(message: proto.IMessage): Uint8Array {
	return proto.Message.encode(message).finish()
}
