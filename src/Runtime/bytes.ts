/**
 * Portable byte helpers for the runtime-neutral graph.
 *
 * Everything here runs on `Uint8Array` + globals available in every host
 * (TextEncoder/TextDecoder, base64 via btoa/atob-free manual codec). Node
 * `Buffer` conveniences stay at the compat boundary (`Utils/*`), never in
 * `Socket/core.ts`, `Runtime/*` or the host entrypoint.
 */

import { sha256 as bridgeSha256 } from '@oxidezap/whatsapp-rust-bridge/host'

const HEX_DIGITS = '0123456789abcdef'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Preserve Node's historical Buffer shape when that optional global exists. */
export const publicBytes = (bytes: Uint8Array): Uint8Array => {
	const BufferCtor = (globalThis as typeof globalThis & { Buffer?: { from(value: Uint8Array): Uint8Array } }).Buffer
	return BufferCtor ? BufferCtor.from(bytes) : bytes
}

/** Concatenate byte views without copying through Buffer. */
export const concatBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
	let total = 0
	for (const part of parts) total += part.length
	const out = new Uint8Array(total)
	let offset = 0
	for (const part of parts) {
		out.set(part, offset)
		offset += part.length
	}
	return out
}

/** Constant-shape equality (length check first, then byte compare). */
export const unixTimestampSeconds = (timestamp: number | Date = Date.now()): number =>
	Math.floor((timestamp instanceof Date ? timestamp.getTime() : timestamp) / 1000)

export const getKeyAuthorPortable = (
	key:
		| {
				fromMe?: boolean | null
				participantAlt?: string | null
				remoteJidAlt?: string | null
				participant?: string | null
				remoteJid?: string | null
		  }
		| null
		| undefined,
	meId = 'me'
): string => (key?.fromMe ? meId : key?.participantAlt || key?.remoteJidAlt || key?.participant || key?.remoteJid) || ''

export const toNumber = (
	t: { toNumber?: () => number; low?: number; high?: number } | number | null | undefined
): number => {
	if (t == null) return 0
	if (typeof t === 'number') return t
	if (typeof t.toNumber === 'function') return t.toNumber()
	if (typeof t.low === 'number') return (t.high ?? 0) * 0x100000000 + (t.low >>> 0)
	return 0
}

export const isBytes = <T extends Uint8Array = Uint8Array>(value: unknown): value is T => value instanceof Uint8Array

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

export const utf8Encode = (text: string): Uint8Array => new TextEncoder().encode(text)

export const utf8Decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(bytes)

export const hexEncode = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i]!
		out += HEX_DIGITS[byte >> 4]! + HEX_DIGITS[byte & 0x0f]!
	}
	return out
}

export const hexDecode = (text: string): Uint8Array => {
	if (text.length % 2 !== 0) throw new RangeError('hex string has odd length')
	const out = new Uint8Array(text.length / 2)
	for (let i = 0; i < out.length; i++) {
		const hi = HEX_DIGITS.indexOf(text[2 * i]!.toLowerCase())
		const lo = HEX_DIGITS.indexOf(text[2 * i + 1]!.toLowerCase())
		if (hi < 0 || lo < 0) throw new RangeError(`invalid hex at offset ${2 * i}`)
		out[i] = (hi << 4) | lo
	}
	return out
}

export const base64Encode = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i]!
		const b = bytes[i + 1] ?? 0
		const c = bytes[i + 2] ?? 0
		const triple = (a << 16) | (b << 8) | c
		out += BASE64_ALPHABET[(triple >> 18) & 0x3f]!
		out += BASE64_ALPHABET[(triple >> 12) & 0x3f]!
		out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f]! : '='
		out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f]! : '='
	}
	return out
}

const base64Value = (char: string): number => {
	if (char === '=') return 0
	const index = BASE64_ALPHABET.indexOf(char)
	if (index < 0) throw new RangeError(`invalid base64 character: ${char}`)
	return index
}

export const base64Decode = (text: string): Uint8Array => {
	let clean = text.replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/')
	const firstPadding = clean.indexOf('=')
	if (firstPadding >= 0) {
		const padding = clean.length - firstPadding
		if (
			padding > 2 ||
			clean
				.slice(firstPadding)
				.split('')
				.some(char => char !== '=')
		)
			throw new RangeError('invalid base64 padding')
		if (clean.length % 4 !== 0 || firstPadding % 4 < 2) throw new RangeError('invalid base64 padding')
	} else if (clean.length % 4 === 1) {
		throw new RangeError('invalid base64 length')
	}
	// Tolerate valid unpadded input the way Buffer.from(…, 'base64') does.
	while (clean.length % 4 !== 0) clean += '='
	const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
	const out = new Uint8Array((clean.length / 4) * 3 - pad)
	let offset = 0
	for (let i = 0; i < clean.length; i += 4) {
		const quad =
			(base64Value(clean[i]!) << 18) |
			(base64Value(clean[i + 1]!) << 12) |
			(base64Value(clean[i + 2]!) << 6) |
			base64Value(clean[i + 3]!)
		if (offset < out.length) out[offset++] = (quad >> 16) & 0xff
		if (offset < out.length) out[offset++] = (quad >> 8) & 0xff
		if (offset < out.length) out[offset++] = quad & 0xff
	}
	return out
}

/** URL-safe base64 without padding (tag prefixes, key ids). */
export const base64UrlEncode = (bytes: Uint8Array): string =>
	base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const base64UrlDecode = (text: string): Uint8Array => {
	let padded = text.replace(/-/g, '+').replace(/_/g, '/')
	while (padded.length % 4 !== 0) padded += '='
	return base64Decode(padded)
}

export const readU16BE = (bytes: Uint8Array, offset = 0): number => ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0

export const writeU16BE = (value: number): Uint8Array => new Uint8Array([(value >>> 8) & 0xff, value & 0xff])

/** Big-endian 64-bit write as two 32-bit words (registration ids stay numeric). */
export const writeU64BE = (high: number, low: number): Uint8Array =>
	new Uint8Array([
		(high >>> 24) & 0xff,
		(high >>> 16) & 0xff,
		(high >>> 8) & 0xff,
		high & 0xff,
		(low >>> 24) & 0xff,
		(low >>> 16) & 0xff,
		(low >>> 8) & 0xff,
		low & 0xff
	])

/** WebCrypto-backed random bytes — identical cost to node:crypto (measured). */
export const randomBytes = (length: number): Uint8Array => {
	const out = new Uint8Array(length)
	if (length > 0) globalThis.crypto.getRandomValues(out)
	return out
}

/**
 * Synchronous SHA-256, allocation-shaped as a fresh 32-byte digest.
 *
 * `node:crypto` stays the Node implementation (measured ~2.5x faster);
 * this self-contained compression function serves hosts without it and
 * the two synchronous call sites that cannot await `subtle.digest`
 * (message IDs, poll vote hashes). Stays non-Promise either way.
 * Pinned byte-for-byte against `node:crypto` by the crypto differential.
 */
const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
	0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
	0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
	0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

const sha256SyncPortable = (data: Uint8Array): Uint8Array => {
	let h0 = 0x6a09e667,
		h1 = 0xbb67ae85,
		h2 = 0x3c6ef372,
		h3 = 0xa54ff53a,
		h4 = 0x510e527f,
		h5 = 0x9b05688c,
		h6 = 0x1f83d9ab,
		h7 = 0x5be0cd19
	const bytes = data.length
	const bitLength = bytes * 8
	const paddedLength = (((bytes + 8) >> 6) + 1) << 6
	const padded = new Uint8Array(paddedLength)
	padded.set(data)
	padded[bytes] = 0x80
	const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
	view.setUint32(paddedLength - 4, bitLength >>> 0)
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
	const w = new Uint32Array(64)
	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
		for (let i = 16; i < 64; i++) {
			const s0 =
				((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^ ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^ (w[i - 15]! >>> 3)
			const s1 =
				((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^ ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^ (w[i - 2]! >>> 10)
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
		}
		let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7]
		for (let i = 0; i < 64; i++) {
			const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
			const ch = (e & f) ^ (~e & g)
			const t1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) | 0
			const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
			const maj = (a & b) ^ (a & c) ^ (b & c)
			const t2 = (s0 + maj) | 0
			h = g
			g = f
			f = e
			e = (d + t1) | 0
			d = c
			c = b
			b = a
			a = (t1 + t2) | 0
		}
		h0 = (h0 + a) | 0
		h1 = (h1 + b) | 0
		h2 = (h2 + c) | 0
		h3 = (h3 + d) | 0
		h4 = (h4 + e) | 0
		h5 = (h5 + f) | 0
		h6 = (h6 + g) | 0
		h7 = (h7 + h) | 0
	}
	const out = new Uint8Array(32)
	const outView = new DataView(out.buffer)
	outView.setUint32(0, h0 >>> 0)
	outView.setUint32(4, h1 >>> 0)
	outView.setUint32(8, h2 >>> 0)
	outView.setUint32(12, h3 >>> 0)
	outView.setUint32(16, h4 >>> 0)
	outView.setUint32(20, h5 >>> 0)
	outView.setUint32(24, h6 >>> 0)
	outView.setUint32(28, h7 >>> 0)
	return out
}

/** The pinned host bridge exposes this wasm-bindgen failure before initSync. */
export const isBridgeWasmUnavailableError = (error: unknown): boolean =>
	error instanceof TypeError && error.message.includes('__wbindgen_add_to_stack_pointer')

/** Alias kept for call sites migrating off `node:crypto`. */
export const sha256Sync = (data: Uint8Array): Uint8Array => {
	try {
		return bridgeSha256(data)
	} catch (error) {
		if (isBridgeWasmUnavailableError(error)) return sha256SyncPortable(data)
		throw error
	}
}

export const bytesToUtf8 = utf8Decode
export const utf8ToBytes = utf8Encode

/** Timer handle with duck-typed `unref` (present on Node, absent on hosts). */
export type PortableTimer = { unref?: () => void; ref?: () => void }

/**
 * Arm a one-shot timer, unref'ing on runtimes that support it so a pending
 * timeout never keeps the process alive past its last socket. Host timers
 * without `unref` simply stay referenced for their (short) duration.
 */
export const unrefTimer = (timer: unknown): unknown => {
	try {
		;(timer as PortableTimer | undefined)?.unref?.()
	} catch {
		/* a throwing unref must not break the arming call site */
	}
	return timer
}
