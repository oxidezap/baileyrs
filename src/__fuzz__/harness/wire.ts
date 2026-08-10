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
 * One documented imprecision: a length-delimited field is a nested message, a
 * string or a byte string, and the wire format does not distinguish them. This
 * parses one as a nested message whenever it parses cleanly end-to-end, and
 * treats it as opaque bytes otherwise. Both sides get the identical heuristic, so
 * the worst case is a missed difference between two strings that each happen to
 * be valid protobuf and are permutations of one another — never a false report.
 */

export interface WireField {
	readonly field: number
	readonly wireType: number
	/** Canonical rendering of the value: hex, or the canonical form of a nested message. */
	readonly value: string
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
		result |= BigInt(byte & 0x7f) << shift
		if ((byte & 0x80) === 0) return result
		shift += 7n
	}
	return undefined
}

const scan = (bytes: Uint8Array, depth: number): WireField[] | undefined => {
	const cursor: Cursor = { bytes, offset: 0 }
	const fields: WireField[] = []

	while (cursor.offset < bytes.length) {
		const tag = readVarint(cursor)
		if (tag === undefined) return undefined

		const field = Number(tag >> 3n)
		const wireType = Number(tag & 7n)
		if (field === 0) return undefined

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

				const nested = size > 0 && depth > 0 ? scan(slice, depth - 1) : undefined
				fields.push({
					field,
					wireType,
					value: nested ? `{${render(nested)}}` : Buffer.from(slice).toString('hex')
				})
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
export const canonicalWire = (bytes: Uint8Array): string | undefined => {
	const fields = scan(bytes, 12)
	return fields === undefined ? undefined : render(fields)
}

/** Order-sensitive rendering, for telling a pure ordering difference from a real one. */
export const orderedWire = (bytes: Uint8Array): string | undefined => {
	const fields = scan(bytes, 12)
	return fields === undefined
		? undefined
		: fields.map(entry => `${entry.field}:${entry.wireType}:${entry.value}`).join(',')
}

/** True when two payloads carry the same fields and values, whatever the order. */
export const sameWireContent = (left: Uint8Array, right: Uint8Array): boolean => {
	const a = canonicalWire(left)
	const b = canonicalWire(right)
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
export const differsOnlyByPacking = (left: Uint8Array, right: Uint8Array): boolean => {
	const a = scan(left, 12)
	const b = scan(right, 12)
	if (!a || !b) return false

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

		// One side must be a single packed run, the other a series of varints.
		const packedSide = leftEntries.length === 1 && leftEntries[0]!.wireType === 2 ? leftEntries : rightEntries
		const looseSide = packedSide === leftEntries ? rightEntries : leftEntries
		if (packedSide.length !== 1 || packedSide[0]!.wireType !== 2) return false
		if (!looseSide.every(entry => entry.wireType === 0)) return false

		const unpacked = unpackVarints(packedSide[0]!.value)
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
export const isWireSubset = (left: Uint8Array, right: Uint8Array): boolean => {
	const a = scan(left, 12)
	const b = scan(right, 12)
	if (!a || !b) return false
	return subsetOf(a, b) && render(a) !== render(b)
}

const subsetOf = (left: readonly WireField[], right: readonly WireField[]): boolean => {
	const remaining = [...right]
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
			const inner = parseNested(entry.value)
			const outer = parseNested(candidate.value)
			return inner !== undefined && outer !== undefined && subsetOf(inner, outer)
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
