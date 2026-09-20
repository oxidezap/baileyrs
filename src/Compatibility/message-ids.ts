/**
 * Portable message-identity helpers for the runtime-neutral graph.
 *
 * `generateMessageIDV2` is the one place every send path resolves a stanza
 * id through (`Compatibility/message-relay.ts:resolveMessageId`, group
 * invite stubs). The bytes are identical to `Utils/generics.ts` — 8-byte
 * big-endian unix seconds, user JID + `@c.us`, 16 random bytes, SHA-256 hex,
 * `3EB0` prefix — but built on `Runtime/bytes.ts` (portable SHA-256,
 * WebCrypto randomness) instead of `node:crypto` + `Buffer`, so hosts get
 * the same ids without a Node import.
 */

import { concatBytes, hexEncode, randomBytes, sha256Sync, utf8Encode, writeU64BE } from '../Runtime/bytes.ts'

const MESSAGE_ID_PREFIX = '3EB0'
const MESSAGE_ID_BYTES = 44
const RANDOM_OFFSET = 28

const writeAsciiInto = (target: Uint8Array, text: string, offset: number): void => {
	const bytes = utf8Encode(text)
	const length = Math.min(bytes.length, target.length - offset)
	for (let i = 0; i < length; i++) target[offset + i] = bytes[i]!
}

/** Extract the user part of a JID without importing the JID utils (cycle-safe). */
const jidUser = (jid: string): string | undefined => {
	const at = jid.indexOf('@')
	const user = at < 0 ? jid : jid.slice(0, at)
	return user.length > 0 ? user : undefined
}

export const generateMessageIDV2Portable = (userId?: string): string => {
	const data = new Uint8Array(MESSAGE_ID_BYTES)
	const seconds = Math.floor(Date.now() / 1000)
	data.set(writeU64BE(0, seconds >>> 0), 0)
	const user = userId ? jidUser(userId) : undefined
	if (user) {
		writeAsciiInto(data, user, 8)
		writeAsciiInto(data, '@c.us', 8 + utf8Encode(user).length)
	}
	data.set(randomBytes(16), RANDOM_OFFSET)
	return `${MESSAGE_ID_PREFIX}${hexEncode(sha256Sync(data)).toUpperCase().slice(0, 18)}`
}

/** `3EB0` + 36 uppercase hex chars from 18 random bytes (matches `generateMessageID`). */
export const generateMessageIDPortable = (): string => `3EB0${hexEncode(randomBytes(18)).toUpperCase()}`

/** Concatenate without Buffer (pad helper for the portable graph). */
export const concatMessageBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array => concatBytes(parts)
