// Strict validation for data crossing the legacy compatibility boundary.
import type { Buffer } from 'node:buffer'
import { NumericEncoding, SignalKeyLength } from './constants.ts'
import { toBytes } from './common.ts'

const UNSIGNED_DECIMAL = /^\d+$/

export function parseUnsignedDecimal(value: string, label = 'value'): number {
	if (!UNSIGNED_DECIMAL.test(value)) throw new TypeError(`${label} must be an unsigned decimal integer`)
	const parsed = Number.parseInt(value, NumericEncoding.BASE_10)
	if (!Number.isSafeInteger(parsed)) throw new RangeError(`${label} is outside the safe integer range`)
	return parsed
}

export function requireBytes(value: unknown, label: string): Uint8Array {
	const bytes = toBytes(value)
	if (!bytes) throw new TypeError(`${label} must be a Uint8Array`)
	return bytes
}

/** Normalize a raw or already-prefixed Curve public key for libsignal. */
export function serializeSignalPublicKey(value: unknown, label: string): Uint8Array {
	const bytes = requireBytes(value, label)
	if (bytes.length === SignalKeyLength.CURVE_PUBLIC_PREFIXED && bytes[0] === SignalKeyLength.CURVE_PUBLIC_PREFIX) {
		return bytes
	}
	if (bytes.length !== SignalKeyLength.CURVE_PRIVATE) {
		throw new TypeError(`${label} must be a 32-byte raw or 33-byte serialized public key`)
	}
	const serialized = new Uint8Array(SignalKeyLength.CURVE_PUBLIC_PREFIXED)
	serialized[0] = SignalKeyLength.CURVE_PUBLIC_PREFIX
	serialized.set(bytes, 1)
	return serialized
}

export function requireByteArray(value: unknown, label: string): number[] {
	if (!Array.isArray(value) || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) {
		throw new TypeError(`${label} must be an array of bytes`)
	}
	return value as number[]
}

export function requireSafeUnsignedInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a safe unsigned integer`)
	}
	return value
}

export function isAllZero(value: Uint8Array | Buffer | null | undefined): boolean {
	if (!value || value.length === 0) return true
	return value.every(byte => byte === 0)
}
