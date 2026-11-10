/**
 * Schema-driven protobuf message generator.
 *
 * `src/WAProto/compatibility-schema.ts` is generated from the upstream Baileys
 * protos and lists every message, every field, its kind, and the flags that
 * decide how it is encoded. That file is already the single source of truth for
 * the declaration audits — here it is used as a *grammar*, so the codec fuzzers
 * can build arbitrary valid messages for any of the several hundred types
 * without a line of hand-written fixture.
 *
 * The knobs exist because the interesting inputs are not uniform. A generator
 * that only ever emits well-formed values never sets a `proto3Optional` field to
 * its default, never puts two members in a `oneof`, and never sends 2^63-1 —
 * which is where a Rust encoder and protobufjs are most likely to part ways.
 */

import {
	PROTO_ENUM_SCHEMAS,
	PROTO_FIELD_FLAG,
	PROTO_FIELD_KIND,
	PROTO_MESSAGE_SCHEMAS,
	type ProtoFieldSchema,
	type ProtoMessageSchema
} from '../../WAProto/compatibility-schema.ts'
import type { Random } from '../harness/random.ts'

const messageSchemas = PROTO_MESSAGE_SCHEMAS as readonly ProtoMessageSchema[]
const enumSchemas = PROTO_ENUM_SCHEMAS as readonly (readonly [string, readonly (string | number)[]])[]

const schemaIndexByPath = new Map(messageSchemas.map((entry, index) => [entry[0], index] as const))

export const PROTO_PATHS: readonly string[] = messageSchemas.map(entry => entry[0])

/** Message types worth over-sampling: they carry the traffic that actually flows. */
export const HOT_PROTO_PATHS: readonly string[] = [
	'Message',
	'WebMessageInfo',
	'MessageKey',
	'ContextInfo',
	'Message.ExtendedTextMessage',
	'Message.ImageMessage',
	'Message.VideoMessage',
	'Message.AudioMessage',
	'Message.DocumentMessage',
	'Message.ProtocolMessage',
	'Message.ReactionMessage',
	'Message.PollCreationMessage',
	'Message.PollUpdateMessage',
	'MessageContextInfo',
	'SyncActionValue',
	'HistorySync',
	'Conversation'
].filter(path => schemaIndexByPath.has(path))

export const fieldsOfPath = (path: string): readonly ProtoFieldSchema[] => {
	const index = schemaIndexByPath.get(path)
	return index === undefined ? [] : messageSchemas[index]![1]
}

const isRepeated = (field: ProtoFieldSchema) => (field[3] & PROTO_FIELD_FLAG.repeated) !== 0
const isMap = (field: ProtoFieldSchema) => (field[3] & PROTO_FIELD_FLAG.map) !== 0
export const isProto3Optional = (field: ProtoFieldSchema) => (field[3] & PROTO_FIELD_FLAG.proto3Optional) !== 0

/** Valid members of an enum, plus values outside it — decoders disagree on those. */
const enumValues = (reference: number): number[] => {
	const entries = enumSchemas[reference]?.[1] ?? []
	const values: number[] = []
	for (let index = 0; index + 1 < entries.length; index += 2) {
		const value = entries[index + 1]
		if (typeof value === 'number') values.push(value)
	}
	return values
}

export interface ProtoGenerateOptions {
	/** How deep nested messages may nest. */
	readonly maxDepth?: number
	/** Chance that any given field is populated at all. */
	readonly fieldProbability?: number
	/**
	 * Chance that a populated field carries its proto3 default (`0`, `''`,
	 * `false`, empty bytes). Presence semantics are the single most likely place
	 * for two encoders to disagree, so this is a first-class knob.
	 */
	readonly defaultBias?: number
	/** Emit values at the edges of the 32- and 64-bit ranges. */
	readonly extremeIntegers?: boolean
	/** Allow unpaired UTF-16 surrogates in string fields. */
	readonly surrogates?: boolean
	/** Populate repeated fields. */
	readonly allowRepeated?: boolean
	/** Populate more than one member of the same `oneof`. */
	readonly multiOneof?: boolean
	/** Emit enum values outside the declared set. */
	readonly outOfRangeEnums?: boolean
}

const DEFAULTS: Required<ProtoGenerateOptions> = {
	maxDepth: 3,
	fieldProbability: 0.45,
	defaultBias: 0.15,
	extremeIntegers: true,
	surrogates: false,
	allowRepeated: true,
	multiOneof: false,
	outOfRangeEnums: false
}

const SAFE_STRINGS = ['', 'a', 'hello', '0', 'áé', '👍', 'x'.repeat(64), '\n\t', '{"json":true}', 'null'] as const
const SURROGATE_STRINGS = ['\uD800', '\uDFFF', 'a\uD800b', '\uD83D', '\uDE00'] as const

const signed32 = [0, 1, -1, 127, -128, 32_767, -32_768, 2_147_483_647, -2_147_483_648] as const
const unsigned32 = [0, 1, 127, 255, 65_535, 2_147_483_647, 2_147_483_648, 4_294_967_295] as const
/**
 * The empty string is in both 64-bit pools on purpose, and in neither 32-bit one.
 *
 * protobufjs routes a 64-bit field through `Long.fromString`, which throws on
 * `''`; the bridge coerces it to 0. A 32-bit field is coerced to 0 by both, so
 * putting `''` there would generate inputs that can never diverge — and leaving
 * it out of the 64-bit pools left `proto-empty-string-for-numeric-field` with no
 * reachable reproducer at all, which would have made the registry entry look
 * stale on the first complete nightly run.
 */
const signed64 = [
	'',
	'0',
	'1',
	'-1',
	'9007199254740991',
	'9007199254740993',
	'9223372036854775807',
	'-9223372036854775808'
] as const
const unsigned64 = ['', '0', '1', '9007199254740991', '9007199254740993', '18446744073709551615'] as const

const scalarValue = (random: Random, field: ProtoFieldSchema, options: Required<ProtoGenerateOptions>): unknown => {
	const wantsDefault = random.bool(options.defaultBias)

	switch (field[1]) {
		case PROTO_FIELD_KIND.string: {
			if (wantsDefault) return ''
			if (options.surrogates && random.bool(0.3)) return random.pick(SURROGATE_STRINGS)
			return random.pick(SAFE_STRINGS)
		}
		case PROTO_FIELD_KIND.bool:
			return !wantsDefault
		case PROTO_FIELD_KIND.bytes:
			return wantsDefault ? new Uint8Array(0) : random.bytes(random.pick([1, 4, 16, 32, 100]))
		case PROTO_FIELD_KIND.float:
			return wantsDefault ? 0 : random.pick([1.5, -1.5, 0.1, 3.402_823_5e38, 1.175_494_4e-38])
		case PROTO_FIELD_KIND.enum: {
			const values = enumValues(field[2])
			if (values.length === 0) return 0
			if (options.outOfRangeEnums && random.bool(0.3)) return random.pick([9_999, -1, 2_147_483_647])
			if (wantsDefault) return values.includes(0) ? 0 : values[0]!
			return random.pick(values)
		}
		case PROTO_FIELD_KIND.signed32:
			return wantsDefault ? 0 : options.extremeIntegers ? random.pick(signed32) : random.int(0, 1_000)
		case PROTO_FIELD_KIND.unsigned32:
			return wantsDefault ? 0 : options.extremeIntegers ? random.pick(unsigned32) : random.int(0, 1_000)
		case PROTO_FIELD_KIND.signed64:
			return wantsDefault ? 0 : options.extremeIntegers ? random.pick(signed64) : random.int(0, 1_000)
		case PROTO_FIELD_KIND.unsigned64:
			return wantsDefault ? 0 : options.extremeIntegers ? random.pick(unsigned64) : random.int(0, 1_000)
		default:
			return 0
	}
}

const fieldValue = (
	random: Random,
	field: ProtoFieldSchema,
	depth: number,
	options: Required<ProtoGenerateOptions>
): unknown => {
	if (field[1] === PROTO_FIELD_KIND.message) {
		if (depth <= 0) return undefined
		const nested = messageSchemas[field[2]]
		if (!nested) return undefined
		return generateProtoObject(random, nested[0], depth - 1, options)
	}
	return scalarValue(random, field, options)
}

/**
 * Builds a plain object for `path`, the same shape a caller would hand to
 * `encodeProto` or to protobufjs.
 */
export const generateProtoObject = (
	random: Random,
	path: string,
	depth: number,
	overrides: ProtoGenerateOptions = {}
): Record<string, unknown> => {
	const options = { ...DEFAULTS, ...overrides }
	const fields = fieldsOfPath(path)
	const message: Record<string, unknown> = {}
	const usedOneofs = new Set<string>()

	for (const field of fields) {
		// Map fields are not generated, and nothing else in this suite covers them:
		// the wire fuzzer builds its messages here too, and the field-name sweep
		// skips maps as well. The compact schema records the value kind but not the
		// key type, so a faithful shape cannot be derived from it — closing this gap
		// needs key metadata in `waproto-facade.ts` first. Stated rather than
		// implied, because an unstated gap reads as coverage.
		if (isMap(field)) continue
		if (!random.bool(options.fieldProbability)) continue

		const oneof = field[4]
		if (oneof && usedOneofs.has(oneof) && !options.multiOneof) continue

		const value = fieldValue(random, field, depth, options)
		if (value === undefined) continue

		if (isRepeated(field)) {
			if (!options.allowRepeated) continue
			const count = random.pick([0, 1, 1, 2, 3])
			const items: unknown[] = []
			for (let index = 0; index < count; index++) {
				const item = fieldValue(random, field, depth, options)
				if (item !== undefined) items.push(item)
			}
			message[field[0]] = items
		} else {
			message[field[0]] = value
		}

		if (oneof) usedOneofs.add(oneof)
	}

	return message
}

/** A message type to fuzz, biased toward the ones real traffic is made of. */
export const pickProtoPath = (random: Random): string =>
	random.bool(0.5) && HOT_PROTO_PATHS.length > 0 ? random.pick(HOT_PROTO_PATHS) : random.pick(PROTO_PATHS)

export interface ProtoCase {
	readonly path: string
	readonly message: Record<string, unknown>
}

export const generateProtoCase = (random: Random, overrides: ProtoGenerateOptions = {}): ProtoCase => {
	const path = pickProtoPath(random)
	return { path, message: generateProtoObject(random, path, overrides.maxDepth ?? DEFAULTS.maxDepth, overrides) }
}

/** Every field of `path` that carries explicit presence, for the presence fuzzer. */
export const proto3OptionalFields = (path: string): readonly ProtoFieldSchema[] =>
	fieldsOfPath(path).filter(field => isProto3Optional(field) && !isMap(field) && !isRepeated(field))

/**
 * Every message type `path` can reach through its fields, transitively.
 *
 * Used to tell "the bridge dropped a field" apart from "the bridge does not
 * implement the type that field holds". Cycles are common in these protos
 * (ContextInfo quotes a Message which carries a ContextInfo), so the walk is
 * guarded by the visited set rather than by depth.
 */
export const reachableTypes = (path: string): ReadonlySet<string> => {
	const seen = new Set<string>()
	const queue = [path]
	while (queue.length > 0) {
		const current = queue.pop()!
		if (seen.has(current)) continue
		seen.add(current)
		for (const field of fieldsOfPath(current)) {
			if (field[1] !== PROTO_FIELD_KIND.message) continue
			const nested = messageSchemas[field[2]]
			if (nested && !seen.has(nested[0])) queue.push(nested[0])
		}
	}
	seen.delete(path)
	return seen
}

/** The message type a message-kind field holds, or undefined for a scalar. */
export const messagePathOfField = (field: ProtoFieldSchema): string | undefined =>
	field[1] === PROTO_FIELD_KIND.message ? messageSchemas[field[2]]?.[0] : undefined

/**
 * A predicate over a decoded object's property path: is this field declared as text?
 *
 * Needed because `normalise`'s scalar coercion folds a decimal string into a
 * bigint, which is right for a 64-bit integer (protobufjs renders it as a
 * string, the bridge as a bigint) and wrong for a declared `string` field — with
 * it, `{ text: "0" }` and `{ text: 0 }` compare equal and a decoder that turned
 * a numeric-looking string into a number would be invisible. The schema is what
 * tells the two apart, so the comparison has to carry it.
 *
 * `bytes` counts as text here for the same reason: the two sides spell it
 * differently but neither spells it as a number.
 */
export const textFieldPredicate = (rootPath: string): ((propertyPath: readonly string[]) => boolean) => {
	const fieldNamed = (path: string, name: string): ProtoFieldSchema | undefined =>
		fieldsOfPath(path).find(field => field[0] === name)

	// A name the schema does not declare answers `false`: nothing is known about
	// it, and the bridge's own spellings live there — it writes `deviceAgentId`
	// for the declared `deviceAgentID` — so answering `true` would treat one side
	// of a known rename as text and the other as a number, manufacturing a
	// difference out of the rename. Both sides being coerced the same way is what
	// keeps the rename entry able to see past it.
	return propertyPath => {
		let current: string | undefined = rootPath
		for (const [index, name] of propertyPath.entries()) {
			if (current === undefined) return false
			const field: ProtoFieldSchema | undefined = fieldNamed(current, name)
			if (!field) return false
			if (index === propertyPath.length - 1) {
				return field[1] === PROTO_FIELD_KIND.string || field[1] === PROTO_FIELD_KIND.bytes
			}
			current = messagePathOfField(field)
		}
		return false
	}
}

/** The `oneof` groups declared on `path`, for the oneof fuzzer. */
export const oneofGroups = (path: string): Map<string, ProtoFieldSchema[]> => {
	const groups = new Map<string, ProtoFieldSchema[]>()
	for (const field of fieldsOfPath(path)) {
		const oneof = field[4]
		if (!oneof) continue
		groups.set(oneof, [...(groups.get(oneof) ?? []), field])
	}
	return groups
}
