import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import type Long from 'long'
import { BinaryReader } from '@oxidezap/whatsapp-rust-bridge'
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
const WORD_BITS = 32
const WORD_BASE = 1n << BigInt(WORD_BITS)
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

const longFromWords = (low: number, high: number, unsigned: boolean): Long => LongRuntime.fromBits(low, high, unsigned)

/**
 * The neutral codec normally returns safe JS numbers. The compatibility
 * facade supplies this reader so the same generated decoder materializes
 * protobuf 64-bit words directly as Long values, without a second decode or
 * an intermediate string/BigInt allocation.
 */
class LongBinaryReader extends BinaryReader {
	override uint64Number(): number {
		const [low, high] = this.varint64()
		return longFromWords(low, high, true) as unknown as number
	}

	override int64Number(): number {
		const [low, high] = this.varint64()
		return longFromWords(low, high, false) as unknown as number
	}

	override sint64Number(): number {
		let [low, high] = this.varint64()
		const sign = -(low & 1)
		low = ((low >>> 1) | ((high & 1) << (WORD_BITS - 1))) ^ sign
		high = (high >>> 1) ^ sign
		return longFromWords(low, high, false) as unknown as number
	}

	override fixed64Number(): number {
		return longFromWords(this.sfixed32(), this.sfixed32(), true) as unknown as number
	}

	override sfixed64Number(): number {
		return longFromWords(this.sfixed32(), this.sfixed32(), false) as unknown as number
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
			const partial = sourceCodec?.fromPartial ? sourceCodec.fromPartial(message) : message
			return this.hydrate(schemaId, isObject(partial) ? partial : {})
		}
		constructor.encode = (message, writer) => {
			if (!sourceCodec) throw new Error(`protobuf codec unavailable for ${path}`)
			const encoded = sourceCodec.encode(this.projectForEncode(schemaId, message))
			return writer === undefined ? encoded : appendBytes(writer, encoded.finish())
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
		for (let i = 0; i < fields.length; i++) {
			const field = fields[i]!
			const value = data[field[0]]
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
			const value = data[field[0]]
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
			if (value === null || value === undefined || !hasOwn(data, field[0])) continue
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

	private hydrate(schemaId: number, value: unknown): DynamicObject {
		const object = isObject(value) ? value : {}
		const messageFields = this.messageFieldsByName[schemaId]!
		for (const key in object) {
			const field = messageFields[key]
			if (!field) continue
			const nested = object[key]
			if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (Array.isArray(nested)) for (const item of nested) if (isObject(item)) this.hydrate(field[2], item)
			} else if (field[3] & PROTO_FIELD_FLAG.map) {
				if (isObject(nested)) for (const item of Object.values(nested)) if (isObject(item)) this.hydrate(field[2], item)
			} else if (isObject(nested)) {
				this.hydrate(field[2], nested)
			}
		}
		if (hasOwn(object, 'toJSON')) delete object.toJSON
		Object.setPrototypeOf(object, this.constructorFor(schemaId).prototype)
		return object
	}

	private projectForEncode(schemaId: number, value: unknown): unknown {
		if (!isObject(value)) return value
		let output: DynamicObject | undefined
		if (typeof value[INSTANCE_SCHEMA] === 'number') output = { ...value }
		for (const field of this.messageFields[schemaId]!) {
			if (!hasOwn(value, field[0])) continue
			const nested = value[field[0]]
			if (nested === null || nested === undefined) continue
			if (!this.sourceCodecs[field[2]]) {
				throw new Error(`protobuf codec unavailable for ${PROTO_MESSAGE_SCHEMAS[field[2]]![0]}`)
			}
			let converted: unknown = nested
			if (field[3] & PROTO_FIELD_FLAG.repeated) {
				if (Array.isArray(nested)) {
					let items: unknown[] | undefined
					for (let index = 0; index < nested.length; index++) {
						const item = this.projectForEncode(field[2], nested[index])
						if (item !== nested[index]) (items ??= nested.slice())[index] = item
					}
					converted = items ?? nested
				}
			} else if (field[3] & PROTO_FIELD_FLAG.map) {
				if (isObject(nested)) {
					let entries: DynamicObject | undefined
					for (const key in nested) {
						const item = this.projectForEncode(field[2], nested[key])
						if (item !== nested[key]) (entries ??= { ...nested })[key] = item
					}
					converted = entries ?? nested
				}
			} else {
				converted = this.projectForEncode(field[2], nested)
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
