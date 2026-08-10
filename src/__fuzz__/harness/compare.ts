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

export const runOutcomeAsync = async (call: () => unknown): Promise<Outcome> => {
	try {
		return { kind: 'return', value: await call() }
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
export const normalise = (value: unknown, depth = 0): unknown => {
	if (depth > 12) return '<depth-limit>'
	if (value === null) return null
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') {
		if (Number.isInteger(value) && Number.isSafeInteger(value)) return BigInt(value)
		return Object.is(value, -0) ? 0 : value
	}
	if (typeof value === 'string') {
		// Only pure decimal integers; a JID or a base64 blob must stay a string.
		if (/^-?\d{1,20}$/u.test(value)) return BigInt(value)
		return value
	}
	if (isBytes(value)) return { __bytes__: Buffer.from(value).toString('base64') }
	if (Array.isArray(value)) return value.map(item => normalise(item, depth + 1))
	if (typeof value === 'object') {
		if (isLongLike(value)) return longToBigInt(value)
		if (typeof (value as { toString?: unknown }).toString === 'function' && value.constructor?.name === 'Long') {
			return BigInt(String(value))
		}
		const out: Record<string, unknown> = {}
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const nested = (value as Record<string, unknown>)[key]
			// An explicit `undefined` property and an absent one are the same value
			// to every consumer that reads it; only `in` can tell them apart.
			if (nested === undefined) continue
			out[key] = normalise(nested, depth + 1)
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
export const equivalent = (left: unknown, right: unknown): boolean => deepSame(normalise(left), normalise(right))

export interface OutcomeComparison {
	readonly same: boolean
	readonly detail?: string
}

export const compareOutcomes = (local: Outcome, upstream: Outcome): OutcomeComparison => {
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
	if (local.kind === 'throw') return { same: true }
	if (equivalent(local.value, (upstream as { value: unknown }).value)) return { same: true }
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
