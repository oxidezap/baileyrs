import { Buffer } from 'node:buffer'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import { Boom } from './boom.ts'
const baileysVersion = DEFAULT_CONNECTION_CONFIG.version
import type { AuthenticationCreds, WAVersion } from '../Types/index.ts'

/** unix timestamp of a date in seconds */
export const unixTimestampSeconds = (date: Date = new Date()) => Math.floor(date.getTime() / 1000)

/**
 * Promise-based timeout. Mirrors upstream Baileys' `delay` so bot code that
 * destructures `delay` from the package keeps working unchanged.
 */
export const delay = (ms: number): Promise<void> =>
	new Promise(resolve => {
		setTimeout(resolve, ms)
	})

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

/**
 * Returns a minimal {@link AuthenticationCreds} placeholder. All real credential
 * material is owned by the Rust bridge; this stub exists only for upstream
 * Baileys code paths that call `initAuthCreds()` to seed a fresh `auth.creds`
 * object before pairing. The returned object is safe to pass as `auth.creds`
 * but the bridge will ignore every field except `me`/`registered`/`platform`.
 */
export const initAuthCreds = (): AuthenticationCreds => ({
	registered: false
})

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

/**
 * Alias for {@link fetchLatestWaWebVersion}. Kept for source-level compatibility
 * with upstream Baileys code that imports `fetchLatestBaileysVersion`.
 */
export const fetchLatestBaileysVersion = fetchLatestWaWebVersion
