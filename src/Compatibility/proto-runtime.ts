import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import type Long from 'long'
import { BinaryReader, type Int64 } from '@oxidezap/whatsapp-rust-bridge'
import {
	PROTO_ENUM_SCHEMAS,
	PROTO_FIELD_FLAG,
	PROTO_FIELD_KIND,
	PROTO_MESSAGE_SCHEMAS,
	type ProtoFieldSchema
} from '../WAProto/compatibility-schema.ts'

type DynamicObject = Record<PropertyKey, unknown>

interface ProtoWriter {
	finish(): Uint8Array
}

interface SourceCodec extends DynamicObject {
	decode(input: unknown, length?: number): unknown
	encode(message: unknown): ProtoWriter
	fromPartial?: (message: unknown) => unknown
}

interface ProtoConstructor extends DynamicObject {
	new (properties?: DynamicObject | null): DynamicObject
	prototype: DynamicObject
	create(properties?: DynamicObject | null): DynamicObject
	decode(input: unknown, length?: number): DynamicObject
	encode(message: unknown, writer?: unknown): ProtoWriter
	fromObject(message: unknown): DynamicObject
	fromPartial(message: unknown): DynamicObject
	getTypeUrl(prefix?: string): string
	toObject(message: unknown, options?: ConversionOptions): DynamicObject
}

interface ConversionOptions {
	arrays?: boolean
	bytes?: unknown
	defaults?: boolean
	enums?: unknown
	json?: boolean
	longs?: unknown
	objects?: boolean
	oneofs?: boolean
}

interface EnumRuntime {
	firstValue: number
	namesByValue: ReadonlyMap<number, string>
	publicValue: DynamicObject
	valuesByName: ReadonlyMap<string, number>
}

interface ReaderLike {
	buf: Uint8Array
	len: number
	pos: number
}

interface AppendableWriter {
	_push?: (
		write: (value: Uint8Array, target: Uint8Array, offset: number) => void,
		length: number,
		value: Uint8Array
	) => void
	finish?: () => Uint8Array
	raw?: (value: Uint8Array) => unknown
}

const INSTANCE_SCHEMA = Symbol('proto compatibility schema')
const EMPTY_ARRAY = Object.freeze([]) as readonly unknown[]
const EMPTY_OBJECT = Object.freeze({}) as Readonly<Record<string, never>>
const JSON_OPTIONS = Object.freeze({ longs: String, enums: String, bytes: String, json: true })
const WORD_BASE = 1n << 32n
// protobufjs resolves the CommonJS Long constructor internally. Loading that
// same export keeps `instanceof` and prototype identity aligned without
// loading protobufjs itself or adding a second wire runtime.
const LongRuntime = createRequire(import.meta.url)('long') as typeof Long

const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key)

const isObject = (value: unknown): value is DynamicObject => typeof value === 'object' && value !== null

const isReaderLike = (value: unknown): value is ReaderLike =>
	isObject(value) && value.buf instanceof Uint8Array && typeof value.pos === 'number' && typeof value.len === 'number'

const asUint8Array = (value: unknown): Uint8Array => {
	if (value instanceof Uint8Array) return value
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
	return Uint8Array.from(value as ArrayLike<number>)
}

const rawWrite = (value: Uint8Array, target: Uint8Array, offset: number): void => {
	target.set(value, offset)
}

const appendBytes = (writer: unknown, bytes: Uint8Array): ProtoWriter => {
	if (!isObject(writer) && typeof writer !== 'function') {
		throw new TypeError('protobuf writer expected')
	}
	const appendable = writer as AppendableWriter
	if (typeof appendable.raw === 'function') {
		appendable.raw(bytes)
	} else if (typeof appendable._push === 'function') {
		appendable._push(rawWrite, bytes.length, bytes)
	} else {
		throw new TypeError('protobuf writer does not support raw byte appends')
	}
	if (typeof appendable.finish !== 'function') {
		throw new TypeError('protobuf writer does not expose finish()')
	}
	return appendable as ProtoWriter
}

/**
 * A UTF-16 code unit with no partner. There is no UTF-8 form for one, so the
 * codec refuses it rather than letting `TextEncoder` substitute silently.
 */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu

/**
 * Puts back what the codec used to do with an input it now refuses.
 *
 * Three cases, all measured against upstream Baileys, which still encodes them:
 *
 * - An empty string where the schema declares a 64-bit integer. Every one of the
 *   134 send-path failures this addresses carried exactly `''`; a string that is
 *   merely not a number — `'abc'`, `'1.5'` — is left to throw, because that was
 *   never accepted and silently writing a value nobody sent is the worse answer.
 * - An unpaired surrogate in a text field, replaced with U+FFFD. That is the
 *   substitution `TextEncoder` used to make, so the bytes are unchanged from what
 *   this library sent before.
 * - An enum name where the schema declares an enum (issue #109: `"NONE"` where
 *   an int32 goes on the wire). Upstream's `fromObject` resolves names to numbers
 *   and its direct `encode` coerces any string with `| 0`, so a caller passing a
 *   name never sees a throw. The bridge codec accepts only numbers (numeric
 *   strings aside) and throws `invalid int32: "NONE"`. An unknown name is left to
 *   throw rather than silenced to `0`: upstream's direct encode would write `0`
 *   for it, but that puts a value on the wire nobody sent.
 *
 * Returns `item` itself when it has nothing to do, so the caller can tell a
 * repair from a failure it does not understand.
 */
const repairScalar = (kind: number, item: unknown): unknown => {
	if (typeof item !== 'string') return item
	if (kind === PROTO_FIELD_KIND.signed64 || kind === PROTO_FIELD_KIND.unsigned64) {
		return item === '' ? 0 : item
	}
	if (kind !== PROTO_FIELD_KIND.string) return item
	const replaced = item.replace(UNPAIRED_SURROGATE, '\uFFFD')
	return replaced === item ? item : replaced
}

/**
 * Enum name to wire number, built per enum on the first repair that needs it.
 *
 * Only the repair path reads this, and only for a field that actually holds a
 * string — a message the codec accepts never reaches here, and a numeric enum
 * never touches a map. Each table is built once from the generated entries and
 * then reused; an importer that never sends a refused value allocates nothing.
 * A `Map` (not a plain object) so names like `__proto__` are keys, not hazards.
 */
let enumTablesById: Array<Map<string, number> | undefined> | undefined
const enumValueFor = (enumId: number, name: string): number | undefined => {
	if (enumId < 0 || enumId >= PROTO_ENUM_SCHEMAS.length) return undefined
	enumTablesById ??= []
	let byName = enumTablesById[enumId]
	if (byName === undefined) {
		const entries = PROTO_ENUM_SCHEMAS[enumId]?.[1]
		if (!entries) return undefined
		byName = new Map<string, number>()
		for (let index = 0; index < entries.length; index += 2) {
			const entryName = entries[index]
			const entryValue = entries[index + 1]
			if (typeof entryName === 'string' && typeof entryValue === 'number') byName.set(entryName, entryValue)
		}
		enumTablesById[enumId] = byName
	}
	return byName.get(name)
}

const longFromWords = (low: number, high: number, unsigned: boolean): Long => LongRuntime.fromBits(low, high, unsigned)

/**
 * Split a decoded 64-bit value into the low/high words `longFromWords` takes.
 * Shifts and masks are exact on BigInt at any magnitude, and `BigInt(string)`
 * parses exactly, so the `string` leg the reader's types allow costs precision
 * nothing — only the one intermediate allocation.
 */
const wordsFromInt64 = (value: bigint | string): [number, number] => {
	const v = typeof value === 'bigint' ? value : BigInt(value)
	return [Number(v & 0xffffffffn), Number((v >> 32n) & 0xffffffffn)]
}

/**
 * The neutral codec returns a JS number while a 64-bit value is exact as a
 * double and a plain `{ low, high, unsigned }` past that. The compatibility
 * facade supplies this reader so the same generated decoder materializes every
 * 64-bit word as a long.js Long instead — uniformly, whatever the magnitude —
 * through one decode. `@bufbuild/protobuf` 2.14 privatized the word-level
 * varint reader the overrides used to share, so each 64-bit varint now passes
 * through one BigInt intermediate; uniformity is what remains, and precision
 * is unchanged.
 *
 * Uniformity is the point: upstream's types declare `Long` for these fields,
 * so a consumer calling `.toNumber()` must not have that work only for values
 * under 2^53. The neutral shape is structurally a Long minus its methods, and
 * the methods are exactly what upstream code calls.
 */
class LongBinaryReader extends BinaryReader {
	override uint64Value(): Int64 {
		const [low, high] = wordsFromInt64(this.uint64())
		return longFromWords(low, high, true)
	}

	override int64Value(): Int64 {
		const [low, high] = wordsFromInt64(this.int64())
		return longFromWords(low, high, false)
	}

	override sint64Value(): Int64 {
		const [low, high] = wordsFromInt64(this.sint64())
		return longFromWords(low, high, false)
	}

	override fixed64Value(): Int64 {
		return longFromWords(this.sfixed32(), this.sfixed32(), true)
	}

	override sfixed64Value(): Int64 {
		return longFromWords(this.sfixed32(), this.sfixed32(), false)
	}
}

const longFromValue = (value: unknown, unsigned: boolean): Long =>
	LongRuntime.fromValue(value as Long | number | string, unsigned)

const longToBigInt = (value: unknown, unsigned: boolean): bigint => {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return BigInt(Math.trunc(value))
	if (typeof value === 'string') return BigInt(value)
	if (isObject(value) && typeof value.low === 'number' && typeof value.high === 'number') {
		const low = BigInt(value.low >>> 0)
		const high = BigInt(value.high >>> 0)
		const combined = high * WORD_BASE + low
		return !unsigned && value.high < 0 ? combined - WORD_BASE * WORD_BASE : combined
	}
	return BigInt(String(value))
}

const longToString = (value: unknown, unsigned: boolean): string => {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'bigint') return String(value)
	return longToBigInt(value, unsigned).toString()
}

const longToNumber = (value: unknown, unsigned: boolean): number => {
	if (typeof value === 'number') return value
	if (typeof value === 'string' || typeof value === 'bigint') return Number(value)
	return Number(longToBigInt(value, unsigned))
}

const bytesToBase64 = (value: unknown): string => {
	if (value instanceof Uint8Array) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64')
	}
	return Buffer.from(value as ArrayLike<number>).toString('base64')
}

const bytesFromObject = (value: unknown): unknown => {
	if (typeof value === 'string') return Buffer.from(value, 'base64')
	if (isObject(value) && typeof value.length === 'number') return value
	if (Array.isArray(value)) return value
	return undefined
}

const oneofName = (field: ProtoFieldSchema): string | undefined => {
	const flags = field[3]
	if (flags & PROTO_FIELD_FLAG.proto3Optional) return `_${field[0]}`
	if (flags & PROTO_FIELD_FLAG.oneof) return field[4]
	return undefined
}

const lookupPath = (root: DynamicObject, path: string): unknown => {
	let current: unknown = root
	for (const segment of path.split('.')) {
		if ((!isObject(current) && typeof current !== 'function') || !(segment in current)) return undefined
		current = (current as DynamicObject)[segment]
	}
	return current
}

const isSourceCodec = (value: unknown): value is SourceCodec =>
	(isObject(value) || typeof value === 'function') &&
	typeof (value as DynamicObject).encode === 'function' &&
	typeof (value as DynamicObject).decode === 'function'

/**
 * The namespace is installed from this tree rather than by walking string paths,
 * because walking would have to *read* each container to reach its children —
 * and reading is what the lazy properties avoid.
 */
interface SchemaNode {
	children: Map<string, SchemaNode>
	enumId?: number
	messageId?: number
	/** Memoized so every path to this node yields the same object. */
	value?: unknown
}

const buildSchemaTree = (messagePaths: readonly string[], enumPaths: readonly string[]): Map<string, SchemaNode> => {
	const roots = new Map<string, SchemaNode>()
	const nodeFor = (path: string): SchemaNode => {
		let level = roots
		let node: SchemaNode | undefined
		for (const segment of path.split('.')) {
			node = level.get(segment)
			if (!node) {
				node = { children: new Map() }
				level.set(segment, node)
			}
			level = node.children
		}
		if (!node) throw new Error(`invalid protobuf path: ${path}`)
		return node
	}
	messagePaths.forEach((path, messageId) => {
		nodeFor(path).messageId = messageId
	})
	enumPaths.forEach((path, enumId) => {
		nodeFor(path).enumId = enumId
	})
	return roots
}

/**
 * Self-replacing getter, so only the first read pays. It stays enumerable,
 * writable and configurable so the entry behaves exactly like the eagerly
 * installed value it replaced.
 *
 * The replacement targets the *receiver*, not `target`: these descriptors are
 * also copied onto the exported namespace, so writing back to `target` would
 * leave the object actually being read still holding an accessor and rebuild on
 * every access — 7.4% of process CPU when this was wrong.
 */
const defineLazyValue = (target: DynamicObject, key: string, build: () => unknown): void => {
	const settle = (receiver: unknown, value: unknown): void => {
		const owner = (isObject(receiver) || typeof receiver === 'function' ? receiver : target) as DynamicObject
		Object.defineProperty(owner, key, { configurable: true, enumerable: true, value, writable: true })
	}
	Object.defineProperty(target, key, {
		configurable: true,
		enumerable: true,
		get(this: unknown): unknown {
			const value = build()
			settle(this, value)
			return value
		},
		set(this: unknown, value: unknown): void {
			settle(this, value)
		}
	})
}

/**
 * Type path to schema index, built on first use.
 *
 * The alias projection and the repair path are the only readers. The projection
 * runs on every send, so the first message encoded builds the map; a process
 * that never encodes one never pays for the 498 entries.
 */
let schemaIdsByPath: Map<string, number> | undefined
let lastSchemaPath: string | undefined
let lastSchemaId: number | undefined

// The send path asks for the same type on every call, so the last answer is
// memoised: this lookup is on the ordinary path now, not only after a throw.
const schemaIdFor = (path: string): number | undefined => {
	if (path === lastSchemaPath) return lastSchemaId
	schemaIdsByPath ??= new Map(PROTO_MESSAGE_SCHEMAS.map(([name], index) => [name, index]))
	lastSchemaPath = path
	lastSchemaId = schemaIdsByPath.get(path)
	return lastSchemaId
}

// Bridge names stay neutral; only these schema-qualified public aliases differ.
//
// The first two are the same field number under two spellings across the two
// schemas. The last two kept both their number and their wire type and were
// renamed when the bridge regenerated against a newer WhatsApp snapshot, so the
// wire already agrees and only the public spelling needs translating.
const FIELD_ALIASES: Readonly<Record<string, readonly [string, string]>> = {
	'SyncActionValue.AgentAction': ['deviceID', 'deviceId'],
	'SyncActionValue.ChatAssignmentAction': ['deviceAgentID', 'deviceAgentId'],
	'Message.ExtendedTextMessage': ['faviconMMSMetadata', 'faviconMmsMetadata'],
	'Message.MessageHistoryMetadata': ['oldestMessageTimestamp', 'oldestMessageTimestampInWindow']
}

// Indexed by schema id, because two of the three readers are on hot paths: an
// array read replaces a string-keyed lookup, and the map above stays the single
// place the names are written down.
let aliasBySchema: Array<readonly [string, string] | undefined> | undefined
const aliasFor = (schemaId: number): readonly [string, string] | undefined =>
	(aliasBySchema ??= PROTO_MESSAGE_SCHEMAS.map(([path]) => FIELD_ALIASES[path]))[schemaId]

/**
 * Coerces the three inputs the bridge codec refuses back to what upstream
 * Baileys writes, and returns `value` itself when there was nothing to coerce.
 *
 * Reference equality is the signal: the caller only reaches here after an
 * encode threw, and an unchanged result means the failure was something else
 * — a genuinely invalid number, an unknown enum name, a missing codec — which
 * must keep propagating.
 *
 * Copy-on-write throughout, like `projectForEncode`: a branch with nothing to
 * fix is shared, not rebuilt.
 */
const repairMessage = (schemaId: number, value: unknown, ancestors?: Set<object>): unknown => {
	if (!isObject(value)) return value
	const fields = PROTO_MESSAGE_SCHEMAS[schemaId]?.[1]
	if (!fields) return value
	// A message that contains itself, not one that is merely deep. A fixed depth
	// cap was the earlier guard and it silently stopped repairing below it: 12
	// nested `ephemeralMessage.message` wrappers is 24 levels, and an empty-string
	// int64 under that many threw instead of being coerced. Recursive protobuf
	// messages have no depth limit, so only an actual cycle can be refused.
	const seen = ancestors ?? new Set<object>()
	if (seen.has(value)) return value
	seen.add(value)
	let output: DynamicObject | undefined
	const alias = aliasFor(schemaId)
	for (const field of fields) {
		// Either spelling reaches the same field number, so a value the codec refuses
		// has to be coerced whichever name it arrives under: the alias projection
		// hands the codec the bridge name, which is then the spelling this repair
		// sees. Without this the refusal surfaced as a throw for that spelling only.
		const fieldKey = hasOwn(value, field[0])
			? field[0]
			: alias !== undefined && alias[0] === field[0] && hasOwn(value, alias[1])
				? alias[1]
				: undefined
		if (fieldKey === undefined) continue
		const current = value[fieldKey]
		if (current === null || current === undefined) continue
		const repair = (item: unknown): unknown => {
			if (field[1] === PROTO_FIELD_KIND.message) return repairMessage(field[2], item, seen)
			// `?? item`, not `|| item`: 0 is a valid wire value (e.g. `"NONE"`).
			// Unknown names stay strings, so the retry still throws and the
			// original failure keeps propagating instead of becoming a silent 0.
			if (field[1] === PROTO_FIELD_KIND.enum && typeof item === 'string') return enumValueFor(field[2], item) ?? item
			return repairScalar(field[1], item)
		}
		let converted: unknown = current
		if (field[3] & PROTO_FIELD_FLAG.repeated) {
			if (Array.isArray(current)) {
				let items: unknown[] | undefined
				for (let index = 0; index < current.length; index++) {
					const item = repair(current[index])
					if (item !== current[index]) (items ??= current.slice())[index] = item
				}
				converted = items ?? current
			}
		} else if (field[3] & PROTO_FIELD_FLAG.map) {
			if (isObject(current)) {
				let entries: DynamicObject | undefined
				for (const key in current) {
					const item = repair(current[key])
					if (item !== current[key]) (entries ??= { ...current })[key] = item
				}
				converted = entries ?? current
			}
		} else {
			converted = repair(current)
		}
		if (converted !== current) (output ??= { ...value })[fieldKey] = converted
	}
	// The ancestor path, not everything ever visited: the same object reached
	// twice in different branches is legitimate and must still be repaired.
	seen.delete(value)
	return output ?? value
}

/**
 * Repairs a message for a codec addressed by type name rather than schema index.
 *
 * The send path calls the neutral `encodeProto` directly instead of going
 * through this facade's constructors, so it cannot reach the repair the way
 * `proto.Message.encode` does. Same coercion, same copy-on-write contract:
 * reference equality still means "nothing to fix", so a caller can tell a
 * repair from a failure it does not understand.
 */
export const repairProtoMessage = (path: string, message: unknown): unknown => {
	const schemaId = schemaIdFor(path)
	return schemaId === undefined ? message : repairMessage(schemaId, message)
}

/**
 * The message-typed fields of a schema, by name, built on first use.
 *
 * Indexed by the keys a message actually carries rather than by the schema's
 * field list, because unlike `repairMessage` this walk runs on the ordinary
 * send path: its cost is then proportional to the message, which is the same
 * tree the codec is about to walk.
 */
const messageFieldsByNameBySchema: Array<ReadonlyMap<string, ProtoFieldSchema> | undefined> = []
const messageFieldsOf = (schemaId: number): ReadonlyMap<string, ProtoFieldSchema> => {
	const existing = messageFieldsByNameBySchema[schemaId]
	if (existing) return existing
	const index = new Map<string, ProtoFieldSchema>()
	for (const field of PROTO_MESSAGE_SCHEMAS[schemaId]?.[1] ?? []) {
		if (field[1] === PROTO_FIELD_KIND.message) index.set(field[0], field)
	}
	messageFieldsByNameBySchema[schemaId] = index
	return index
}

/**
 * Rewrites the public spelling of every aliased field back to the name the
 * neutral codec writes, and returns `value` itself when there is nothing to
 * translate.
 *
 * The send path encodes through `encodeProto` rather than this facade's
 * constructors, and what it encodes may have come back through the facade's
 * decode — where the public spellings now appear. The codec does not know those
 * names and drops them without an error, so the translation has to happen on
 * the ordinary path: `repairProtoMessage` only runs after a throw, and a
 * dropped field never throws.
 *
 * Copy-on-write throughout, like `repairMessage`: an untouched branch is shared
 * rather than rebuilt, and the key an alias consumed is skipped afterwards so
 * the result cannot carry both spellings.
 */
const projectAliases = (schemaId: number, value: unknown): unknown => {
	if (!isObject(value)) return value
	const messageFields = messageFieldsOf(schemaId)
	const alias = aliasFor(schemaId)
	let output: DynamicObject | undefined
	if (alias && hasOwn(value, alias[0])) {
		const moved = value[alias[0]]
		// The moved value is walked too, not just renamed: a message-typed alias
		// whose own type carries an alias would otherwise keep the public spelling
		// below it. Scalar aliases have no such field, so this is one lookup.
		const field = messageFields.get(alias[0])
		;(output ??= { ...value })[alias[1]] =
			field && moved !== null && moved !== undefined ? projectAliases(field[2], moved) : moved
		delete output[alias[0]]
	}
	// Values a message does not carry cost nothing here: the loop is the message's
	// own keys, not the schema's fields.
	for (const key of Object.keys(value)) {
		if (key === alias?.[0]) continue
		const field = messageFields.get(key)
		if (!field) continue
		const current = value[key]
		if (current === null || current === undefined) continue
		let converted: unknown = current
		if (field[3] & PROTO_FIELD_FLAG.repeated) {
			if (Array.isArray(current)) {
				let items: unknown[] | undefined
				for (let index = 0; index < current.length; index++) {
					const item = projectAliases(field[2], current[index])
					if (item !== current[index]) (items ??= current.slice())[index] = item
				}
				converted = items ?? current
			}
		} else if (field[3] & PROTO_FIELD_FLAG.map) {
			if (isObject(current)) {
				let entries: DynamicObject | undefined
				for (const entry in current) {
					const item = projectAliases(field[2], current[entry])
					if (item !== current[entry]) (entries ??= { ...current })[entry] = item
				}
				converted = entries ?? current
			}
		} else {
			converted = projectAliases(field[2], current)
		}
		if (converted !== current) (output ??= { ...value })[key] = converted
	}
	return output ?? value
}

/**
 * The alias projection for a codec addressed by type name, for the send path
 * that reaches `encodeProto` directly.
 *
 * Reference equality means "nothing to translate", so an unaffected message is
 * passed through rather than copied.
 */
export const projectProtoMessage = (path: string, message: unknown): unknown => {
	const schemaId = schemaIdFor(path)
	return schemaId === undefined ? message : projectAliases(schemaId, message)
}

// Bridge names stay neutral; only these schema-qualified public aliases differ.
/**
 * The value a schema field reads out of `data`.
 *
 * When the public property is not an own one, the bridge spelling answers
 * instead — the same tolerance `encode` and `fromPartial` have, so an object the
 * bridge or an older caller spelled differently is not dropped silently.
 *
 * `hasOwn` and not a null check: an instance carries its defaults on the
 * prototype, so an absent public field reads as `0` there and the bridge key
 * would never be reached. Reading `data[field[0]]` as the last resort keeps every
 * shape a caller already passes behaving exactly as it did.
 */
const fieldValue = (
	data: DynamicObject,
	field: ProtoFieldSchema,
	alias: readonly [string, string] | undefined
): unknown =>
	!hasOwn(data, field[0]) && alias !== undefined && alias[0] === field[0] && hasOwn(data, alias[1])
		? data[alias[1]]
		: data[field[0]]

/**
 * True when either spelling of `field` is an own property of `data`.
 *
 * `toObject` reports a field only when the instance actually carries it, which
 * is what keeps an instance's prototype defaults out of the output. An instance
 * built from a bridge-spelled object carries that name instead, so the test has
 * to accept it there too.
 */
const hasOwnField = (
	data: DynamicObject,
	field: ProtoFieldSchema,
	alias: readonly [string, string] | undefined
): boolean => hasOwn(data, field[0]) || (alias !== undefined && alias[0] === field[0] && hasOwn(data, alias[1]))

// The names live in `FIELD_ALIASES` above; this is the same translation for the
// facade's own construction paths.
class ProtoCompatibilityRuntime {
	/** Sparse: filled by `constructorFor`, never by the constructor. */
	readonly constructors: Array<ProtoConstructor | undefined>
	readonly enums: EnumRuntime[]
	readonly messageFields: readonly (readonly ProtoFieldSchema[])[]
	readonly messageFieldsByName: readonly Readonly<Record<string, ProtoFieldSchema>>[]
	readonly namespace: DynamicObject
	readonly sourceCodecs: Array<SourceCodec | undefined>
	readonly unsupportedCodecs: readonly string[]

	constructor(sourceNamespace: DynamicObject) {
		this.namespace = { ...sourceNamespace }
		this.enums = PROTO_ENUM_SCHEMAS.map(([, entries]) => this.makeEnum(entries))
		this.messageFields = PROTO_MESSAGE_SCHEMAS.map(([, fields]) =>
			fields.filter(field => field[1] === PROTO_FIELD_KIND.message)
		)
		this.messageFieldsByName = this.messageFields.map(fields => {
			const indexed = Object.create(null) as Record<string, ProtoFieldSchema>
			for (const field of fields) indexed[field[0]] = field
			return indexed
		})
		this.sourceCodecs = PROTO_MESSAGE_SCHEMAS.map(([path]) => {
			const candidate = lookupPath(sourceNamespace, path)
			return isSourceCodec(candidate) ? candidate : undefined
		})
		// Building all 498 eagerly cost ~4.6 MB of RSS in every importing process
		// while a full connection touches under a dozen. `Array.from` rather than
		// `new Array(n)` keeps the array packed, so `constructorFor`'s indexed read
		// stays on the fast element kind.
		this.constructors = Array.from({ length: PROTO_MESSAGE_SCHEMAS.length })
		this.unsupportedCodecs = Object.freeze(
			PROTO_MESSAGE_SCHEMAS.flatMap(([path], schemaId) => (this.sourceCodecs[schemaId] ? [] : [path]))
		)

		const tree = buildSchemaTree(
			PROTO_MESSAGE_SCHEMAS.map(([path]) => path),
			PROTO_ENUM_SCHEMAS.map(([path]) => path)
		)
		for (const [name, node] of tree) this.installNode(this.namespace, name, node)
	}

	/**
	 * Nested types are installed only once their container is read, so using a
	 * container does not build what is nested inside it.
	 */
	private installNode(target: DynamicObject, name: string, node: SchemaNode): void {
		defineLazyValue(target, name, () => {
			// Build once: this getter is reachable from both this namespace and the
			// exported copy, and a second build would reinstall accessors over
			// entries a caller had already resolved.
			if (node.value === undefined) {
				const value: unknown =
					node.messageId !== undefined
						? this.constructorFor(node.messageId)
						: node.enumId !== undefined
							? this.enums[node.enumId]!.publicValue
							: {}
				node.value = value
				for (const [childName, child] of node.children) this.installNode(value as DynamicObject, childName, child)
			}
			return node.value
		})
	}

	private constructorFor(schemaId: number): ProtoConstructor {
		return (this.constructors[schemaId] ??= this.makeConstructor(
			schemaId,
			PROTO_MESSAGE_SCHEMAS[schemaId]![1],
			this.sourceCodecs[schemaId]
		))
	}

	private makeEnum(entries: readonly (string | number)[]): EnumRuntime {
		const publicValue: DynamicObject = {}
		const valuesByName = new Map<string, number>()
		const namesByValue = new Map<number, string>()
		for (let index = 0; index < entries.length; index += 2) {
			const name = entries[index]
			const value = entries[index + 1]
			if (typeof name !== 'string' || typeof value !== 'number') throw new Error('invalid generated protobuf enum')
			publicValue[name] = value
			valuesByName.set(name, value)
			namesByValue.set(value, name)
		}
		return { publicValue, valuesByName, namesByValue, firstValue: (entries[1] as number | undefined) ?? 0 }
	}

	private makeConstructor(
		schemaId: number,
		fields: readonly ProtoFieldSchema[],
		sourceCodec: SourceCodec | undefined
	): ProtoConstructor {
		const convertToObject = (message: DynamicObject): DynamicObject => this.toObject(schemaId, message, JSON_OPTIONS)
		const path = PROTO_MESSAGE_SCHEMAS[schemaId]![0]
		// Indexed loops: these run for every constructed instance and stay on
		// the megamorphic path at runtime, where V8 does not elide for..of
		// iterator allocations.
		const constructor = function (this: DynamicObject, properties?: DynamicObject | null): void {
			for (let i = 0; i < fields.length; i++) {
				const field = fields[i]!
				if (field[3] & PROTO_FIELD_FLAG.repeated) this[field[0]] = []
				else if (field[3] & PROTO_FIELD_FLAG.map) this[field[0]] = {}
			}
			if (properties) {
				const keys = Object.keys(properties)
				for (let i = 0; i < keys.length; i++) {
					const key = keys[i]!
					const value = properties[key]
					if (value !== null && value !== undefined) this[key] = value
				}
			}
		} as unknown as ProtoConstructor
		Object.defineProperty(constructor, 'name', { value: path.split('.').at(-1), configurable: true })
		Object.assign(constructor, sourceCodec ?? {})
		Object.defineProperty(constructor.prototype, INSTANCE_SCHEMA, { value: schemaId })

		for (const field of fields) {
			Object.defineProperty(constructor.prototype, field[0], {
				value: this.prototypeDefault(field),
				writable: true,
				enumerable: true,
				configurable: true
			})
		}
		this.defineOneofs(constructor.prototype, fields)
		Object.defineProperty(constructor.prototype, 'toJSON', {
			value(this: DynamicObject): DynamicObject {
				return convertToObject(this)
			},
			writable: true,
			enumerable: true,
			configurable: true
		})

		constructor.create = properties => new constructor(properties)
		constructor.fromObject = message => this.fromObject(schemaId, message)
		constructor.toObject = (message, options) => this.toObject(schemaId, message, options)
		constructor.getTypeUrl = (prefix = 'type.googleapis.com') => `${prefix}/proto.${path}`
		constructor.fromPartial = message => {
			// A partial is not written, so it must not inherit encode's codec
			// requirement: the bridge accepts holders of types it does not implement
			// and simply drops them. Only the alias translation is needed here.
			const projected = this.projectForEncode(schemaId, message, false)
			const partial = sourceCodec?.fromPartial ? sourceCodec.fromPartial(projected) : projected
			return this.hydrate(schemaId, isObject(partial) ? partial : {})
		}
		constructor.encode = (message, writer) => {
			if (!sourceCodec) throw new Error(`protobuf codec unavailable for ${path}`)
			const projected = this.projectForEncode(schemaId, message)
			const encoded = sourceCodec.encode(projected)
			// The bridge refuses three inputs it used to accept silently, and upstream
			// Baileys still encodes all three. Repairing on failure rather than checking
			// every field on the way in is what keeps the ordinary encode free: a
			// message the codec accepts never reaches the repair, and one that does
			// not was already going to throw.
			//
			// The retry hangs off `finish` because the bridge's writer is lazy —
			// `encode` queues the fields and `finish` is what writes them, so a
			// refused value surfaces there. Re-encoding from the repaired message is
			// safe for the same reason it would not be inside an overridden
			// `string()`: that would have to resume after a tag and a length were
			// already emitted, where this starts from a fresh writer.
			const write = encoded.finish.bind(encoded)
			const finish = (): Uint8Array => {
				try {
					return write()
				} catch (error) {
					const repaired = repairMessage(schemaId, projected)
					if (repaired === projected) throw error
					return sourceCodec.encode(repaired).finish()
				}
			}
			if (writer !== undefined) return appendBytes(writer, finish())
			// The codec's own writer is what comes back, with `finish` shadowed on
			// the instance rather than replaced by a bare `{ finish }`. The published
			// declaration types this return as the facade's structural `Writer`,
			// which mirrors the `protobufjs` 7.6.6 instance surface Baileys
			// consumers hold, so a caller chaining on it keeps typechecking. The writer is freshly made
			// by this call, so shadowing one method on it touches nothing else.
			encoded.finish = finish
			return encoded
		}
		constructor.decode = (input, length) => {
			if (!sourceCodec) throw new Error(`protobuf codec unavailable for ${path}`)
			return this.decode(schemaId, sourceCodec, input, length)
		}
		return constructor
	}

	private defineOneofs(prototype: DynamicObject, fields: readonly ProtoFieldSchema[]): void {
		const groups = new Map<string, string[]>()
		for (const field of fields) {
			const group = oneofName(field)
			if (group) (groups.get(group) ?? (groups.set(group, []), groups.get(group)!)).push(field[0])
		}
		for (const [group, names] of groups) {
			const accepted = new Set(names)
			Object.defineProperty(prototype, group, {
				get(this: DynamicObject): string | undefined {
					const keys = Object.keys(this)
					for (let index = keys.length - 1; index >= 0; index--) {
						const key = keys[index]!
						if (accepted.has(key) && this[key] !== undefined && this[key] !== null) return key
					}
					return undefined
				},
				set(this: DynamicObject, selected: unknown) {
					for (const name of names) if (name !== selected) delete this[name]
				}
			})
		}
	}

	private prototypeDefault(field: ProtoFieldSchema): unknown {
		const flags = field[3]
		if (flags & PROTO_FIELD_FLAG.repeated) return EMPTY_ARRAY
		if (flags & PROTO_FIELD_FLAG.map) return EMPTY_OBJECT
		if (oneofName(field) || field[1] === PROTO_FIELD_KIND.message || field[1] === PROTO_FIELD_KIND.bytes) return null
		switch (field[1]) {
			case PROTO_FIELD_KIND.enum:
				return this.enums[field[2]]?.firstValue ?? 0
			case PROTO_FIELD_KIND.string:
				return ''
			case PROTO_FIELD_KIND.bool:
				return false
			case PROTO_FIELD_KIND.signed64:
				return LongRuntime.ZERO
			case PROTO_FIELD_KIND.unsigned64:
				return LongRuntime.UZERO
			default:
				return 0
		}
	}

	private fromObject(schemaId: number, input: unknown): DynamicObject {
		const constructor = this.constructorFor(schemaId)
		if (input instanceof constructor) return input
		const data = input as DynamicObject
		const instance = new constructor()
		// Indexed loop: this walks the full schema per converted node on the
		// megamorphic path, where V8 does not elide for..of iterator
		// allocations (~90 iterator results per WebMessageInfo envelope).
		const fields = PROTO_MESSAGE_SCHEMAS[schemaId]![1]
		const alias = aliasFor(schemaId)
		for (let i = 0; i < fields.length; i++) {
			const field = fields[i]!
			const value = fieldValue(data, field, alias)
			if (value === null || value === undefined) continue
			if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (!Array.isArray(value))
					throw new TypeError(`.proto.${PROTO_MESSAGE_SCHEMAS[schemaId]![0]}.${field[0]}: array expected`)
				instance[field[0]] = value.map(item => this.fromObjectField(field, item))
			} else if (field[3] & PROTO_FIELD_FLAG.map) {
				if (!isObject(value))
					throw new TypeError(`.proto.${PROTO_MESSAGE_SCHEMAS[schemaId]![0]}.${field[0]}: object expected`)
				const converted: DynamicObject = {}
				for (const key of Object.keys(value)) converted[key] = this.fromObjectField(field, value[key])
				instance[field[0]] = converted
			} else {
				const converted = this.fromObjectField(field, value)
				if (converted !== undefined) instance[field[0]] = converted
			}
		}
		return instance
	}

	private fromObjectField(field: ProtoFieldSchema, value: unknown): unknown {
		switch (field[1]) {
			case PROTO_FIELD_KIND.message:
				return this.fromObject(field[2], value)
			case PROTO_FIELD_KIND.enum: {
				const enumType = this.enums[field[2]]
				if (!enumType) return undefined
				if (typeof value === 'string') return enumType.valuesByName.get(value)
				return typeof value === 'number' ? value | 0 : undefined
			}
			case PROTO_FIELD_KIND.string:
				return String(value)
			case PROTO_FIELD_KIND.bool:
				return Boolean(value)
			case PROTO_FIELD_KIND.bytes:
				return bytesFromObject(value)
			case PROTO_FIELD_KIND.float:
				return Number(value)
			case PROTO_FIELD_KIND.signed32:
				return Number(value) | 0
			case PROTO_FIELD_KIND.unsigned32:
				return Number(value) >>> 0
			case PROTO_FIELD_KIND.signed64:
				return longFromValue(value, false)
			case PROTO_FIELD_KIND.unsigned64:
				return longFromValue(value, true)
			default:
				throw new Error(`unknown generated protobuf field kind: ${field[1]}`)
		}
	}

	private toObject(schemaId: number, input: unknown, options: ConversionOptions = {}): DynamicObject {
		const data = input as DynamicObject
		const output: DynamicObject = {}
		const fields = PROTO_MESSAGE_SCHEMAS[schemaId]![1]
		const alias = aliasFor(schemaId)
		for (const field of fields) {
			if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (options.arrays || options.defaults) output[field[0]] = []
			} else if (field[3] & PROTO_FIELD_FLAG.map) {
				if (options.objects || options.defaults) output[field[0]] = {}
			} else if (options.defaults && !oneofName(field)) {
				output[field[0]] = this.toObjectDefault(field, options)
			}
		}

		for (const field of fields) {
			const value = fieldValue(data, field, alias)
			if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (
					value &&
					typeof (value as ArrayLike<unknown>).length === 'number' &&
					(value as ArrayLike<unknown>).length > 0
				) {
					output[field[0]] = Array.from(value as ArrayLike<unknown>, item => this.toObjectField(field, item, options))
				}
				continue
			}
			if (field[3] & PROTO_FIELD_FLAG.map) {
				if (isObject(value) && Object.keys(value).length > 0) {
					const converted: DynamicObject = {}
					for (const key of Object.keys(value)) converted[key] = this.toObjectField(field, value[key], options)
					output[field[0]] = converted
				}
				continue
			}
			if (value === null || value === undefined || !hasOwnField(data, field, alias)) continue
			output[field[0]] = this.toObjectField(field, value, options)
			const group = oneofName(field)
			if (group && options.oneofs) output[group] = field[0]
		}
		return output
	}

	private toObjectDefault(field: ProtoFieldSchema, options: ConversionOptions): unknown {
		switch (field[1]) {
			case PROTO_FIELD_KIND.message:
				return null
			case PROTO_FIELD_KIND.enum: {
				const value = this.enums[field[2]]?.firstValue ?? 0
				return options.enums === String ? (this.enums[field[2]]?.namesByValue.get(value) ?? value) : value
			}
			case PROTO_FIELD_KIND.string:
				return ''
			case PROTO_FIELD_KIND.bool:
				return false
			case PROTO_FIELD_KIND.bytes:
				return options.bytes === String ? '' : options.bytes === Array ? [] : Buffer.alloc(0)
			case PROTO_FIELD_KIND.signed64:
			case PROTO_FIELD_KIND.unsigned64:
				return options.longs === String
					? '0'
					: options.longs === Number
						? 0
						: longFromWords(0, 0, field[1] === PROTO_FIELD_KIND.unsigned64)
			default:
				return 0
		}
	}

	private toObjectField(field: ProtoFieldSchema, value: unknown, options: ConversionOptions): unknown {
		switch (field[1]) {
			case PROTO_FIELD_KIND.message:
				return this.toObject(field[2], value, options)
			case PROTO_FIELD_KIND.enum:
				return options.enums === String && typeof value === 'number'
					? (this.enums[field[2]]?.namesByValue.get(value) ?? value)
					: value
			case PROTO_FIELD_KIND.bytes:
				return options.bytes === String
					? bytesToBase64(value)
					: options.bytes === Array
						? Array.prototype.slice.call(value)
						: value
			case PROTO_FIELD_KIND.float:
				return options.json && !Number.isFinite(value) ? String(value) : value
			case PROTO_FIELD_KIND.signed64:
			case PROTO_FIELD_KIND.unsigned64: {
				const unsigned = field[1] === PROTO_FIELD_KIND.unsigned64
				return options.longs === String
					? longToString(value, unsigned)
					: options.longs === Number
						? longToNumber(value, unsigned)
						: value
			}
			default:
				return value
		}
	}

	private decode(schemaId: number, codec: SourceCodec, input: unknown, length?: number): DynamicObject {
		if (input instanceof LongBinaryReader) return this.hydrate(schemaId, codec.decode(input, length))
		if (isReaderLike(input)) {
			const start = input.pos
			const end = length === undefined ? input.len : start + length
			if (end > input.len) throw new RangeError('index out of range')
			const reader = new LongBinaryReader(input.buf.subarray(start, end))
			const decoded = codec.decode(reader)
			input.pos = start + reader.pos
			return this.hydrate(schemaId, decoded)
		}
		const reader = new LongBinaryReader(asUint8Array(input))
		return this.hydrate(schemaId, codec.decode(reader, length))
	}

	/**
	 * A fresh instance rather than an in-place re-parent: the codec installs its
	 * own `toJSON` on what it returns, and deleting that normalizes the object
	 * into dictionary mode, where every later read is a megamorphic lookup.
	 */
	private hydrate(schemaId: number, value: unknown): DynamicObject {
		const source = isObject(value) ? value : {}
		const instance = Object.create(this.constructorFor(schemaId).prototype) as DynamicObject
		const messageFields = this.messageFieldsByName[schemaId]!
		const alias = aliasFor(schemaId)
		for (const sourceKey in source) {
			const key = alias && sourceKey === alias[1] ? alias[0] : sourceKey
			const nested = source[sourceKey]
			const field = messageFields[key]
			if (!field) {
				instance[key] = nested
			} else if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (Array.isArray(nested)) {
					for (let index = 0; index < nested.length; index++) {
						const item = nested[index]
						if (isObject(item)) nested[index] = this.hydrate(field[2], item)
					}
				}
				instance[key] = nested
			} else if (field[3] & PROTO_FIELD_FLAG.map && isObject(nested)) {
				const entries: DynamicObject = {}
				for (const entry in nested) {
					const item = nested[entry]
					entries[entry] = isObject(item) ? this.hydrate(field[2], item) : item
				}
				instance[key] = entries
			} else {
				instance[key] = isObject(nested) ? this.hydrate(field[2], nested) : nested
			}
		}
		return instance
	}

	private projectForEncode(schemaId: number, value: unknown, requireCodecs = true): unknown {
		if (!isObject(value)) return value
		let output: DynamicObject | undefined
		if (typeof value[INSTANCE_SCHEMA] === 'number') output = { ...value }
		const alias = aliasFor(schemaId)
		// An own public field wins, including explicit null/undefined (absence).
		// A bridge-spelled field remains accepted when the public one is absent.
		if (alias && hasOwn(value, alias[0])) {
			;(output ??= { ...value })[alias[1]] = value[alias[0]]
			delete output[alias[0]]
		}
		for (const field of this.messageFields[schemaId]!) {
			if (!hasOwn(value, field[0])) continue
			const nested = value[field[0]]
			if (nested === null || nested === undefined) continue
			if (requireCodecs && !this.sourceCodecs[field[2]]) {
				throw new Error(`protobuf codec unavailable for ${PROTO_MESSAGE_SCHEMAS[field[2]]![0]}`)
			}
			let converted: unknown = nested
			if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (Array.isArray(nested)) {
					let items: unknown[] | undefined
					for (let index = 0; index < nested.length; index++) {
						const item = this.projectForEncode(field[2], nested[index], requireCodecs)
						if (item !== nested[index]) (items ??= nested.slice())[index] = item
					}
					converted = items ?? nested
				}
			} else if (field[3] & PROTO_FIELD_FLAG.map) {
				if (isObject(nested)) {
					let entries: DynamicObject | undefined
					for (const key in nested) {
						const item = this.projectForEncode(field[2], nested[key], requireCodecs)
						if (item !== nested[key]) (entries ??= { ...nested })[key] = item
					}
					converted = entries ?? nested
				}
			} else {
				converted = this.projectForEncode(field[2], nested, requireCodecs)
			}
			if (converted !== nested) (output ??= { ...value })[field[0]] = converted
		}
		return output ?? value
	}
}

export interface ProtoCompatibilityFacade {
	proto: DynamicObject
	unsupportedCodecs: readonly string[]
}

/** Build a Baileys-shaped facade while retaining the neutral bridge codec. */
export const createProtoCompatibilityFacade = (sourceNamespace: DynamicObject): ProtoCompatibilityFacade => {
	const runtime = new ProtoCompatibilityRuntime(sourceNamespace)
	return { proto: runtime.namespace, unsupportedCodecs: runtime.unsupportedCodecs }
}
