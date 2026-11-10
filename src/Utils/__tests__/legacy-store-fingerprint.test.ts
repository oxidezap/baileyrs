/**
 * The mirror fingerprint's one job is to notice that something else rewrote the
 * legacy projection. It is computed from the live object on write and from
 * whatever the store returns on read, so it can only key on distinctions that
 * survive a store — and every persisted store round-trips through JSON.
 *
 * `canonicalize` therefore has to agree with `JSON.stringify` about `undefined`,
 * which is deliberately asymmetric: an object property disappears, an array
 * element becomes `null`. Collapsing both to "drop it" would trade one
 * instability for another, so the array case is pinned here separately.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import { encodeNativeEnvelope } from '../../Compatibility/legacy-store/common.ts'
import { expect } from '../../__tests__/expect.ts'
import { BufferJSON } from '../generics.ts'

/** The envelope is magic + digest + payload; an empty payload leaves the digest. */
const digest = (value: unknown): string => encodeNativeEnvelope(new Uint8Array(), value).subarray(4).toString('hex')

const sameDigest = (a: unknown, b: unknown) => digest(a) === digest(b)

/**
 * What the store does to a value before it is fingerprinted again. `BufferJSON`
 * is the upstream contract every Baileys-shaped store honours, and restoring
 * bytes is part of it — a store that returned `{type:'Buffer'}` instead of a
 * `Buffer` would already break upstream, so the fingerprint does not try to
 * absorb that.
 */
const throughStore = (value: unknown): unknown =>
	JSON.parse(JSON.stringify(value, BufferJSON.replacer) ?? 'null', BufferJSON.reviver)

describe('legacy-store fingerprint: agrees with JSON about undefined', () => {
	test('an undefined-valued property hashes as if the key were absent', () => {
		expect(sameDigest({ a: 1, b: undefined }, { a: 1 })).toBe(true)
	})

	test('an undefined array element hashes as null, not as a hole', () => {
		expect(sameDigest([1, undefined, 2], [1, null, 2])).toBe(true)
	})

	/**
	 * The guard on the asymmetry. `JSON.stringify([1, undefined, 2])` is
	 * `[1,null,2]`, not `[1,2]` — an implementation that dropped `undefined`
	 * everywhere would make a two-element array collide with a three-element
	 * one and stop noticing a real edit.
	 */
	test('an undefined array element is not dropped', () => {
		expect(sameDigest([1, undefined, 2], [1, 2])).toBe(false)
	})

	test('a top-level absent value hashes as null', () => {
		expect(sameDigest(undefined, null)).toBe(true)
	})

	test('nested undefined properties follow the same rule', () => {
		expect(sameDigest({ outer: { a: 1, b: undefined } }, { outer: { a: 1 } })).toBe(true)
	})
})

describe('legacy-store fingerprint: is stable across a store round trip', () => {
	const CASES: Array<[string, unknown]> = [
		['an undefined-valued property', { a: 1, b: undefined }],
		['a nested undefined-valued property', { outer: { a: 1, b: undefined } }],
		['an undefined array element', { list: [1, undefined, 2] }],
		['a projection-shaped record', { _sessions: { key: { pendingPreKey: undefined, _chains: {} } }, version: 'v1' }],
		['bytes', { key: Buffer.from([1, 2, 3]) }],
		['a plain value', { a: 1, b: 'two', c: true, d: null }]
	]

	for (const [label, value] of CASES) {
		test(`${label} survives JSON`, () => {
			expect(sameDigest(value, throughStore(value))).toBe(true)
		})
	}
})

describe('legacy-store fingerprint: still notices a real edit', () => {
	test('a changed value changes the digest', () => {
		expect(sameDigest({ a: 1 }, { a: 2 })).toBe(false)
	})

	test('an added key changes the digest', () => {
		expect(sameDigest({ a: 1 }, { a: 1, b: 2 })).toBe(false)
	})

	test('a key set to null is not the same as a key that is absent', () => {
		expect(sameDigest({ a: null }, {})).toBe(false)
	})

	test('bytes and their base64 spelling are not the same', () => {
		expect(sameDigest({ a: Buffer.from([1, 2, 3]) }, { a: Buffer.from([1, 2, 3]).toString('base64') })).toBe(false)
	})

	test('a reordered object is the same, since a store may not keep key order', () => {
		expect(sameDigest({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
	})
})
