/**
 * Differential fuzzing of the protobuf codec: Rust/WASM against protobufjs.
 *
 * This is the largest behavioural surface baileyrs replaced. Every message the
 * library sends goes through `encodeProto` (`src/Socket/messages.ts:101,191,307`
 * and `src/Socket/index.ts:887,975`) instead of the protobufjs runtime upstream
 * uses, and the declaration audits cannot see inside it: a codec that silently
 * drops a field scores 100% compatible, because only the bytes differ.
 *
 * Four properties, each a separate target so a failure names the layer:
 *
 *   encode-bytes   the two encoders emit byte-identical output
 *   decode-parity  both decoders read the same bytes to the same object
 *   round-trip     encode with one, decode with the other, get the input back
 *   type-coverage  every message type upstream declares is known to the bridge
 *
 * Byte equality is checked as its own target rather than folded into the others
 * because it is the strictest claim and the one most likely to have a legitimate
 * exception (field ordering, packed repeated encoding). Keeping it separate means
 * excusing that exception never blinds the semantic checks.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeProto, encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { equivalent, normalise, omitsKeysOnly } from './harness/compare.ts'
import {
	canonicalWire,
	differsOnlyByPacking,
	isWireSubset,
	orderedWire,
	sameWireContent,
	type SchemaContext
} from './harness/wire.ts'
import { undoRenames, type Divergence } from './harness/divergence.ts'
import { fuzz } from './harness/runner.ts'
import type { Random } from './harness/random.ts'
import { PROTO_FIELD_FLAG, PROTO_FIELD_KIND } from '../WAProto/compatibility-schema.ts'
import {
	fieldsOfPath,
	generateProtoCase,
	generateProtoObject,
	oneofGroups,
	pickProtoPath,
	messagePathOfField,
	proto3OptionalFields,
	PROTO_PATHS,
	type ProtoCase
} from './generators/proto.ts'

const upstream = (await import('baileys')) as unknown as { proto: Record<string, unknown> }

interface UpstreamType {
	encode(message: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): unknown
	toObject(message: unknown, options: Record<string, unknown>): Record<string, unknown>
}

/**
 * Rejects a candidate the shrinker invented that is not a valid case at all.
 *
 * Shrinking drops object keys, so it will happily propose `{}` — and a property
 * that then throws on `path.split` reports a crash in the fuzzer instead of a
 * finding in the codec. Every check below is total over the candidate space
 * because of this guard.
 */
const isUsableCase = (value: ProtoCase): boolean =>
	typeof value?.path === 'string' &&
	value.path.length > 0 &&
	typeof value.message === 'object' &&
	value.message !== null

/**
 * protobufjs namespaces nest, so a schema path is a lookup chain.
 *
 * The intermediate segments are *functions*, not objects: `proto.Message` is the
 * generated Type constructor, and `Message.ExtendedTextMessage` hangs off it as a
 * static. A `typeof === 'object'` guard here silently skips every nested type,
 * which is most of the schema — `resolves nested message types` pins that.
 */
const upstreamType = (path: string): UpstreamType | undefined => {
	let cursor: unknown = upstream.proto
	for (const segment of path.split('.')) {
		if (cursor === null || (typeof cursor !== 'object' && typeof cursor !== 'function')) return undefined
		cursor = (cursor as Record<string, unknown>)[segment]
	}
	const candidate = cursor as unknown as UpstreamType | undefined
	return typeof cursor === 'function' && typeof candidate?.encode === 'function' ? candidate : undefined
}

/**
 * The one shape both decoders can be compared in.
 *
 * `defaults: false` matters: with defaults on, protobufjs invents `0`/`''` for
 * every unset field and the comparison stops being able to see a dropped one.
 */
const TO_OBJECT = { longs: String, enums: Number, defaults: false, arrays: false, objects: false, oneofs: false }

/** One entry in the two finite field sweeps: name and number, per declared field. */
interface FieldCase {
	readonly path: string
	readonly field: string
	readonly kind: number
	readonly repeated: boolean
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: string }

const attempt = (call: () => unknown): Outcome => {
	try {
		return { ok: true, value: call() }
	} catch (error) {
		return { ok: false, error: `${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? String(error)}` }
	}
}

const hex = (bytes: unknown): string =>
	bytes instanceof Uint8Array ? Buffer.from(bytes).toString('hex') : String(bytes)

const describeOutcome = (outcome: Outcome): unknown => (outcome.ok ? outcome.value : `<throw ${outcome.error}>`)

/**
 * The field kinds protobuf actually packs, and that unpack as varints.
 *
 * "Repeated" is not the same as "packable": a repeated string or bytes field is
 * always one length-delimited entry per element and is never packed, so a
 * wire-type change on one is a codec regression rather than a spelling
 * difference. Floats are packable but fixed-width, so they never appear as the
 * varint run this comparison looks for.
 */
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
 * type.
 *
 * `differsOnlyByPacking` cannot distinguish a one-element packed run from a
 * singular scalar written length-delimited — the bytes are identical — so it asks
 * the schema. Field numbers are unique per message, not globally, and this schema
 * has 30 repeated scalar fields against 1734 singular ones drawing from the same
 * small numbers: a global set would answer "repeated" for nearly every singular
 * field and excuse exactly the regression this exists to catch.
 *
 * The compact schema records the repeated flag and the nested type but not the
 * number, so each number is recovered the way the field-number sweep recovers it
 * — encode the field alone, read the tag back. Built per message, lazily, so a
 * run only pays for the types it actually compares.
 */
interface FieldFacts {
	readonly repeated: ReadonlySet<number>
	readonly messages: ReadonlyMap<number, string>
}

const fieldFactsByPath = new Map<string, FieldFacts>()

const factsFor = (path: string): FieldFacts => {
	const cached = fieldFactsByPath.get(path)
	if (cached) return cached

	const repeated = new Set<number>()
	const messages = new Map<number, string>()
	const type = upstreamType(path)
	if (type) {
		for (const field of fieldsOfPath(path)) {
			if ((field[3] & PROTO_FIELD_FLAG.map) !== 0) continue
			const isMessage = field[1] === PROTO_FIELD_KIND.message
			const one = isMessage ? {} : sampleFor(field[1])
			const value = (field[3] & PROTO_FIELD_FLAG.repeated) !== 0 ? [one] : one
			const encoded = attempt(() => type.encode({ [field[0]]: value }).finish())
			if (!encoded.ok) continue
			const number = firstFieldNumber(encoded.value as Uint8Array)
			if (number === undefined) continue
			if ((field[3] & PROTO_FIELD_FLAG.repeated) !== 0 && PACKABLE_KINDS.has(field[1])) repeated.add(number)
			const nested = messagePathOfField(field)
			if (nested !== undefined) messages.set(number, nested)
		}
	}

	const facts: FieldFacts = { repeated, messages }
	fieldFactsByPath.set(path, facts)
	return facts
}

const schemaAt = (path: string): SchemaContext => ({
	path,
	isRepeated: (at, field) => factsFor(at).repeated.has(field),
	messageAt: (at, field) => factsFor(at).messages.get(field)
})

/**
 * Message types upstream declares that the bridge codec has never heard of.
 *
 * Computed once by probing, not hard-coded: when the bridge gains a type this set
 * shrinks by itself, the allowlist entry that depended on it stops matching, and
 * the stale-entry check surfaces it for deletion. A hard-coded list would instead
 * keep excusing a gap that had already been closed.
 */
const BRIDGE_UNKNOWN_TYPES: ReadonlySet<string> = new Set(
	PROTO_PATHS.filter(path => {
		if (upstreamType(path) === undefined) return false
		const outcome = attempt(() => encodeProto(path, {}))
		// Only the bridge's own "I have never heard of this type" error counts. An
		// encode that fails for any other reason is a different defect, and folding
		// it in here would excuse it under the unknown-type entry.
		return !outcome.ok && /unknown proto type/iu.test(outcome.error)
	})
)

/**
 * Whether the *populated* fields of this message reach a type the bridge cannot
 * encode.
 *
 * Reachability from the schema alone is far too broad: `Message` can reach
 * `BotAvatarMetadata`, so classifying by schema would retarget every encoder or
 * decoder difference on the most important message type in the protocol to the
 * known-gap entry and excuse it. Only a message that actually carries the
 * unsupported field is explained by the unsupported field.
 */
const populatedTouchesUnknownType = (path: string, message: unknown, depth = 0): boolean => {
	if (depth > 12 || typeof message !== 'object' || message === null) return false
	if (BRIDGE_UNKNOWN_TYPES.has(path)) return true

	const fields = new Map(fieldsOfPath(path).map(field => [field[0], field] as const))
	for (const [name, value] of Object.entries(message as Record<string, unknown>)) {
		if (value === undefined || value === null) continue
		const field = fields.get(name)
		if (!field) continue
		const nestedPath = messagePathOfField(field)
		if (nestedPath === undefined) continue
		if (BRIDGE_UNKNOWN_TYPES.has(nestedPath)) return true
		const items = Array.isArray(value) ? value : [value]
		for (const item of items) {
			if (populatedTouchesUnknownType(nestedPath, item, depth + 1)) return true
		}
	}
	return false
}

/**
 * Routes a difference to the target that names its cause.
 *
 * A message whose schema reaches a type the bridge does not implement will
 * differ for that reason and no other, and reporting it as a generic encoder
 * mismatch would bury the actual defect (the missing type) under its symptom.
 */
const encodeTarget = (path: string, message: unknown, fallback: string): string =>
	populatedTouchesUnknownType(path, message) ? 'proto:unknown-type-dropped' : fallback

/**
 * As above, but for a difference where both sides produced bytes: when the
 * bridge's output is upstream's minus some fields, the defect is omission, and
 * saying so is more useful than "the bytes differ".
 */
const byteTarget = (
	path: string,
	message: unknown,
	local: Uint8Array,
	remote: Uint8Array,
	fallback: string
): string => {
	if (populatedTouchesUnknownType(path, message)) return 'proto:unknown-type-dropped'
	if (isWireSubset(local, remote, schemaAt(path))) return 'proto:field-omission'
	return fallback
}

describe('protobuf codec differential — Rust/WASM vs protobufjs', () => {
	it('resolves nested message types, not only top-level ones', () => {
		// A guard on the fuzzers themselves. Nested types are the majority of the
		// schema and all of the interesting traffic; if the lookup stops resolving
		// them, every target below keeps passing while testing half of what it says.
		const nested = PROTO_PATHS.filter(path => path.includes('.'))
		const resolved = nested.filter(path => upstreamType(path) !== undefined)
		assert.ok(nested.length > 200, `expected the schema to be mostly nested types, found ${nested.length}`)
		assert.ok(
			resolved.length > nested.length * 0.9,
			`only ${resolved.length}/${nested.length} nested types resolve — the lookup is skipping them`
		)
		assert.ok(upstreamType('Message.ExtendedTextMessage') !== undefined)
	})

	it('knows every message type upstream declares', async () => {
		await fuzz<string>({
			target: 'proto:type-coverage',
			runs: PROTO_PATHS.length,
			shrinkFailures: false,
			exhaustive: true,
			// Walk the type list rather than sampling it: coverage is a finite
			// question and there is no reason to answer it probabilistically.
			generate: (() => {
				let cursor = 0
				return () => PROTO_PATHS[cursor++ % PROTO_PATHS.length]!
			})(),
			check: path => {
				const upstreamSide = upstreamType(path)
				if (!upstreamSide) return []
				const local = attempt(() => encodeProto(path, {}))
				if (local.ok) return []
				return {
					target: 'proto:type-coverage',
					input: path,
					local: describeOutcome(local),
					upstream: '<encodes an empty message>',
					detail: 'the bridge codec does not know a message type upstream declares'
				}
			}
		})
	})

	it('names every decoded field the way upstream names it', async () => {
		// A sweep rather than a sample: this is a finite question over the schema,
		// and the answer for one field says nothing about the next.
		//
		// It matters more than it looks. The property name is the public API — a
		// caller writes `chatAssignment.deviceAgentID` because that is what the
		// upstream types declare. If the bridge calls it `deviceAgentId`, reads
		// return undefined and, worse, writes are dropped on the way out with no
		// error at all.
		// Repeated fields are wrapped in a one-element array and message-valued
		// fields carry `{}`; neither is excluded. A renamed repeated or message
		// field is exactly as breaking as a renamed scalar, and the nested type
		// having its own entry proves nothing about the *containing* field's name —
		// that was the gap. Only maps stay out: the compact schema carries no key
		// type, so a faithful map value cannot be built from it.
		const pairs: FieldCase[] = []
		for (const path of PROTO_PATHS) {
			if (!upstreamType(path)) continue
			for (const field of fieldsOfPath(path)) {
				if ((field[3] & PROTO_FIELD_FLAG.map) !== 0) continue
				pairs.push({ path, field: field[0], kind: field[1], repeated: (field[3] & PROTO_FIELD_FLAG.repeated) !== 0 })
			}
		}

		let cursor = 0
		await fuzz<FieldCase>({
			target: 'proto:field-names',
			runs: pairs.length,
			shrinkFailures: false,
			exhaustive: true,
			generate: () => pairs[cursor++ % pairs.length]!,
			check: ({ path, field, kind, repeated }) => {
				const type = upstreamType(path)
				if (!type) return []

				const one = kind === PROTO_FIELD_KIND.message ? {} : sampleFor(kind)
				const sample = repeated ? [one] : one
				const encoded = attempt(() => type.encode({ [field]: sample }).finish())
				if (!encoded.ok) return []

				const decoded = attempt(() => decodeProto(path, encoded.value as Uint8Array))
				// Upstream encoded a field its own schema declares and the bridge cannot
				// read the result. Skipping that let the sweep claim exhaustive coverage
				// of a field whose decode path it never checked.
				if (!decoded.ok) {
					return {
						target: encodeTarget(path, { [field]: sample }, 'proto:field-names'),
						input: `${path}.${field}`,
						local: describeOutcome(decoded),
						upstream: field,
						detail: 'the bridge cannot decode a field upstream encoded from its own schema'
					}
				}

				const keys = Object.keys(decoded.value as Record<string, unknown>)
				// No keys at all is the field vanishing on decode, not a rename — same
				// severity, and previously indistinguishable from a clean pass.
				if (keys.length === 0) {
					return {
						target: encodeTarget(path, { [field]: sample }, 'proto:field-names'),
						input: `${path}.${field}`,
						local: '<no keys decoded>',
						upstream: field,
						detail: 'the bridge decodes nothing at all from a field upstream encoded'
					}
				}
				if (keys.includes(field)) return []

				// The bridge round-trips the field under another name. Confirm the
				// consequence rather than just the symptom: the upstream spelling is
				// dropped on encode.
				const upstreamSpelling = attempt(() => encodeProto(path, { [field]: sample }))
				const dropped = upstreamSpelling.ok && (upstreamSpelling.value as Uint8Array).length === 0

				return {
					target: 'proto:field-names',
					input: `${path}.${field}`,
					local: keys.join(', '),
					upstream: field,
					detail: dropped
						? 'the bridge renames the field, and silently drops the upstream spelling on encode'
						: 'the bridge decodes the field under a different name'
				}
			}
		})
	})

	it('writes every field at the number upstream writes it at', async () => {
		// The sibling of the field-name sweep, and a finite question for the same
		// reason. Field *numbers* are the entire contract between two protobuf
		// implementations: a field written at the wrong number is not a rename the
		// peer can recover from, it is a different field. Nothing in the shape-level
		// audits can see it, and byte comparison alone reports it mixed in with
		// ordering and packing noise.
		const pairs: FieldCase[] = []
		for (const path of PROTO_PATHS) {
			if (!upstreamType(path)) continue
			for (const field of fieldsOfPath(path)) {
				if ((field[3] & PROTO_FIELD_FLAG.map) !== 0) continue
				pairs.push({ path, field: field[0], kind: field[1], repeated: (field[3] & PROTO_FIELD_FLAG.repeated) !== 0 })
			}
		}

		let cursor = 0
		await fuzz<FieldCase>({
			target: 'proto:field-numbers',
			runs: pairs.length,
			shrinkFailures: false,
			exhaustive: true,
			generate: () => pairs[cursor++ % pairs.length]!,
			check: ({ path, field, kind, repeated }) => {
				const type = upstreamType(path)
				if (!type) return []

				const one = kind === PROTO_FIELD_KIND.message ? {} : sampleFor(kind)
				const sample = repeated ? [one] : one
				const local = attempt(() => encodeProto(path, { [field]: sample }))
				const remote = attempt(() => type.encode({ [field]: sample }).finish())
				// One side rejecting a field the schema declares is a finding of its
				// own, not a reason to drop the case.
				if (remote.ok !== local.ok) {
					return {
						target: encodeTarget(path, { [field]: sample }, 'proto:field-numbers'),
						input: `${path}.${field}`,
						local: describeOutcome(local),
						upstream: describeOutcome(remote),
						detail: 'one encoder accepted a schema-declared field and the other rejected it'
					}
				}
				if (!local.ok || !remote.ok) return []

				const localBytes = local.value as Uint8Array
				const remoteBytes = remote.value as Uint8Array

				// Upstream encoding a field its own schema declares while the bridge
				// rejects it or writes nothing is how a missing or unsupported field
				// shows up. Skipping it let this sweep report exhaustive coverage of a
				// field it never actually checked.
				if (remoteBytes.length > 0 && localBytes.length === 0) {
					return {
						target: encodeTarget(path, { [field]: sample }, 'proto:field-numbers'),
						input: `${path}.${field}`,
						local: '<nothing encoded>',
						upstream: `field ${firstFieldNumber(remoteBytes) ?? '?'}`,
						detail: 'upstream encodes this field and the bridge writes nothing for it'
					}
				}
				if (localBytes.length === 0 || remoteBytes.length === 0) return []

				const localNumber = firstFieldNumber(localBytes)
				const remoteNumber = firstFieldNumber(remoteBytes)
				// Nonempty bytes whose first tag will not parse — a malformed varint, or
				// an illegal field number like zero — are a broken encoder, not a case to
				// skip. Skipping it meant the only sweep guaranteed to visit every field
				// reported a pass for the one field it could not read, and the randomised
				// byte differential may never draw that field in a smoke run.
				if (localNumber === undefined || remoteNumber === undefined) {
					return {
						target: 'proto:field-numbers',
						input: `${path}.${field}`,
						local:
							localNumber === undefined
								? `<unreadable first tag: ${hex(localBytes).slice(0, 32)}>`
								: `field ${localNumber}`,
						upstream:
							remoteNumber === undefined
								? `<unreadable first tag: ${hex(remoteBytes).slice(0, 32)}>`
								: `field ${remoteNumber}`,
						detail: 'an encoder produced bytes whose first tag does not parse'
					}
				}
				if (localNumber === remoteNumber) return []

				return {
					target: 'proto:field-numbers',
					input: `${path}.${field}`,
					local: `field ${localNumber}`,
					upstream: `field ${remoteNumber}`,
					detail: 'the bridge writes this field at a different number than upstream'
				}
			}
		})
	})

	it('encodes to identical bytes', async () => {
		await fuzz<ProtoCase>({
			target: 'proto:encode-bytes',
			runs: 400,
			generate: random => generateProtoCase(random),
			check: value => {
				if (!isUsableCase(value)) return []
				const { path, message } = value
				const type = upstreamType(path)
				if (!type) return []

				const local = attempt(() => encodeProto(path, message))
				const remote = attempt(() => type.encode(message).finish())

				if (local.ok !== remote.ok) {
					return {
						target: encodeTarget(path, message, 'proto:encode-bytes'),
						input: { path, message },
						local: describeOutcome(local),
						upstream: describeOutcome(remote),
						detail: 'one encoder accepted the message and the other rejected it'
					}
				}
				if (!local.ok || !remote.ok) return []

				const localBytes = local.value as Uint8Array
				const remoteBytes = remote.value as Uint8Array
				if (hex(localBytes) === hex(remoteBytes)) return []

				// Same fields, different order: valid protobuf either way, so it is its
				// own target rather than a failure of this one.
				if (sameWireContent(localBytes, remoteBytes, schemaAt(path))) {
					return {
						target: 'proto:field-order',
						input: { path, message },
						local: orderedWire(localBytes, schemaAt(path)) ?? hex(localBytes),
						upstream: orderedWire(remoteBytes, schemaAt(path)) ?? hex(remoteBytes),
						detail: 'same fields and values, emitted in a different order'
					}
				}

				// Packed vs unpacked repeated scalars: also legal either way, also its
				// own target, for the same reason.
				if (differsOnlyByPacking(localBytes, remoteBytes, schemaAt(path))) {
					return {
						target: 'proto:field-packing',
						input: { path, message },
						local: canonicalWire(localBytes, schemaAt(path)) ?? hex(localBytes),
						upstream: canonicalWire(remoteBytes, schemaAt(path)) ?? hex(remoteBytes),
						detail: 'repeated scalars encoded unpacked on one side and packed on the other'
					}
				}

				return {
					target: byteTarget(path, message, localBytes, remoteBytes, 'proto:encode-bytes'),
					input: { path, message },
					local: canonicalWire(localBytes, schemaAt(path)) ?? hex(localBytes),
					upstream: canonicalWire(remoteBytes, schemaAt(path)) ?? hex(remoteBytes),
					detail: 'encoders put different fields or values on the wire'
				}
			}
		})
	})

	it('decodes the same bytes to the same object', async () => {
		await fuzz<ProtoCase>({
			target: 'proto:decode-parity',
			runs: 400,
			generate: random => generateProtoCase(random),
			check: value => {
				if (!isUsableCase(value)) return []
				const { path, message } = value
				const type = upstreamType(path)
				if (!type) return []

				// Both decoders are shown bytes produced by *each* encoder: a decoder
				// bug can hide behind its own encoder's output.
				const sources: [string, Outcome][] = [
					['rust-encoded', attempt(() => encodeProto(path, message))],
					['js-encoded', attempt(() => type.encode(message).finish())]
				]

				const findings: Divergence[] = []
				for (const [origin, source] of sources) {
					if (!source.ok) continue
					const bytes = source.value as Uint8Array
					const local = attempt(() => decodeProto(path, bytes))
					const remote = attempt(() => type.toObject(type.decode(bytes), TO_OBJECT))

					if (local.ok !== remote.ok) {
						findings.push({
							target: 'proto:decode-parity',
							input: { path, origin, bytes: hex(bytes) },
							local: describeOutcome(local),
							upstream: describeOutcome(remote),
							detail: 'one decoder accepted the bytes and the other rejected them'
						})
						continue
					}
					if (!local.ok || !remote.ok) continue
					if (!equivalent(local.value, remote.value)) {
						findings.push({
							// Same classification as the encode side: a decoder that drops
							// a field and a decoder that reads a different value are two
							// different defects and must not share one allowlist entry.
							target: populatedTouchesUnknownType(path, message)
								? 'proto:unknown-type-dropped'
								: omitsKeysOnly(local.value, remote.value)
									? 'proto:field-omission'
									: 'proto:decode-parity',
							input: { path, origin, message, bytes: hex(bytes) },
							local: normalise(local.value),
							upstream: normalise(remote.value),
							detail: 'decoders read the same bytes differently'
						})
					}
				}
				return findings
			}
		})
	})

	it('round-trips a message through the other implementation', async () => {
		await fuzz<ProtoCase>({
			target: 'proto:round-trip',
			runs: 400,
			generate: random => generateProtoCase(random),
			check: value => {
				if (!isUsableCase(value)) return []
				const { path, message } = value
				const type = upstreamType(path)
				if (!type) return []

				const findings: Divergence[] = []

				// Both directions compare the *foreign* decode against the
				// same-implementation decode of the identical bytes. Checking only that
				// the foreign decode does not throw would miss the failure this target
				// exists for: a field written at the wrong number, or with a wire type
				// the other side still parses, produces bytes that decode cleanly into a
				// different message.
				// The known renames are undone before the shape test. A message that
				// carries both a renamed field and a dropped one is not a subset either
				// way round while the rename is still in place, so it fell through to the
				// generic target and lost the more specific, more actionable answer:
				// something was omitted.
				const classify = (localView: unknown, upstreamView: unknown): string => {
					if (populatedTouchesUnknownType(path, message)) return 'proto:unknown-type-dropped'
					const a = undoRenames(localView)
					const b = undoRenames(upstreamView)
					return omitsKeysOnly(a, b) || omitsKeysOnly(b, a) ? 'proto:field-omission' : 'proto:round-trip'
				}

				// Rust encodes → protobufjs reads it back.
				const encodedLocally = attempt(() => encodeProto(path, message))
				if (encodedLocally.ok) {
					const bytes = encodedLocally.value as Uint8Array
					const readBack = attempt(() => type.toObject(type.decode(bytes), TO_OBJECT))
					if (readBack.ok) {
						const own = attempt(() => decodeProto(path, bytes))
						if (own.ok && !equivalent(own.value, readBack.value)) {
							findings.push({
								target: classify(own.value, readBack.value),
								input: { path, message, direction: 'rust-encode → js-decode' },
								local: normalise(own.value),
								upstream: normalise(readBack.value),
								detail: 'upstream read the bridge bytes as a different message'
							})
						} else if (!own.ok) {
							// The reference decode failing is not a reason to skip: upstream
							// just read these bytes, so the bridge cannot read back what it
							// itself wrote. Skipping it here would hide a self-consistency
							// defect that the mirrored branch reports when the roles swap.
							findings.push({
								target: 'proto:round-trip',
								input: { path, message, direction: 'rust-encode → rust-decode' },
								local: describeOutcome(own),
								upstream: normalise(readBack.value),
								detail: 'the bridge cannot decode its own bytes, which upstream reads fine'
							})
						}
					} else {
						findings.push({
							target: 'proto:round-trip',
							input: { path, message, direction: 'rust-encode → js-decode' },
							local: hex(bytes),
							upstream: describeOutcome(readBack),
							detail: 'upstream cannot decode what the bridge encoded'
						})
					}
				}

				// protobufjs encodes → Rust reads it back.
				const encodedUpstream = attempt(() => type.encode(message).finish())
				if (encodedUpstream.ok) {
					const bytes = encodedUpstream.value as Uint8Array
					const readBack = attempt(() => decodeProto(path, bytes))
					if (readBack.ok) {
						const own = attempt(() => type.toObject(type.decode(bytes), TO_OBJECT))
						if (own.ok && !equivalent(readBack.value, own.value)) {
							findings.push({
								target: classify(readBack.value, own.value),
								input: { path, message, direction: 'js-encode → rust-decode' },
								local: normalise(readBack.value),
								upstream: normalise(own.value),
								detail: 'the bridge read the upstream bytes as a different message'
							})
						} else if (!own.ok) {
							// Mirrors the branch above: upstream cannot read back its own
							// bytes, which the bridge just read.
							findings.push({
								target: 'proto:round-trip',
								input: { path, message, direction: 'js-encode → js-decode' },
								local: normalise(readBack.value),
								upstream: describeOutcome(own),
								detail: 'upstream cannot decode its own bytes, which the bridge reads fine'
							})
						}
					} else {
						findings.push({
							target: 'proto:round-trip',
							input: { path, message, direction: 'js-encode → rust-decode' },
							local: describeOutcome(readBack),
							upstream: hex(bytes),
							detail: 'the bridge cannot decode what upstream encoded'
						})
					}
				}

				return findings
			}
		})
	})

	it('agrees on explicit presence for proto3 optional fields', async () => {
		// The highest-value check in this file, and a finite one — so it sweeps every
		// explicit-presence scalar in the schema rather than sampling.
		//
		// A `proto3Optional` field set to its zero value must still reach the wire:
		// that is the entire meaning of explicit presence. An encoder that treats it
		// as unset drops it silently, and nothing in the declaration audits can see
		// that happen because the signature is identical either way.
		const pairs: { path: string; field: string; kind: number }[] = []
		for (const path of PROTO_PATHS) {
			if (!upstreamType(path)) continue
			for (const field of proto3OptionalFields(path)) {
				if (field[1] === PROTO_FIELD_KIND.message) continue // no zero value to speak of
				pairs.push({ path, field: field[0], kind: field[1] })
			}
		}

		let cursor = 0
		await fuzz<{ path: string; field: string; kind: number }>({
			target: 'proto:presence',
			runs: pairs.length,
			shrinkFailures: false,
			exhaustive: true,
			generate: () => pairs[cursor++ % pairs.length]!,
			check: ({ path, field, kind }) => {
				const type = upstreamType(path)
				if (!type) return []

				const zero = defaultFor(kind)
				const remote = attempt(() => type.encode({ [field]: zero }).finish())
				const local = attempt(() => encodeProto(path, { [field]: zero }))

				// One side rejecting is a finding, not an unusable sample. These inputs
				// come from the upstream schema itself — a field it declares, set to the
				// zero value the type defines — so a rejection here is an acceptance
				// asymmetry a caller would hit, and skipping it would let the sweep
				// report full coverage of a field it never actually checked.
				if (remote.ok !== local.ok) {
					return {
						target: encodeTarget(path, { [field]: zero }, 'proto:presence'),
						input: `${path}.${field} = ${JSON.stringify(zero instanceof Uint8Array ? '<empty bytes>' : zero)}`,
						local: describeOutcome(local),
						upstream: describeOutcome(remote),
						detail: 'one encoder accepted an explicit-presence field at its zero value and the other rejected it'
					}
				}
				if (!remote.ok || !local.ok) return []

				const localBytes = local.value as Uint8Array
				const remoteBytes = remote.value as Uint8Array
				if (sameWireContent(localBytes, remoteBytes, schemaAt(path))) return []

				return {
					// Not routed through byteTarget: this sweep already knows precisely
					// what it is testing, and "an explicit-presence field was dropped" is
					// a sharper diagnosis than the generic field-omission one it would
					// otherwise be folded into.
					target: encodeTarget(path, { [field]: zero }, 'proto:presence'),
					input: `${path}.${field} = ${JSON.stringify(zero instanceof Uint8Array ? '<empty bytes>' : zero)}`,
					local: hex(localBytes) || '<nothing encoded>',
					upstream: hex(remoteBytes) || '<nothing encoded>',
					detail:
						localBytes.length === 0
							? 'an explicit-presence field set to its zero value is dropped by the bridge encoder'
							: 'an explicit-presence field set to its zero value encodes differently'
				}
			}
		})
	})

	it('agrees on which member of a oneof wins', async () => {
		const paths = PROTO_PATHS.filter(path => {
			for (const members of oneofGroups(path).values()) if (members.length > 1) return true
			return false
		})

		await fuzz<ProtoCase>({
			target: 'proto:oneof',
			runs: 300,
			generate: (random: Random) => {
				const path = paths.length > 0 ? random.pick(paths) : pickProtoPath(random)
				// multiOneof puts several members of the same oneof on the object at
				// once. Which one survives is unspecified by protobuf itself, which is
				// exactly why the two implementations can disagree.
				return { path, message: generateProtoObject(random, path, 2, { multiOneof: true, fieldProbability: 0.8 }) }
			},
			check: value => {
				if (!isUsableCase(value)) return []
				const { path, message } = value
				const type = upstreamType(path)
				if (!type) return []

				const local = attempt(() => encodeProto(path, message))
				const remote = attempt(() => type.encode(message).finish())
				// One encoder accepting what the other rejects is the sharpest form of
				// oneof disagreement, so it is reported rather than skipped — the
				// integers target already treats the asymmetry this way.
				if (local.ok !== remote.ok) {
					return {
						target: encodeTarget(path, message, 'proto:oneof'),
						input: { path, message },
						local: describeOutcome(local),
						upstream: describeOutcome(remote),
						detail: 'one encoder accepted a multi-member oneof the other rejected'
					}
				}
				if (!local.ok || !remote.ok) return []
				// Ordering is deliberately not compared here, on measurement. For a oneof
				// the order would be semantic — a decoder that resolves a winner keeps
				// the last member it meets — but protobufjs declares no runtime oneof
				// for any of the 14 paths whose schema table records a multi-member
				// group: `type.oneofs` is empty for all of them, `decode` keeps every
				// member it meets, and `toObject` shows them all. So a check comparing
				// the decoded winners could not fail, and a check that cannot fail is
				// worse than none. If the generated protos ever carry runtime oneofs,
				// this is the place to compare `decoded[oneofName]` on both sides.
				if (sameWireContent(local.value as Uint8Array, remote.value as Uint8Array, schemaAt(path))) return []
				if (differsOnlyByPacking(local.value as Uint8Array, remote.value as Uint8Array, schemaAt(path))) return []
				return {
					target: byteTarget(path, message, local.value as Uint8Array, remote.value as Uint8Array, 'proto:oneof'),
					input: { path, message },
					local: canonicalWire(local.value as Uint8Array, schemaAt(path)) ?? hex(local.value),
					upstream: canonicalWire(remote.value as Uint8Array, schemaAt(path)) ?? hex(remote.value),
					detail: 'a oneof with several members set resolves differently'
				}
			}
		})
	})

	it('agrees on 64-bit integer boundaries', async () => {
		await fuzz<ProtoCase>({
			target: 'proto:integers',
			runs: 400,
			generate: random =>
				generateProtoCase(random, { extremeIntegers: true, fieldProbability: 0.7, defaultBias: 0.05, maxDepth: 2 }),
			check: value => {
				if (!isUsableCase(value)) return []
				const { path, message } = value
				const type = upstreamType(path)
				if (!type) return []

				const local = attempt(() => encodeProto(path, message))
				const remote = attempt(() => type.encode(message).finish())
				if (local.ok !== remote.ok) {
					return {
						target: encodeTarget(path, message, 'proto:integers'),
						input: { path, message },
						local: describeOutcome(local),
						upstream: describeOutcome(remote),
						detail: 'one encoder accepted an integer the other rejected'
					}
				}
				if (!local.ok || !remote.ok) return []
				if (sameWireContent(local.value as Uint8Array, remote.value as Uint8Array, schemaAt(path))) return []
				if (differsOnlyByPacking(local.value as Uint8Array, remote.value as Uint8Array, schemaAt(path))) return []
				return {
					target: byteTarget(path, message, local.value as Uint8Array, remote.value as Uint8Array, 'proto:integers'),
					input: { path, message },
					local: canonicalWire(local.value as Uint8Array, schemaAt(path)) ?? hex(local.value),
					upstream: canonicalWire(remote.value as Uint8Array, schemaAt(path)) ?? hex(remote.value),
					detail: 'integer fields encode differently'
				}
			}
		})
	})
})

/**
 * The proto3 default for a field kind, used to force explicit-presence cases.
 *
 * Written against the schema enums rather than their current numeric values: if
 * the schema generator renumbers a kind, a literal here would silently plant a
 * sample of the wrong type, the encode would throw, and the sweep would pass
 * while checking nothing.
 */
function defaultFor(kind: number): unknown {
	switch (kind) {
		case PROTO_FIELD_KIND.string:
			return ''
		case PROTO_FIELD_KIND.bool:
			return false
		case PROTO_FIELD_KIND.bytes:
			return new Uint8Array(0)
		default:
			return 0
	}
}

/** The field number of the first tag in a payload, or undefined if it does not parse. */
function firstFieldNumber(bytes: Uint8Array): number | undefined {
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

/** A non-default sample for a field kind, for the field-name sweep. */
function sampleFor(kind: number): unknown {
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
