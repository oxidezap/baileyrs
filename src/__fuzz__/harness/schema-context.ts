/**
 * The schema a wire scan needs to read a payload the way a real decoder does.
 *
 * `wire.ts` states the rule this exists to serve: the wire format does not
 * distinguish a nested message from a `bytes` field, so a scan without a schema
 * has to guess, and *every caller that has a schema passes it*. This module is
 * what makes that possible from more than one fuzzer — it used to live inside
 * the codec differential, which is why the robustness fuzzer framed only the top
 * level of a mutated payload and called a submessage corruption "well-formed".
 *
 * The schema records the repeated flag and the nested type but not the field
 * *number*, so each number is recovered the way the field-number sweep recovers
 * it: encode the field alone and read the tag back. Built per message, lazily,
 * so a run only pays for the types it actually looks at.
 */

import { encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { PROTO_FIELD_FLAG, PROTO_FIELD_KIND } from '../../WAProto/compatibility-schema.ts'
import { fieldsOfPath, messagePathOfField } from '../generators/proto.ts'
import type { SchemaContext } from './wire.ts'

const upstream = (await import('baileys')) as unknown as { proto: Record<string, unknown> }

export interface UpstreamType {
	encode(message: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): unknown
	toObject(message: unknown, options: Record<string, unknown>): Record<string, unknown>
}

/**
 * protobufjs namespaces nest, so a schema path is a lookup chain.
 *
 * The intermediate segments are *functions*, not objects: `proto.Message` is the
 * generated Type constructor, and `Message.ExtendedTextMessage` hangs off it as a
 * static. A `typeof === 'object'` guard here silently skips every nested type,
 * which is most of the schema.
 */
export const upstreamType = (path: string): UpstreamType | undefined => {
	let cursor: unknown = upstream.proto
	for (const segment of path.split('.')) {
		if (cursor === null || (typeof cursor !== 'object' && typeof cursor !== 'function')) return undefined
		cursor = (cursor as Record<string, unknown>)[segment]
	}
	const candidate = cursor as unknown as UpstreamType | undefined
	return typeof cursor === 'function' && typeof candidate?.encode === 'function' ? candidate : undefined
}

/** The field number of the first tag in a payload, or undefined if it does not parse. */
export const firstFieldNumber = (bytes: Uint8Array): number | undefined => {
	let result = 0n
	let shift = 0n
	for (let index = 0; index < bytes.length && index < 10; index++) {
		const byte = bytes[index]!
		result |= BigInt(byte & 0x7f) << shift
		if ((byte & 0x80) === 0) {
			const field = result >> 3n
			return field >= 1n && field <= 536_870_911n ? Number(field) : undefined
		}
		shift += 7n
	}
	return undefined
}

/** A non-default sample for a field kind, so the encode below emits the tag. */
export const sampleFor = (kind: number): unknown => {
	switch (kind) {
		case PROTO_FIELD_KIND.string:
			return 'x'
		case PROTO_FIELD_KIND.bool:
			return true
		case PROTO_FIELD_KIND.bytes:
			return new Uint8Array([1])
		default:
			return 7
	}
}

/** The kinds protobuf may pack, which is what makes a repeated field ambiguous. */
const PACKABLE_KINDS: ReadonlySet<number> = new Set([
	PROTO_FIELD_KIND.enum,
	PROTO_FIELD_KIND.bool,
	PROTO_FIELD_KIND.signed32,
	PROTO_FIELD_KIND.unsigned32,
	PROTO_FIELD_KIND.signed64,
	PROTO_FIELD_KIND.unsigned64
])

/**
 * Per-message field-number metadata, for telling packing apart from a wrong wire
 * type and a nested message apart from a `bytes` field.
 *
 * Field numbers are unique per message, not globally: this schema has 30
 * repeated scalar fields against 1734 singular ones drawing from the same small
 * numbers, so a global set would answer "repeated" for nearly every singular
 * field.
 */
interface FieldFacts {
	readonly repeated: ReadonlySet<number>
	readonly messages: ReadonlyMap<number, string>
	/** Numbers two different fields claim — see `factsFor`. Empty across the schema today. */
	readonly contested: ReadonlySet<number>
}

const fieldFactsByPath = new Map<string, FieldFacts>()

/**
 * Every number a field is written under, asking both encoders rather than one.
 *
 * The two disagree on exactly one field out of 2421 —
 * `Message.pollResultSnapshotMessageV3` is 114 upstream and 115 in the bridge —
 * and the payloads these scans read are bridge-produced, so upstream's number
 * alone leaves the bridge's spelling of that submessage looking like opaque
 * bytes. Both are recorded because both are correct, each for the encoder that
 * wrote the payload; nothing else in `Message` claims either number, on either
 * side, so recording both cannot make a different field misframe.
 *
 * Measured rather than listed: a hardcoded exception would be exactly the
 * hand-kept list the field-number sweep exists to replace. A field only one
 * encoder can write (17 of them, all bridge-unwritable) keeps the one number
 * that exists for it.
 */
const numbersFor = (path: string, type: UpstreamType | undefined, name: string, value: unknown): number[] => {
	const numbers: number[] = []
	const record = (bytes: Uint8Array | undefined): void => {
		const number = bytes === undefined ? undefined : firstFieldNumber(bytes)
		if (number !== undefined && !numbers.includes(number)) numbers.push(number)
	}
	try {
		record(type?.encode({ [name]: value }).finish())
	} catch {
		/* the field is one this encoder refuses; the other may still write it */
	}
	try {
		record(encodeProto(path, { [name]: value }))
	} catch {
		/* same */
	}
	return numbers
}

/**
 * Two encoders' numbers per field means a number could, in principle, be claimed
 * by two different fields — and the scan would then frame a payload against
 * whichever one it wrote down last.
 *
 * Measured across the whole schema: 2422 claims, no collisions, so the ambiguity
 * is theoretical today. It stays checked rather than asserted in a comment
 * because the thing that would create one is a schema regeneration, which is
 * exactly the moment nobody re-reads this file. `harness.test.ts` fails on the
 * first collision anywhere in the schema, which is the loud half.
 *
 * The quiet half is here: a contested number is recorded by *neither* field.
 * The scan then treats it as opaque bytes — the answer it gave before this file
 * knew about nested messages at all. Wrong-but-conservative beats confidently
 * framing a payload against the wrong submessage, which is a finding reported at
 * a location that does not exist.
 */
const factsFor = (path: string): FieldFacts => {
	const cached = fieldFactsByPath.get(path)
	if (cached) return cached

	const repeated = new Set<number>()
	const messages = new Map<number, string>()
	const claimant = new Map<number, string>()
	const contested = new Set<number>()
	const type = upstreamType(path)
	if (type) {
		for (const field of fieldsOfPath(path)) {
			if ((field[3] & PROTO_FIELD_FLAG.map) !== 0) continue
			const isMessage = field[1] === PROTO_FIELD_KIND.message
			const one = isMessage ? {} : sampleFor(field[1])
			const isRepeated = (field[3] & PROTO_FIELD_FLAG.repeated) !== 0
			const nested = messagePathOfField(field)
			for (const number of numbersFor(path, type, field[0], isRepeated ? [one] : one)) {
				const prior = claimant.get(number)
				if (prior !== undefined && prior !== field[0]) {
					contested.add(number)
					continue
				}
				claimant.set(number, field[0])
				if (isRepeated && PACKABLE_KINDS.has(field[1])) repeated.add(number)
				if (nested !== undefined) messages.set(number, nested)
			}
		}
	}
	// After the sweep, not during: the first field to claim a number has already
	// recorded it by the time the second one arrives.
	for (const number of contested) {
		repeated.delete(number)
		messages.delete(number)
	}

	const facts: FieldFacts = { repeated, messages, contested }
	fieldFactsByPath.set(path, facts)
	return facts
}

/** The numbers more than one field claims on this message. Empty across the schema today. */
export const contestedFieldNumbers = (path: string): readonly number[] => [...factsFor(path).contested]

export const schemaAt = (path: string): SchemaContext => ({
	path,
	isRepeated: (at, field) => factsFor(at).repeated.has(field),
	messageAt: (at, field) => factsFor(at).messages.get(field)
})
