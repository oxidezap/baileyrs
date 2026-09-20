/**
 * Portable byte helpers for the runtime-neutral graph.
 *
 * Everything here runs on `Uint8Array` + globals available in every host
 * (TextEncoder/TextDecoder, base64 via btoa/atob-free manual codec). Node
 * `Buffer` conveniences stay at the compat boundary (`Utils/*`), never in
 * `Socket/core.ts`, `Runtime/*` or the host entrypoint.
 */

const HEX_DIGITS = '0123456789abcdef'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

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
	const clean = text.replace(/[\s]/g, '')
	if (clean.length % 4 !== 0) throw new RangeError('base64 string length must be a multiple of 4')
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

/** Alias kept for call sites migrating off `node:crypto`. */
export const bytesToUtf8 = utf8Decode
export const utf8ToBytes = utf8Encode
