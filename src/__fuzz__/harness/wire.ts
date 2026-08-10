/**
 * Protobuf wire-format canonicaliser.
 *
 * The two encoders emit fields in different orders — the Rust codec follows the
 * order of the keys on the object it was handed, protobufjs follows the order the
 * fields are declared in the schema. Protobuf itself says both are valid and any
 * decoder must accept either, so a raw byte comparison reports a difference on
 * almost every multi-field message and drowns out everything that matters.
 *
 * Canonicalising sorts the fields, recursively, so the comparison asks the
 * question worth asking: *are the same fields carrying the same values on the
 * wire*. Ordering is then reported separately, where it can be judged on its own.
 *
 * A length-delimited field is a nested message, a string or a byte string, and
 * the wire format does not distinguish them. Given a `SchemaContext` this asks
 * the schema, which is exact. Without one it falls back to parsing as a nested
 * message whenever the payload frames cleanly — and that heuristic is not merely
 * imprecise, it can misclassify: reordering the bytes *inside* a string that
 * happens to be valid protobuf would then compare equal under canonicalisation
 * and be routed to the allowlisted field-order class, excusing a changed value as
 * a spelling difference. Every caller that has a schema passes it.
 */

export interface WireField {
	readonly field: number
	readonly wireType: number
	/** Canonical rendering of the value: hex, or the canonical form of a nested message. */
	readonly value: string
	/**
	 * For wire type 2, the payload as hex — always, even when `value` rendered it
	 * as a nested message.
	 *
	 * A packed run of varints is frequently also valid as a nested message, so
	 * `value` may hold `{131072:0:0}` where the bytes are `0000...`. Unpacking has
	 * to read the bytes, not the rendering; without this the packing detector
	 * simply failed on those payloads and reported an ordinary two-element repeated
	 * field as a codec mismatch.
	 */
	readonly raw?: string
	/**
	 * The field's bytes exactly as they were written, tag varint included.
	 *
	 * `value` is the *decoded* number for a varint, so `08 81 00` and `08 01` both
	 * render as `1:0:1` — two spellings of field 1 holding 1, one of them
	 * non-minimal. That is what makes the field-order class unsafe on `value`
	 * alone: nothing was reordered, yet the two payloads canonicalise identically
	 * and the difference is classified as ordering, whose intended divergence
	 * excuses it target-wide. The tag and length varints have the same freedom.
	 *
	 * Nested messages recurse, so a reordering *inside* a submessage still reads as
	 * ordering. Groups do not: their whole record is kept verbatim, which reports a
	 * reordered group rather than excusing it — nothing in this schema declares one.
	 *
	 * Absent on fields rebuilt by `parseNested`, which reads a rendering rather than
	 * bytes and so cannot know how they were written. `spell` refuses to answer for
	 * those instead of treating "no spelling" as a spelling they share.
	 */
	readonly spelled?: string
	/**
	 * For wire type 2 that parsed as a nested message, the parsed children.
	 *
	 * Kept from the original scan rather than recovered by re-parsing `value`:
	 * a round trip through the rendered string loses `raw` on every child, and the
	 * packing checks below need those bytes.
	 */
	readonly nested?: readonly WireField[]
}

interface Cursor {
	readonly bytes: Uint8Array
	offset: number
}

/** The bytes of one span, exactly as written — the raw material for `spelled`. */
const hexBetween = (bytes: Uint8Array, start: number, end: number): string =>
	Buffer.from(bytes.slice(start, end)).toString('hex')

const readVarint = (cursor: Cursor): bigint | undefined => {
	let result = 0n
	let shift = 0n
	for (let index = 0; index < 10; index++) {
		if (cursor.offset >= cursor.bytes.length) return undefined
		const byte = cursor.bytes[cursor.offset++]!
		// Nine bytes carry 63 bits, so the tenth may only contribute bit 63 — any
		// other payload bit puts the value past 64 and the encoding is malformed.
		// Accepting it would let `canonicalWire` call mutated bytes well-formed,
		// which routes a decoder disagreement to `proto:mutation-agreement` (a real
		// codec bug) instead of `proto:mutation-interpretation` (a strictness
		// difference on bytes with no defined meaning).
		if (index === 9 && (byte & 0x7f) > 0x01) return undefined
		result |= BigInt(byte & 0x7f) << shift
		if ((byte & 0x80) === 0) return result
		shift += 7n
	}
	return undefined
}

const scan = (bytes: Uint8Array, depth: number, schema?: SchemaContext): WireField[] | undefined =>
	scanFrom({ bytes, offset: 0 }, depth, schema)

/**
 * Reads fields from `cursor` until the buffer ends, or until the group named by
 * `groupField` is closed.
 *
 * Groups (wire types 3 and 4) are the deprecated encoding, and nothing in these
 * protos declares one — but "no schema uses it" is not the same as "it is not
 * protobuf". A *balanced* group is well-formed on the wire, and returning
 * `undefined` for it told `canonicalWire` the bytes were unframed, which routes a
 * disagreement between two decoders that both accepted the payload into
 * `proto:mutation-interpretation` (a strictness difference on bytes with no
 * meaning) instead of `proto:mutation-agreement` (a real codec bug). So balanced
 * groups are parsed and skipped; an unmatched open or close is still malformed,
 * which is the honest answer for those.
 */
const scanFrom = (
	cursor: Cursor,
	depth: number,
	schema?: SchemaContext,
	groupField?: number
): WireField[] | undefined => {
	const bytes = cursor.bytes
	const fields: WireField[] = []

	while (cursor.offset < bytes.length) {
		const recordStart = cursor.offset
		const tag = readVarint(cursor)
		if (tag === undefined) return undefined
		const tagHex = hexBetween(bytes, recordStart, cursor.offset)

		const fieldNumber = tag >> 3n
		// Protobuf caps field numbers at 2^29-1. Past 2^53 `Number()` also rounds,
		// so two different payloads would render as the same field — and a payload
		// with an impossible field number would be called well-formed, which flips
		// the robustness fuzzer's well-formed/malformed classification.
		if (fieldNumber < 1n || fieldNumber > 536_870_911n) return undefined
		const field = Number(fieldNumber)
		const wireType = Number(tag & 7n)

		switch (wireType) {
			case 0: {
				const valueStart = cursor.offset
				const value = readVarint(cursor)
				if (value === undefined) return undefined
				fields.push({
					field,
					wireType,
					value: value.toString(),
					spelled: `${tagHex}${hexBetween(bytes, valueStart, cursor.offset)}`
				})
				break
			}
			case 1: {
				if (cursor.offset + 8 > bytes.length) return undefined
				const slice = bytes.slice(cursor.offset, cursor.offset + 8)
				cursor.offset += 8
				const rendered = Buffer.from(slice).toString('hex')
				fields.push({ field, wireType, value: rendered, spelled: `${tagHex}${rendered}` })
				break
			}
			case 2: {
				const lengthStart = cursor.offset
				const length = readVarint(cursor)
				if (length === undefined) return undefined
				const lengthHex = hexBetween(bytes, lengthStart, cursor.offset)
				const size = Number(length)
				if (!Number.isSafeInteger(size) || size < 0 || cursor.offset + size > bytes.length) return undefined
				const slice = bytes.slice(cursor.offset, cursor.offset + size)
				cursor.offset += size

				// With a schema, a length-delimited field is parsed as a nested message
				// only when the schema says it is one. Without that, a string or bytes
				// value whose contents happen to frame as protobuf gets its apparent
				// fields sorted — so reordering the *bytes of a string* would compare
				// equal and be routed to the allowlisted field-order class, which is a
				// changed value excused as a spelling difference.
				const child = descend(schema, field)
				const parseNestedHere = schema === undefined || child !== undefined
				const nested = size > 0 && depth > 0 && parseNestedHere ? scan(slice, depth - 1, child) : undefined
				const raw = Buffer.from(slice).toString('hex')
				fields.push({
					field,
					wireType,
					value: nested ? `{${render(nested)}}` : raw,
					raw,
					nested,
					// The length varint is kept as written and the payload recursed into,
					// so a submessage whose fields were merely reordered still spells the
					// same while a re-spelled length does not.
					spelled: `${tagHex}${lengthHex}${nested ? `{${spell(nested)}}` : raw}`
				})
				break
			}
			case 5: {
				if (cursor.offset + 4 > bytes.length) return undefined
				const slice = bytes.slice(cursor.offset, cursor.offset + 4)
				cursor.offset += 4
				const rendered = Buffer.from(slice).toString('hex')
				fields.push({ field, wireType, value: rendered, spelled: `${tagHex}${rendered}` })
				break
			}
			case 3: {
				// Start of a group: its fields are read from the same cursor until the
				// matching close tag.
				if (depth <= 0) return undefined
				const nested = scanFrom(cursor, depth - 1, descend(schema, field), field)
				if (nested === undefined) return undefined
				fields.push({
					field,
					wireType,
					value: `{${render(nested)}}`,
					nested,
					// Verbatim, close tag included: the recursive call has already moved
					// the cursor past it. Reordering inside a group is therefore not
					// excused as ordering — the safe direction for an encoding no message
					// in this schema declares.
					spelled: hexBetween(bytes, recordStart, cursor.offset)
				})
				break
			}
			case 4:
				// End of a group. Legal only as the close of the one being read; a
				// stray close tag is malformed.
				if (groupField === undefined || field !== groupField) return undefined
				return fields
			default:
				// Wire types 6 and 7 have never been assigned a meaning.
				return undefined
		}
	}

	// Running out of bytes ends the message at the top level, but leaves a group
	// unterminated — which is exactly the malformed case this still rejects.
	return groupField === undefined ? fields : undefined
}

/**
 * Renders a field list so that field *order* does not matter but repeated-field
 * *occurrence* order does.
 *
 * Protobuf lets a sender emit fields in any order, so two encoders disagreeing
 * about that is a representation difference. It does not let the occurrences of
 * one repeated field be reordered: that order is the decoded array's order.
 * Sorting every entry conflated the two — `[a, b]` and `[b, a]` canonicalised
 * identically, so an encoder that reversed an array was classified as
 * `proto:field-order` and excused as harmless.
 *
 * Sorting on the field number *alone* fixes both halves: `Array.prototype.sort`
 * is stable, so occurrences of one field keep their relative order, and the
 * numeric comparison also stops field 10 sorting before field 2.
 *
 * No wire-type tiebreaker. One repeated scalar can legally mix packed and
 * unpacked occurrences, and a tiebreaker reorders those against each other:
 * unpacked `1` then packed `[2]` and packed `[2]` then unpacked `1`
 * canonicalised identically, though decoders read `[1, 2]` and `[2, 1]`.
 */
const render = (fields: readonly WireField[]): string =>
	[...fields]
		.toSorted((left, right) => left.field - right.field)
		.map(entry => `${entry.field}:${entry.wireType}:${entry.value}`)
		.join(',')

/**
 * `render`'s exact twin: same ordering rule, but each field written out as the
 * bytes that actually carried it rather than as its decoded value.
 */
const spell = (fields: readonly WireField[]): string | undefined => {
	const ordered = [...fields].toSorted((left, right) => left.field - right.field)
	return ordered.some(entry => entry.spelled === undefined) ? undefined : ordered.map(entry => entry.spelled).join(',')
}

/** Order-insensitive rendering of a message's fields, or undefined if it does not parse. */
export const canonicalWire = (bytes: Uint8Array, schema?: SchemaContext): string | undefined => {
	const fields = scan(bytes, 12, schema)
	return fields === undefined ? undefined : render(fields)
}

/** Order-sensitive rendering, for telling a pure ordering difference from a real one. */
export const orderedWire = (bytes: Uint8Array, schema?: SchemaContext): string | undefined => {
	const fields = scan(bytes, 12, schema)
	return fields === undefined
		? undefined
		: fields.map(entry => `${entry.field}:${entry.wireType}:${entry.value}`).join(',')
}

/** True when two payloads carry the same fields and values, whatever the order. */
export const sameWireContent = (left: Uint8Array, right: Uint8Array, schema?: SchemaContext): boolean => {
	const a = canonicalWire(left, schema)
	const b = canonicalWire(right, schema)
	if (a === undefined || b === undefined) return Buffer.from(left).equals(Buffer.from(right))
	return a === b
}

/**
 * True when two payloads are the same field records in a different order — every
 * field written with the same bytes, only their positions moved.
 *
 * Strictly stronger than `sameWireContent`, and the one the field-order class has
 * to ask. `sameWireContent` compares decoded values, so it also answers true when
 * an encoder re-spelled a varint: field 1's value 1 as `08 81 00` rather than
 * `08 01` reorders nothing, yet canonicalises identically and would be waved
 * through by the ordering entry's intended divergence. A codec that started
 * emitting non-minimal tag, length or value varints could then keep the run green.
 */
export const sameWireOrdering = (left: Uint8Array, right: Uint8Array, schema?: SchemaContext): boolean => {
	const a = scan(left, 12, schema)
	const b = scan(right, 12, schema)
	if (a === undefined || b === undefined) return Buffer.from(left).equals(Buffer.from(right))
	const spelledA = spell(a)
	const spelledB = spell(b)
	// Byte equality, not `undefined === undefined`: an unanswerable question must
	// not read as "yes, only the order moved".
	if (spelledA === undefined || spelledB === undefined) return Buffer.from(left).equals(Buffer.from(right))
	return spelledA === spelledB
}

/** The varints packed inside a length-delimited payload, or undefined if it is not one. */
const unpackVarints = (hexPayload: string): string[] | undefined => {
	const bytes = Uint8Array.from(Buffer.from(hexPayload, 'hex'))
	const cursor: Cursor = { bytes, offset: 0 }
	const values: string[] = []
	while (cursor.offset < bytes.length) {
		const value = readVarint(cursor)
		if (value === undefined) return undefined
		values.push(value.toString())
	}
	return values
}

/**
 * True when the only difference is packed vs unpacked repeated scalars.
 *
 * proto3 defaults repeated scalars to the packed encoding and every decoder must
 * accept both forms, so this is a legal difference rather than data loss — but it
 * is one worth naming precisely instead of excusing "the bytes differ". A field
 * qualifies only when the length-delimited side unpacks to exactly the multiset
 * of varints the other side wrote out one by one.
 */
/**
 * Where in the schema the bytes being compared sit.
 *
 * Needed because a one-element packed run and a singular scalar written with the
 * wrong wire type are byte-identical: `0a 01 01` is both "field 1, packed [1]"
 * and "field 1, varint 1, mis-encoded as length-delimited". Treating every such
 * pair as packing lets a wrong-wire-type regression be excused by the allowlisted
 * packing entry; treating none of them as packing reports ordinary one-element
 * repeated fields as codec bugs. Only the schema can separate the two.
 *
 * And it has to be the schema *at this point in the message*: protobuf field
 * numbers are unique per message, not globally. This schema has 30 repeated
 * scalar fields against 1734 singular ones, all drawing from the same small
 * numbers, so a global "is this number ever repeated" set answers yes for
 * essentially every singular field and closes nothing.
 */
export interface SchemaContext {
	/** The message type being compared, as a schema path. */
	readonly path: string
	/** True when this number is a repeated, packable field *of that message*. */
	readonly isRepeated: (path: string, field: number) => boolean
	/**
	 * The message type a length-delimited field at this number carries.
	 *
	 * Returning undefined drops the context for that subtree, and a single-value
	 * run there is then reported rather than excused — the safe direction.
	 */
	readonly messageAt: (path: string, field: number) => string | undefined
}

export const differsOnlyByPacking = (left: Uint8Array, right: Uint8Array, schema?: SchemaContext): boolean => {
	const a = scan(left, 12, schema)
	const b = scan(right, 12, schema)
	if (!a || !b) return false
	return nestedDiffersOnlyByPacking(a, b, schema)
}

/** The context for a nested message, or undefined when the schema cannot place it. */
const descend = (schema: SchemaContext | undefined, field: number): SchemaContext | undefined => {
	if (!schema) return undefined
	const path = schema.messageAt(schema.path, field)
	return path === undefined ? undefined : { ...schema, path }
}

const packableHere = (schema: SchemaContext | undefined, field: number): boolean =>
	schema !== undefined && schema.isRepeated(schema.path, field)

/**
 * One field number's entries in occurrence order.
 *
 * Order, not a sorted key. A repeated field's occurrence order is part of its
 * value: `08 01 08 02` decodes to `[1, 2]` and `08 02 08 01` to `[2, 1]`.
 * Sorting made those two spellings compare equal, so a reordering codec bug
 * took the "identical, skip" branch and the comparison returned true — the
 * proto targets then reported clean — without either side being a packed run.
 */
const spelling = (entries: readonly WireField[]): string =>
	entries.map(entry => `${entry.wireType}:${entry.value}`).join(',')

const nestedDiffersOnlyByPacking = (
	a: readonly WireField[],
	b: readonly WireField[],
	schema?: SchemaContext
): boolean => {
	const group = (fields: readonly WireField[]) => {
		const byField = new Map<number, WireField[]>()
		for (const entry of fields) byField.set(entry.field, [...(byField.get(entry.field) ?? []), entry])
		return byField
	}

	const left_ = group(a)
	const right_ = group(b)
	if (left_.size !== right_.size) return false

	for (const [field, leftEntries] of left_) {
		const rightEntries = right_.get(field)
		if (!rightEntries) return false

		if (spelling(leftEntries) === spelling(rightEntries)) continue

		// A packing difference inside a nested message is still a packing difference:
		// without this, `47:2:{1:0:0}` versus `47:2:{1:2:00}` falls through as a
		// generic encoder mismatch and gets reported as data loss.
		if (
			leftEntries.length === 1 &&
			rightEntries.length === 1 &&
			leftEntries[0]!.wireType === 2 &&
			rightEntries[0]!.wireType === 2
		) {
			const leftNested = leftEntries[0]!.nested ?? parseNested(leftEntries[0]!.value)
			const rightNested = rightEntries[0]!.nested ?? parseNested(rightEntries[0]!.value)
			if (leftNested && rightNested && nestedDiffersOnlyByPacking(leftNested, rightNested, descend(schema, field)))
				continue
		}

		// One side must be a single packed run, the other a series of varints.
		const packedSide = leftEntries.length === 1 && leftEntries[0]!.wireType === 2 ? leftEntries : rightEntries
		const looseSide = packedSide === leftEntries ? rightEntries : leftEntries
		if (packedSide.length !== 1 || packedSide[0]!.wireType !== 2) return false
		if (!looseSide.every(entry => entry.wireType === 0)) return false
		// Only a field the schema declares repeated *in this message* can be packed.
		// The rule used to apply to a single loose value only, on the reasoning that
		// two or more varints cannot be a mis-encoded singular scalar and so must be
		// repeated. That is backwards: when the schema says the field is singular,
		// two occurrences of it *are* the defect — a duplicate field, or a wrong
		// wire type — and calling them packing routed exactly that regression into
		// the target-wide packing exception. Measured on a packed `[1, 2]` against
		// two varints of a field declared singular: true before, false now.
		//
		// With no schema the pair is ambiguous either way, so it is reported rather
		// than excused, which is the same direction the single-value rule took.
		if (!packableHere(schema, field)) return false

		const unpacked = unpackVarints(packedSide[0]!.raw ?? packedSide[0]!.value)
		if (!unpacked) return false
		if (unpacked.join(',') !== looseSide.map(entry => entry.value).join(',')) return false
	}

	return true
}

/**
 * True when `left` carries a subset of `right`'s fields, with equal values.
 *
 * Separates "the bridge dropped a field" from "the bridge wrote a different
 * value". The first is data loss with a single cause worth naming once; the
 * second is a codec bug that must never be excused by the same entry. Nested
 * messages recurse, so a sub-field dropped three levels down still reads as an
 * omission rather than a mismatch.
 */
export const isWireSubset = (left: Uint8Array, right: Uint8Array, schema?: SchemaContext): boolean => {
	const a = scan(left, 12, schema)
	const b = scan(right, 12, schema)
	if (!a || !b) return false
	return subsetOf(a, b, schema) && render(a) !== render(b)
}

/**
 * Drops the fields the two sides spell differently only by packing.
 *
 * A packed repeated scalar is one length-delimited field holding N varints; the
 * unpacked spelling is N separate varint fields with the same number. Matching
 * them pairwise can only ever handle N = 1, so a perfectly ordinary two-element
 * repeated field fell through — and a message with a packing difference in one
 * field and a real omission in another was then classified as neither, and got
 * reported as a value mismatch it was not.
 *
 * Both whole groups are consumed at once, which is the only way N > 1 works.
 */
const stripPackingDifferences = (
	left: readonly WireField[],
	right: readonly WireField[],
	schema?: SchemaContext
): { left: WireField[]; right: WireField[] } => {
	const a = [...left]
	const b = [...right]

	for (const field of new Set(a.map(entry => entry.field))) {
		const mine = a.filter(entry => entry.field === field)
		const theirs = b.filter(entry => entry.field === field)
		if (theirs.length === 0) continue

		// Exactly one side packed, the other a run of varints.
		const packedSide =
			mine.length === 1 && mine[0]!.wireType === 2
				? mine
				: theirs.length === 1 && theirs[0]!.wireType === 2
					? theirs
					: undefined
		if (!packedSide) continue
		const looseSide = packedSide === mine ? theirs : mine
		// Same rule as in `nestedDiffersOnlyByPacking`, and for the same reason: a
		// field the schema does not declare repeated here cannot be packed, whether
		// the loose side holds one value or five.
		if (looseSide.length === 0 || !looseSide.every(entry => entry.wireType === 0)) continue
		if (!packableHere(schema, field)) continue

		const unpacked = unpackVarints(packedSide[0]!.raw ?? packedSide[0]!.value)
		if (!unpacked || unpacked.length !== looseSide.length) continue
		if (unpacked.some((value, index) => value !== looseSide[index]!.value)) continue

		for (const entry of [...mine, ...theirs]) {
			const fromA = a.indexOf(entry)
			if (fromA >= 0) a.splice(fromA, 1)
			const fromB = b.indexOf(entry)
			if (fromB >= 0) b.splice(fromB, 1)
		}
	}

	return { left: a, right: b }
}

/** Groups fields by number, keeping each number's entries in occurrence order. */
const byFieldNumber = (fields: readonly WireField[]): Map<number, WireField[]> => {
	const grouped = new Map<number, WireField[]>()
	for (const entry of fields) {
		const bucket = grouped.get(entry.field)
		if (bucket) bucket.push(entry)
		else grouped.set(entry.field, [entry])
	}
	return grouped
}

/** True when `entry` is carried unchanged by `candidate`, allowing a nested subset. */
const carriedBy = (entry: WireField, candidate: WireField, schema: SchemaContext | undefined): boolean => {
	if (candidate.wireType === entry.wireType && candidate.value === entry.value) return true
	// Not identical: accept only when the other side is a nested message that
	// contains everything this one does.
	if (candidate.wireType !== 2 || entry.wireType !== 2) return false
	const inner = entry.nested ?? parseNested(entry.value)
	const outer = candidate.nested ?? parseNested(candidate.value)
	if (inner === undefined || outer === undefined) return false
	// A nested message that differs only by how its repeated scalars are packed
	// has lost nothing, so it must not block the omission reading of the message
	// around it.
	const child = descend(schema, entry.field)
	return subsetOf(inner, outer, child) || nestedDiffersOnlyByPacking(inner, outer, child)
}

const subsetOf = (source: readonly WireField[], target: readonly WireField[], schema?: SchemaContext): boolean => {
	// Packing is not data loss, so a field that differs only that way must not
	// stop a message from reading as an omission.
	const stripped = stripPackingDifferences(source, target, schema)
	const left = byFieldNumber(stripped.left)
	const right = byFieldNumber(stripped.right)

	// Per field number, and in order: each side's occurrences have to line up as a
	// subsequence. Searching the whole remaining set instead — which is what a
	// flat `findIndex` over every field did — made `08 01 08 02` a subset of
	// `08 02 08 01` *in both directions*, so a re-ordering encoder regression was
	// classified `proto:field-omission` and excused by that target-wide entry,
	// even though neither side omits anything and they decode to [1, 2] and [2, 1].
	for (const [field, mine] of left) {
		const theirs = right.get(field) ?? []
		let cursor = 0
		for (const entry of mine) {
			// The earliest still-unclaimed occurrence at or after the cursor. Scanning
			// forward only is what preserves order; consuming the match is what stops
			// one occurrence upstream from covering two here.
			let matched = -1
			for (let index = cursor; index < theirs.length; index++) {
				if (carriedBy(entry, theirs[index]!, schema)) {
					matched = index
					break
				}
			}
			if (matched < 0) return false
			cursor = matched + 1
		}
	}
	return true
}

/** Re-reads the rendering produced for a nested message, or undefined for opaque bytes. */
const parseNested = (value: string): WireField[] | undefined => {
	if (value === '') return []
	if (!value.startsWith('{') || !value.endsWith('}')) return undefined
	const inner = value.slice(1, -1)
	if (inner === '') return []
	const fields: WireField[] = []
	let depth = 0
	let start = 0
	const parts: string[] = []
	for (let index = 0; index < inner.length; index++) {
		const character = inner[index]
		if (character === '{') depth++
		else if (character === '}') depth--
		else if (character === ',' && depth === 0) {
			parts.push(inner.slice(start, index))
			start = index + 1
		}
	}
	parts.push(inner.slice(start))
	for (const part of parts) {
		const first = part.indexOf(':')
		const second = part.indexOf(':', first + 1)
		if (first < 0 || second < 0) return undefined
		fields.push({
			field: Number(part.slice(0, first)),
			wireType: Number(part.slice(first + 1, second)),
			value: part.slice(second + 1)
		})
	}
	return fields
}
