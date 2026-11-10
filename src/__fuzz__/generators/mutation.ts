/**
 * Byte-level mutators for the decoder robustness fuzzer.
 *
 * Random bytes are almost never valid protobuf, so a decoder rejects them in the
 * first few instructions and nothing interesting is ever reached. Mutating a
 * *valid* encoding is what gets past the outer checks and into the parsing loop —
 * a truncated length prefix, a varint that never terminates, a field that claims
 * to be longer than the buffer.
 *
 * Every mutator is deterministic given the same random stream, so any crash it
 * finds replays from the seed.
 */

import type { Random } from '../harness/random.ts'

export interface Mutation {
	readonly label: string
	readonly bytes: Uint8Array
}

const flipBit = (random: Random, bytes: Uint8Array): Uint8Array => {
	if (bytes.length === 0) return bytes
	const copy = bytes.slice()
	const index = random.below(copy.length)
	copy[index] = copy[index]! ^ (1 << random.below(8))
	return copy
}

const replaceByte = (random: Random, bytes: Uint8Array): Uint8Array => {
	if (bytes.length === 0) return bytes
	const copy = bytes.slice()
	copy[random.below(copy.length)] = random.below(256)
	return copy
}

const truncate = (random: Random, bytes: Uint8Array): Uint8Array =>
	bytes.slice(0, bytes.length === 0 ? 0 : random.below(bytes.length))

const dropByte = (random: Random, bytes: Uint8Array): Uint8Array => {
	if (bytes.length === 0) return bytes
	const index = random.below(bytes.length)
	return Uint8Array.from([...bytes.slice(0, index), ...bytes.slice(index + 1)])
}

const insertByte = (random: Random, bytes: Uint8Array): Uint8Array => {
	const index = random.below(bytes.length + 1)
	return Uint8Array.from([...bytes.slice(0, index), random.below(256), ...bytes.slice(index)])
}

const duplicateRun = (random: Random, bytes: Uint8Array): Uint8Array => {
	if (bytes.length === 0) return bytes
	const start = random.below(bytes.length)
	const end = start + 1 + random.below(Math.min(16, bytes.length - start))
	const run = bytes.slice(start, end)
	return Uint8Array.from([...bytes, ...run])
}

/** Ten continuation bytes: a varint that never terminates. */
const varintOverflow = (random: Random, bytes: Uint8Array): Uint8Array => {
	const index = bytes.length === 0 ? 0 : random.below(bytes.length)
	return Uint8Array.from([...bytes.slice(0, index), ...Array.from({ length: 10 }, () => 0xff), ...bytes.slice(index)])
}

/** A length-delimited field claiming far more bytes than the buffer holds. */
const lyingLength = (random: Random, bytes: Uint8Array): Uint8Array =>
	Uint8Array.from([0x0a, random.pick([0x7f, 0xff]), ...bytes])

/**
 * The tag bytes of each step in a message cycle, for the nesting bomb.
 *
 * `Message` reaches itself in two hops — `ephemeralMessage` (field 40) holds a
 * `FutureProofMessage`, whose `message` (field 1) is a `Message` again — so a
 * chain built along those two tags is a genuine recursive *message* descent.
 */
export type MessageCycle = readonly (readonly number[])[]

/** Length-delimited framing for one wrap: tag, varint length, payload. */
const wrap = (tag: readonly number[], payload: Uint8Array): Uint8Array => {
	const length: number[] = []
	let size = payload.length
	do {
		length.push(size > 0x7f ? (size & 0x7f) | 0x80 : size & 0x7f)
		size >>>= 7
	} while (size > 0)
	return Uint8Array.from([...tag, ...length, ...payload])
}

/**
 * A message nested `depth` times, following a real cycle in the schema when one
 * is supplied.
 *
 * This is the shape that turns a recursive-descent parser into a stack overflow,
 * and the one a hostile peer would send.
 *
 * The cycle matters. Wrapping everything in a hard-coded field 1 produces a
 * deeply nested *length-delimited value* on any schema whose field 1 is a scalar
 * — which exercises the length and bounds path at depth, but is one message deep,
 * so a decoder with an unbounded recursive descent passes it at any advertised
 * depth. Given a cycle, each wrap is another message the decoder must actually
 * recurse into.
 */
const nestingBomb = (random: Random, bytes: Uint8Array, cycle?: MessageCycle): Uint8Array => {
	let payload: Uint8Array = Uint8Array.from(bytes.slice(0, Math.min(bytes.length, 8)))
	const depth = random.pick([16, 64, 256, 1_024, 4_096])
	const steps: MessageCycle = cycle && cycle.length > 0 ? cycle : [[0x0a]]
	for (let level = 0; level < depth; level++) {
		if (payload.length > 0x3f_ff) break
		for (let step = steps.length - 1; step >= 0; step--) payload = wrap(steps[step]!, payload)
	}
	return payload
}

/**
 * Two valid encodings back to back.
 *
 * Protobuf defines this as a merge, not as corruption — last value wins for
 * scalars, repeated fields concatenate, nested messages merge recursively. It is
 * a legal input that most hand-rolled parsers get wrong.
 */
const concatenate = (bytes: Uint8Array, other: Uint8Array): Uint8Array => Uint8Array.from([...bytes, ...other])

export const MUTATORS = [
	'flip-bit',
	'replace-byte',
	'truncate',
	'drop-byte',
	'insert-byte',
	'duplicate-run',
	'varint-overflow',
	'lying-length',
	'nesting-bomb',
	'concatenate',
	'empty',
	'random'
] as const

export type MutatorName = (typeof MUTATORS)[number]

export const mutate = (
	random: Random,
	bytes: Uint8Array,
	other: Uint8Array,
	mutator: MutatorName,
	cycle?: MessageCycle
): Mutation => {
	switch (mutator) {
		case 'flip-bit':
			return { label: mutator, bytes: flipBit(random, bytes) }
		case 'replace-byte':
			return { label: mutator, bytes: replaceByte(random, bytes) }
		case 'truncate':
			return { label: mutator, bytes: truncate(random, bytes) }
		case 'drop-byte':
			return { label: mutator, bytes: dropByte(random, bytes) }
		case 'insert-byte':
			return { label: mutator, bytes: insertByte(random, bytes) }
		case 'duplicate-run':
			return { label: mutator, bytes: duplicateRun(random, bytes) }
		case 'varint-overflow':
			return { label: mutator, bytes: varintOverflow(random, bytes) }
		case 'lying-length':
			return { label: mutator, bytes: lyingLength(random, bytes) }
		case 'nesting-bomb':
			return { label: mutator, bytes: nestingBomb(random, bytes, cycle) }
		case 'concatenate':
			return { label: mutator, bytes: concatenate(bytes, other) }
		case 'empty':
			return { label: mutator, bytes: new Uint8Array(0) }
		case 'random':
			return { label: mutator, bytes: random.bytes(random.int(0, 128)) }
		default:
			return { label: 'identity', bytes }
	}
}
