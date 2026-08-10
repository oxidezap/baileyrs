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

const scan = (bytes: Uint8Array, depth: number, schema?: SchemaContext): WireField[] | undefined => {
	const cursor: Cursor = { bytes, offset: 0 }
	const fields: WireField[] = []

	while (cursor.offset < bytes.length) {
		const tag = readVarint(cursor)
		if (tag === undefined) return undefined

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
				const value = readVarint(cursor)
				if (value === undefined) return undefined
				fields.push({ field, wireType, value: value.toString() })
				break
			}
			case 1: {
				if (cursor.offset + 8 > bytes.length) return undefined
				const slice = bytes.slice(cursor.offset, cursor.offset + 8)
				cursor.offset += 8
				fields.push({ field, wireType, value: Buffer.from(slice).toString('hex') })
				break
			}
			case 2: {
				const length = readVarint(cursor)
				if (length === undefined) return undefined
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
				fields.push({ field, wireType, value: nested ? `{${render(nested)}}` : raw, raw, nested })
				break
			}
			case 5: {
				if (cursor.offset + 4 > bytes.length) return undefined
				const slice = bytes.slice(cursor.offset, cursor.offset + 4)
				cursor.offset += 4
				fields.push({ field, wireType, value: Buffer.from(slice).toString('hex') })
				break
			}
			default:
				// Wire types 3 and 4 are the deprecated group encoding; nothing in these
				// protos uses them, so treat their presence as "not parseable" rather
				// than guessing.
				return undefined
		}
	}

	return fields
}

const render = (fields: readonly WireField[]): string =>
	[...fields]
		.map(entry => `${entry.field}:${entry.wireType}:${entry.value}`)
		.toSorted()
		.join(',')

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

		const leftKey = leftEntries
			.map(entry => `${entry.wireType}:${entry.value}`)
			.toSorted()
			.join(',')
		const rightKey = rightEntries
			.map(entry => `${entry.wireType}:${entry.value}`)
			.toSorted()
			.join(',')
		if (leftKey === rightKey) continue

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
		// A single value is ambiguous with a singular scalar written at the wrong
		// wire type, so it counts as packing only when the schema says this field
		// number is repeated *in this message*. Two or more is unambiguous on its own.
		if (looseSide.length < 2 && !packableHere(schema, field)) return false

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
		// Same ambiguity as in `nestedDiffersOnlyByPacking`: a single varint against
		// one length-delimited field is a wrong wire type unless the schema declares
		// this field number repeated.
		if (looseSide.length === 0 || !looseSide.every(entry => entry.wireType === 0)) continue
		if (looseSide.length < 2 && !packableHere(schema, field)) continue

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

const subsetOf = (source: readonly WireField[], target: readonly WireField[], schema?: SchemaContext): boolean => {
	// Packing is not data loss, so a field that differs only that way must not
	// stop a message from reading as an omission.
	const stripped = stripPackingDifferences(source, target, schema)
	const left = stripped.left
	const remaining = stripped.right

	for (const entry of left) {
		const exact = remaining.findIndex(
			candidate =>
				candidate.field === entry.field && candidate.wireType === entry.wireType && candidate.value === entry.value
		)
		if (exact >= 0) {
			remaining.splice(exact, 1)
			continue
		}
		// Not identical: accept only when the same field on the other side is a
		// nested message that contains everything this one does.

		const nested = remaining.findIndex(candidate => {
			if (candidate.field !== entry.field || candidate.wireType !== 2 || entry.wireType !== 2) return false
			const inner = entry.nested ?? parseNested(entry.value)
			const outer = candidate.nested ?? parseNested(candidate.value)
			if (inner === undefined || outer === undefined) return false
			// A nested message that differs only by how its repeated scalars are
			// packed has lost nothing, so it must not block the omission reading of
			// the message around it.
			const child = descend(schema, entry.field)
			return subsetOf(inner, outer, child) || nestedDiffersOnlyByPacking(inner, outer, child)
		})
		if (nested < 0) return false
		remaining.splice(nested, 1)
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
