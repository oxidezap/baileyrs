/**
 * The differential oracle.
 *
 * Two decisions here define what the whole suite considers a bug:
 *
 *  1. **Throwing is part of the contract.** A helper that returns `undefined`
 *     where upstream throws breaks every caller with a `try`/`catch` around it,
 *     so "one threw, the other did not" is a divergence even when the returned
 *     value looks harmless. The *message* is not compared — wording is not a
 *     contract and pinning it would only generate noise.
 *
 *  2. **Representation differences are normalised, value differences are not.**
 *     `Buffer` vs `Uint8Array`, protobufjs `Long` vs `number` vs numeric string,
 *     and an explicit `undefined` property vs an absent one are all invisible to
 *     ordinary consumer code, and reporting them would bury the findings that
 *     matter. Everything else is compared exactly, including `NaN` and array
 *     order.
 */

export type Outcome =
	| { readonly kind: 'return'; readonly value: unknown }
	| { readonly kind: 'throw'; readonly name: string; readonly message: string }

export const runOutcome = (call: () => unknown): Outcome => {
	try {
		return { kind: 'return', value: call() }
	} catch (error) {
		const failure = error as Error
		return { kind: 'throw', name: failure?.name ?? 'Error', message: String(failure?.message ?? error) }
	}
}

const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array

/** protobufjs Long, and the bridge's plain-object equivalent. */
const isLongLike = (value: unknown): value is { low: number; high: number; unsigned?: boolean } =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { low?: unknown }).low === 'number' &&
	typeof (value as { high?: unknown }).high === 'number' &&
	Object.keys(value).every(key => key === 'low' || key === 'high' || key === 'unsigned')

const longToBigInt = (value: { low: number; high: number; unsigned?: boolean }): bigint => {
	const low = BigInt(value.low >>> 0)
	const high = BigInt(value.unsigned ? value.high >>> 0 : value.high)
	return (high << 32n) | low
}

/**
 * Collapses the representations that consumers cannot tell apart into one form.
 *
 * Integers arriving as `number`, `bigint`, `Long` or a decimal `string` all
 * normalise to `bigint` when they are integral — that is the only way a
 * Rust-side u64 and a protobufjs Long can be compared without either side
 * winning by accident.
 */
export interface NormaliseOptions {
	/**
	 * Collapse integers written as `number`, `bigint`, `Long` or a decimal string
	 * into one form (default true).
	 *
	 * Required to compare a Rust-side u64 against a protobufjs Long, and wrong
	 * everywhere else: for a plain helper, returning the number `123` where
	 * upstream returns the string `"123"` is a real API difference that `typeof`,
	 * `===` and arithmetic all expose. The pure-helper differential therefore
	 * turns this off.
	 */
	readonly coerceScalars?: boolean
	/**
	 * Keep an own property whose value is `undefined` distinct from an absent one
	 * (default false).
	 *
	 * Collapsing the two is right for a protobuf message, where an unset field and
	 * a field set to nothing are the same thing on the wire. It is wrong for a
	 * plain helper: `Object.keys`, object spread, `Object.hasOwn` and `in` all tell
	 * them apart, and `trimUndefined` — a fuzz target here — exists precisely to
	 * turn one into the other. With the two collapsed, the oracle could not observe
	 * that helper doing its job, nor one implementation deleting a key where the
	 * other left it present.
	 */
	readonly preservePresence?: boolean
}

/**
 * Summarises a subtree that sits below the recursion limit.
 *
 * Returning one constant marker here would make every deep value equal to every
 * other deep value — and the pure differential deliberately generates wrapper
 * chains up to 400 levels precisely to compare where each implementation stops
 * unwrapping. Collapsing them all together silently answered "the same" to the
 * one question those inputs were built to ask.
 *
 * So the marker carries what distinguishes them: how much further the chain
 * runs, and what is at the bottom. The walk is iterative and bounded, so a cycle
 * ends at the cap instead of overflowing the stack.
 */
const describeDeep = (value: unknown): unknown => {
	const seen = new WeakSet<object>()
	let cursor = value
	let remaining = 0
	while (typeof cursor === 'object' && cursor !== null && remaining < 4_096) {
		if (seen.has(cursor)) return { __deep__: remaining, __leaf__: '<cycle>' }
		seen.add(cursor)
		const keys = Object.keys(cursor as Record<string, unknown>)
		// Only a single-child chain has an unambiguous "next"; anything wider is
		// summarised by its shape instead of walked.
		if (keys.length !== 1)
			return { __deep__: remaining, __leaf__: `<${keys.length} keys: ${keys.toSorted().join(',')}>` }
		cursor = (cursor as Record<string, unknown>)[keys[0]!]
		remaining++
	}
	return { __deep__: remaining, __leaf__: normalise(cursor, 0, { coerceScalars: false }) }
}

/** Marks a key that exists with the value `undefined`, under `preservePresence`. */
const UNDEFINED_PRESENT = { __undefined__: true } as const

/**
 * A total, stable string ordering for already-normalised Map keys.
 *
 * `JSON.stringify` cannot be used here: normalisation turns an integer key into
 * a `bigint`, and stringify throws `TypeError: Do not know how to serialize a
 * BigInt` on it. That threw out of the comparator, out of `normalise`, and out
 * of the oracle — so a two-entry `Map` keyed by integers crashed the check
 * rather than comparing it.
 */
const sortKey = (value: unknown): string => {
	if (typeof value === 'bigint') return `n:${value.toString()}`
	if (typeof value === 'string') return `s:${value}`
	if (typeof value === 'number' || typeof value === 'boolean' || value === null) return `p:${String(value)}`
	try {
		return `j:${JSON.stringify(value, (_key, entry) => (typeof entry === 'bigint' ? `${entry}n` : entry))}`
	} catch {
		return `x:${String(value)}`
	}
}

export const normalise = (value: unknown, depth = 0, options: NormaliseOptions = {}): unknown => {
	const coerce = options.coerceScalars ?? true
	const nested = (item: unknown) => normalise(item, depth + 1, options)

	if (depth > 12) return describeDeep(value)
	if (value === null) return null
	if (typeof value === 'bigint') return coerce ? value : { __bigint__: value.toString() }
	if (typeof value === 'number') {
		if (coerce && Number.isInteger(value) && Number.isSafeInteger(value)) return BigInt(value)
		return Object.is(value, -0) ? 0 : value
	}
	if (typeof value === 'string') {
		// Only pure decimal integers; a JID or a base64 blob must stay a string.
		if (coerce && /^-?\d{1,20}$/u.test(value)) return BigInt(value)
		return value
	}
	if (isBytes(value)) return { __bytes__: Buffer.from(value).toString('base64') }
	if (Array.isArray(value)) return value.map(nested)
	if (typeof value === 'object') {
		// Date, Map and Set all have zero own enumerable keys, so without these they
		// would every one normalise to `{}` and two different values would compare
		// equal — an entire class of difference the oracle would never report.
		if (value instanceof Date) return { __date__: value.getTime() }
		if (value instanceof Map) {
			return {
				__map__: [...value.entries()]
					.map(([key, entry]) => [nested(key), nested(entry)] as const)
					.toSorted((left, right) => (sortKey(left[0]) < sortKey(right[0]) ? -1 : 1))
			}
		}
		if (value instanceof Set) return { __set__: [...value].map(nested) }
		if (isLongLike(value)) return longToBigInt(value)
		if (typeof (value as { toString?: unknown }).toString === 'function' && value.constructor?.name === 'Long') {
			return BigInt(String(value))
		}
		const out: Record<string, unknown> = {}
		for (const key of Object.keys(value as Record<string, unknown>).toSorted()) {
			const entry = (value as Record<string, unknown>)[key]
			// An explicit `undefined` property and an absent one carry the same value
			// to code that reads it, so protobuf comparisons collapse them. A helper's
			// caller can still tell them apart, so `preservePresence` keeps the key.
			if (entry === undefined && !(options.preservePresence ?? false)) continue
			Object.defineProperty(out, key, {
				value: entry === undefined ? UNDEFINED_PRESENT : nested(entry),
				enumerable: true,
				writable: true,
				configurable: true
			})
		}
		return out
	}
	return value
}

const deepSame = (left: unknown, right: unknown): boolean => {
	if (typeof left === 'number' && typeof right === 'number') {
		return Number.isNaN(left) ? Number.isNaN(right) : left === right
	}
	if (typeof left !== typeof right) return false
	if (left === null || right === null) return left === right
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
		return left.every((item, index) => deepSame(item, right[index]))
	}
	if (typeof left === 'object' && typeof right === 'object') {
		const leftKeys = Object.keys(left as object)
		const rightKeys = Object.keys(right as object)
		if (leftKeys.length !== rightKeys.length) return false
		return leftKeys.every(
			key =>
				Object.hasOwn(right as object, key) &&
				deepSame((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
		)
	}
	return Object.is(left, right)
}

/** Equal after normalisation. */
export const equivalent = (left: unknown, right: unknown, options?: NormaliseOptions): boolean =>
	deepSame(normalise(left, 0, options), normalise(right, 0, options))

export interface OutcomeComparison {
	readonly same: boolean
	readonly detail?: string
}

export const compareOutcomes = (local: Outcome, upstream: Outcome, options?: NormaliseOptions): OutcomeComparison => {
	if (local.kind !== upstream.kind) {
		return {
			same: false,
			detail:
				local.kind === 'throw'
					? `baileyrs threw (${local.name}) where baileys returned a value`
					: `baileys threw (${upstream.kind === 'throw' ? upstream.name : ''}) where baileyrs returned a value`
		}
	}
	// Both threw: the fact of throwing is the contract, the wording is not.
	//
	// One exception, and only one. Comparing error *classes* across two
	// independent implementations would report on every `TypeError` versus `Boom`
	// pair and bury everything else — the class is not a contract either. But a
	// WebAssembly trap is not an error a caller can act on: it carries a
	// `wasm://wasm/<hash>` stack with no frame pointing at the call, which is the
	// whole reason the argument-boundary suite exists. Upstream is pure JS and can
	// never produce one, so "we trapped where they threw" is always a real finding.
	if (local.kind === 'throw') {
		const trapped = local.name === 'RuntimeError' || local.name === 'CompileError'
		if (trapped && upstream.kind === 'throw' && upstream.name !== local.name) {
			return { same: false, detail: `baileyrs raised a WASM ${local.name} where baileys threw ${upstream.name}` }
		}
		return { same: true }
	}
	if (equivalent(local.value, (upstream as { value: unknown }).value, options)) return { same: true }
	return { same: false, detail: 'return values differ' }
}

/** Renders an outcome for a failure report. */
export const showOutcome = (outcome: Outcome): unknown =>
	outcome.kind === 'throw' ? `<throw ${outcome.name}: ${outcome.message.slice(0, 160)}>` : outcome.value

/**
 * True when `local` is `upstream` with some keys missing, and nothing changed.
 *
 * The decode-side twin of `isWireSubset`: it tells "the decoder dropped a field"
 * apart from "the decoder read a different value". Only the first is a single
 * defect that one allowlist entry may reasonably cover.
 */
export const omitsKeysOnly = (local: unknown, upstream: unknown): boolean => {
	const a = normalise(local)
	const b = normalise(upstream)
	if (deepSame(a, b)) return false

	const walk = (left: unknown, right: unknown): boolean => {
		if (deepSame(left, right)) return true
		if (Array.isArray(left) || Array.isArray(right)) {
			if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
			return left.every((item, index) => walk(item, right[index]))
		}
		if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
		const record = left as Record<string, unknown>
		const reference = right as Record<string, unknown>
		// `__bytes__`, `__date__`, `__map__` and `__set__` are wrappers normalise
		// invents, not schema fields. Treating one as an omittable key would let
		// `{}` versus `{ __bytes__: 'AA' }` read as a dropped field when it is a
		// changed value — exactly the conflation this function exists to prevent.
		const WRAPPERS = ['__bytes__', '__date__', '__map__', '__set__', '__bigint__']
		if (WRAPPERS.some(tag => Object.hasOwn(record, tag) || Object.hasOwn(reference, tag))) return false
		// Every key the local side has must exist upstream and match. Extra keys
		// upstream are the omission being described, at whatever depth they appear —
		// the values already differ (checked above), so subset alone is the question.
		for (const key of Object.keys(record)) {
			if (!Object.hasOwn(reference, key)) return false
			if (!walk(record[key], reference[key])) return false
		}
		return Object.keys(reference).length >= Object.keys(record).length
	}

	return walk(a, b)
}
