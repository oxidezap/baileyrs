// Shared codecs for the Baileys legacy-store compatibility boundary.
import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { CanonicalTag, JsonByteEncoding, MirrorEnvelope } from './constants.ts'

const ENVELOPE_MAGIC = Buffer.from(MirrorEnvelope.MAGIC, JsonByteEncoding.UTF8)
const NATIVE_ONLY_ENVELOPE_MAGIC = Buffer.from(MirrorEnvelope.NATIVE_ONLY_MAGIC, JsonByteEncoding.UTF8)
const DIGEST_LENGTH = createHash(MirrorEnvelope.HASH).digest().length
const HEADER_LENGTH = ENVELOPE_MAGIC.length + DIGEST_LENGTH
const NATIVE_ONLY_HEADER_LENGTH = NATIVE_ONLY_ENVELOPE_MAGIC.length + DIGEST_LENGTH

export const EMPTY_BYTES = new Uint8Array()

export const toJsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

export const fromJsonBytes = (value: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(value))

export const toBytes = (value: unknown): Uint8Array | null => {
	if (value instanceof Uint8Array || Buffer.isBuffer(value)) return new Uint8Array(value)
	return null
}

export const bytesToNumbers = (value: Uint8Array | Buffer): number[] => Array.from(value)

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical }

/**
 * Marks a value JSON would not have kept, so the object and array branches can
 * each drop it the way `JSON.stringify` does. A plain `undefined` return could
 * not be told apart from a property that is genuinely absent.
 */
const ABSENT: unique symbol = Symbol('absent')

/**
 * Stable, runtime-independent representation used only to notice legacy-side
 * ownership changes. Buffer and Uint8Array intentionally share one shape.
 *
 * `undefined` follows `JSON.stringify`, and that is deliberately asymmetric: an
 * object property is dropped, an array element becomes `null`. The fingerprint
 * is taken from the live projection when the mirror is written and from the
 * reloaded one when it is read, so any distinction a store cannot carry makes
 * the two disagree forever. Tagging `undefined` as its own value was such a
 * distinction — no persisted store can express it, and the mirror it invalidated
 * is the only copy of the record fields the projection has no room for.
 */
function canonicalize(value: unknown, seen: Set<object>): Canonical | typeof ABSENT {
	if (value === null) return null
	if (value === undefined) return ABSENT
	if (typeof value === 'string' || typeof value === 'boolean') return value
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return { [CanonicalTag.NUMBER]: 'NaN' }
		if (value === Infinity) return { [CanonicalTag.NUMBER]: 'Infinity' }
		if (value === -Infinity) return { [CanonicalTag.NUMBER]: '-Infinity' }
		if (Object.is(value, -0)) return { [CanonicalTag.NUMBER]: '-0' }
		return value
	}
	if (typeof value === 'bigint') return { [CanonicalTag.BIGINT]: value.toString() }
	if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
		return { [CanonicalTag.BYTES]: Buffer.from(value).toString(JsonByteEncoding.BASE64) }
	}
	if (value instanceof Date) return { [CanonicalTag.DATE]: value.toISOString() }
	if (typeof value !== 'object') return { [CanonicalTag.UNSUPPORTED]: typeof value }
	if (seen.has(value)) throw new TypeError('cannot fingerprint a cyclic legacy store value')
	seen.add(value)
	try {
		if (Array.isArray(value)) {
			return value.map(item => {
				const canonical = canonicalize(item, seen)
				return canonical === ABSENT ? null : canonical
			})
		}
		const out: Record<string, Canonical> = {}
		for (const key of Object.keys(value).toSorted()) {
			const canonical = canonicalize((value as Record<string, unknown>)[key], seen)
			if (canonical !== ABSENT) out[key] = canonical
		}
		return out
	} finally {
		seen.delete(value)
	}
}

function fingerprintLegacy(value: unknown): Buffer {
	// A top-level absent value hashes as `null`: a store reports a row it does
	// not hold as either, and the two have to agree for the same reason the
	// property case does.
	const canonical = canonicalize(value, new Set())
	return createHash(MirrorEnvelope.HASH)
		.update(JSON.stringify(canonical === ABSENT ? null : canonical))
		.digest()
}

export type NativeEnvelope = {
	payload: Uint8Array
	legacyDigest: Buffer | null
	nativeOnly: boolean
}

/** Persist exact native bytes together with the projection generation. */
export function encodeNativeEnvelope(payload: Uint8Array, legacyValue: unknown): Buffer {
	return Buffer.concat([ENVELOPE_MAGIC, fingerprintLegacy(legacyValue), Buffer.from(payload)])
}

/**
 * Persist canonical bytes when the legacy model cannot represent their state.
 * The legacy fingerprint still detects a later write from another owner.
 */
export function encodeNativeOnlyEnvelope(payload: Uint8Array, legacyValue: unknown): Buffer {
	return Buffer.concat([NATIVE_ONLY_ENVELOPE_MAGIC, fingerprintLegacy(legacyValue), Buffer.from(payload)])
}

/**
 * A non-envelope value is accepted as an old exact mirror and revalidated.
 * This makes the storage format forward-compatible with early local builds.
 */
export function decodeNativeEnvelope(value: unknown): NativeEnvelope | null {
	const bytes = toBytes(value)
	if (!bytes) return null
	const buffer = Buffer.from(bytes)
	if (buffer.subarray(0, NATIVE_ONLY_ENVELOPE_MAGIC.length).equals(NATIVE_ONLY_ENVELOPE_MAGIC)) {
		if (buffer.length < NATIVE_ONLY_HEADER_LENGTH) {
			throw new TypeError('native-only mirror envelope is truncated')
		}
		return {
			nativeOnly: true,
			legacyDigest: buffer.subarray(NATIVE_ONLY_ENVELOPE_MAGIC.length, NATIVE_ONLY_HEADER_LENGTH),
			payload: new Uint8Array(buffer.subarray(NATIVE_ONLY_HEADER_LENGTH))
		}
	}
	if (buffer.length < HEADER_LENGTH || !buffer.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
		return { payload: new Uint8Array(buffer), legacyDigest: null, nativeOnly: false }
	}
	return {
		nativeOnly: false,
		legacyDigest: buffer.subarray(ENVELOPE_MAGIC.length, HEADER_LENGTH),
		payload: new Uint8Array(buffer.subarray(HEADER_LENGTH))
	}
}

export function envelopeMatchesLegacy(envelope: NativeEnvelope, legacyValue: unknown): boolean {
	return !!envelope.legacyDigest && timingSafeEqual(envelope.legacyDigest, fingerprintLegacy(legacyValue))
}
