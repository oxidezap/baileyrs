/**
 * Hostile scalar and container generators shared by several fuzzers.
 *
 * The numeric list is the important one. Most parity bugs between a Rust
 * implementation and a JavaScript one live at the boundaries where a JS number
 * stops being exact (2^53), where a signed 32-bit value wraps, and where
 * protobuf's 64-bit integers stop fitting in a `number` at all — so those values
 * are enumerated rather than left to chance.
 */

import type { Random } from '../harness/random.ts'

/** Integer boundaries worth hitting on purpose, as numbers. */
export const BOUNDARY_NUMBERS = [
	0, 1, -1, 2, 7, 127, 128, 255, 256, 32_767, 32_768, 65_535, 65_536,
	2_147_483_647, 2_147_483_648, -2_147_483_648, -2_147_483_649, 4_294_967_295, 4_294_967_296,
	Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER
] as const

/** Values that are numbers to JavaScript but not integers to a protobuf encoder. */
export const HOSTILE_NUMBERS = [
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	-0,
	0.5,
	1.5,
	-1.5,
	1e21,
	1e-7,
	9_007_199_254_740_993
] as const

/** 64-bit boundaries, as the decimal strings untyped callers actually pass. */
export const BIG_INTEGER_STRINGS = [
	'0',
	'1',
	'-1',
	'9007199254740991',
	'9007199254740992',
	'9007199254740993',
	'9223372036854775807',
	'-9223372036854775808',
	'18446744073709551615',
	'18446744073709551616'
] as const

export const HOSTILE_STRINGS = [
	'',
	' ',
	'a',
	'0',
	'null',
	'undefined',
	'{}',
	'[]',
	'\0',
	'\n',
	'\t\r\n',
	'"',
	'\\',
	'👨‍👩‍👧‍👦',
	'é',
	'\uD800', // lone high surrogate: not valid UTF-8, and the encoders disagree on what to do
	'\uDFFF', // lone low surrogate
	'﻿',
	'x'.repeat(1_024),
	'../../etc/passwd',
	'%s%n',
	'𝕬𝖑𝖕𝖍𝖆'
] as const

export const generateNumber = (random: Random): number =>
	random.weighted<() => number>([
		[5, () => random.pick(BOUNDARY_NUMBERS)],
		[2, () => random.pick(HOSTILE_NUMBERS)],
		[3, () => random.int(-1_000, 1_000)],
		[1, () => random.next() * 1e12]
	])()

export const generateString = (random: Random): string =>
	random.weighted<() => string>([
		[5, () => random.pick(HOSTILE_STRINGS)],
		[3, () => Buffer.from(random.bytes(random.int(0, 24))).toString('hex')],
		[2, () => String.fromCodePoint(...Array.from({ length: random.int(0, 12) }, () => random.int(1, 0x10_ff_ff)))]
	])()

export const generateBytes = (random: Random): Uint8Array =>
	random.weighted<() => Uint8Array>([
		[4, () => random.bytes(random.int(0, 64))],
		[2, () => new Uint8Array(0)],
		[2, () => random.bytes(random.pick([1, 15, 16, 17, 31, 32, 33, 63, 64, 65]))],
		[1, () => new Uint8Array(random.int(0, 128))]
	])()

/** Anything at all — for the helpers whose declared parameter type is not the contract. */
export const generateAnyValue = (random: Random, depth = 0): unknown =>
	random.weighted<() => unknown>([
		[4, () => generateString(random)],
		[4, () => generateNumber(random)],
		[2, () => random.bool()],
		[2, () => undefined],
		[2, () => null],
		[2, () => generateBytes(random)],
		[1, () => random.pick(BIG_INTEGER_STRINGS)],
		[
			depth < 2 ? 2 : 0,
			() => Array.from({ length: random.int(0, 4) }, () => generateAnyValue(random, depth + 1))
		],
		[
			depth < 2 ? 2 : 0,
			() => {
				const out: Record<string, unknown> = {}
				for (let index = 0; index < random.int(0, 4); index++) {
					const key = random.pick(['a', 'b', 'id', 'key', 'type', 'value', '0', '__proto__', 'constructor'])
					// `out.__proto__ = x` swaps the prototype; `defineProperty` keeps it
					// an own data property. The latter is both the more hostile input and
					// the shape `JSON.parse` actually produces.
					Object.defineProperty(out, key, {
						value: generateAnyValue(random, depth + 1),
						enumerable: true,
						writable: true,
						configurable: true
					})
				}
				return out
			}
		]
	])()
