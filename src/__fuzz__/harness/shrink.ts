/**
 * Structural shrinker.
 *
 * A 400-node generated message that diverges is not a bug report, it is a
 * haystack. Every fuzzer here routes its failing input through `shrink` before
 * reporting, so what lands in the console is the smallest value that still
 * reproduces — usually two or three fields.
 *
 * The strategy is the standard greedy one: propose simpler candidates, keep the
 * first that still fails, repeat until nothing simpler fails.
 */

/**
 * True when the candidate still reproduces the failure being minimised.
 *
 * Async is allowed so the same shrinker serves the socket-boundary fuzzer, whose
 * every probe is a promise.
 */
export type StillFails<T> = (candidate: T) => boolean | Promise<boolean>

export interface ShrinkOptions {
	/** Upper bound on candidate evaluations, so shrinking cannot outlive the run. */
	maxEvaluations?: number
	/** Upper bound on greedy passes over the value. */
	maxPasses?: number
	/**
	 * Whether the root value itself may be replaced (default true).
	 *
	 * Set false when the root is an argument list: dropping an element there
	 * changes the call's arity, and "we called it with fewer arguments" is a
	 * different question from the one the fuzzer asked. Children still shrink.
	 */
	shrinkRoot?: boolean
}

const isTypedBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value) && !isTypedBytes(value)

/**
 * Copies one key onto a candidate as an own data property.
 *
 * Plain assignment to `__proto__` calls the inherited setter instead: the key
 * vanishes and, if the value is an object, it becomes the candidate's prototype.
 * The generators produce own `__proto__` keys on purpose, so a shrunk candidate
 * built by assignment would not be a smaller version of the input at all.
 */
const copyKey = (target: Record<string, unknown>, key: string, value: unknown): void => {
	Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

/** Simpler variants of `value`, cheapest-to-check first. */
const candidatesFor = (value: unknown): unknown[] => {
	if (value === undefined || value === null) return []

	if (typeof value === 'boolean') return value ? [false] : []

	if (typeof value === 'number') {
		// NaN would produce candidates equal to itself (Math.trunc(NaN) is NaN), and
		// `!==` never rejects them, so the shrinker would burn its budget calling
		// each one an improvement.
		if (value === 0 || !Number.isFinite(value)) return []
		const simpler: number[] = [0]
		if (!Number.isInteger(value)) simpler.push(Math.trunc(value))
		const half = Math.trunc(value / 2)
		if (half !== value && half !== 0) simpler.push(half)
		if (value !== 1 && value > 0) simpler.push(1)
		return simpler.filter(candidate => candidate !== value)
	}

	if (typeof value === 'bigint') {
		if (value === 0n) return []
		return [0n, value / 2n, 1n].filter(candidate => candidate !== value)
	}

	if (typeof value === 'string') {
		if (value.length === 0) return []
		const simpler = ['', value.slice(0, Math.floor(value.length / 2)), value.slice(0, 1)]
		// An ASCII stand-in isolates "the shape is wrong" from "the bytes are wrong".
		if (/[^ -~]/u.test(value)) simpler.push('a'.repeat(Math.min(value.length, 4)))
		return simpler.filter(candidate => candidate !== value)
	}

	if (isTypedBytes(value)) {
		if (value.length === 0) return []
		// `Buffer` is part of the call semantics for the crypto helpers — several
		// take a Buffer and call Buffer methods on it — so a candidate that quietly
		// became a plain Uint8Array would not be a smaller version of the input.
		const keepType = (candidate: Uint8Array): Uint8Array =>
			Buffer.isBuffer(value) ? Buffer.from(candidate) : candidate
		return [
			keepType(new Uint8Array(0)),
			keepType(value.slice(0, Math.floor(value.length / 2))),
			keepType(value.slice(0, 1)),
			keepType(new Uint8Array(value.length))
		]
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return []
		const simpler: unknown[][] = [[], value.slice(0, Math.floor(value.length / 2))]
		// Dropping one element at a time finds the single culprit; bounded so a
		// 4000-element array cannot turn one shrink pass into a full test run.
		for (let index = 0; index < Math.min(value.length, 40); index++) {
			simpler.push([...value.slice(0, index), ...value.slice(index + 1)])
		}
		return simpler
	}

	if (isPlainObject(value)) {
		const keys = Object.keys(value)
		if (keys.length === 0) return []
		const simpler: Record<string, unknown>[] = []
		if (keys.length > 2) {
			const half: Record<string, unknown> = {}
			for (const key of keys.slice(0, Math.floor(keys.length / 2))) copyKey(half, key, value[key])
			simpler.push(half)
		}
		for (const dropped of keys) {
			const without: Record<string, unknown> = {}
			for (const key of keys) if (key !== dropped) copyKey(without, key, value[key])
			simpler.push(without)
		}
		return simpler
	}

	return []
}

/** Replaces the value at `path` inside `root`, structurally sharing the rest. */
const replaceAt = (root: unknown, path: readonly (string | number)[], replacement: unknown): unknown => {
	if (path.length === 0) return replacement
	const [head, ...rest] = path
	if (Array.isArray(root) && typeof head === 'number') {
		const copy = [...root]
		copy[head] = replaceAt(root[head], rest, replacement)
		return copy
	}
	if (isPlainObject(root) && typeof head === 'string') {
		return { ...root, [head]: replaceAt(root[head], rest, replacement) }
	}
	return root
}

/** Every position inside `root`, breadth-first so shallow fields shrink first. */
const positions = (root: unknown, limit: number): (string | number)[][] => {
	const found: (string | number)[][] = [[]]
	const queue: { value: unknown; path: (string | number)[] }[] = [{ value: root, path: [] }]
	while (queue.length > 0 && found.length < limit) {
		const { value, path } = queue.shift()!
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length && found.length < limit; index++) {
				const next = [...path, index]
				found.push(next)
				queue.push({ value: value[index], path: next })
			}
		} else if (isPlainObject(value)) {
			for (const key of Object.keys(value)) {
				if (found.length >= limit) break
				const next = [...path, key]
				found.push(next)
				queue.push({ value: value[key], path: next })
			}
		}
	}
	return found
}

const readAt = (root: unknown, path: readonly (string | number)[]): unknown => {
	let cursor: unknown = root
	for (const step of path) {
		if (Array.isArray(cursor) && typeof step === 'number') cursor = cursor[step]
		else if (isPlainObject(cursor) && typeof step === 'string') cursor = cursor[step]
		else return undefined
	}
	return cursor
}

/**
 * Greedily minimises `value` while `stillFails` keeps holding.
 *
 * `stillFails` must be side-effect free and must return `false` for anything
 * that fails a *different* way — otherwise shrinking walks off toward an
 * unrelated bug and reports the wrong minimal case.
 */
export const shrink = async <T>(value: T, stillFails: StillFails<T>, options: ShrinkOptions = {}): Promise<T> => {
	const maxEvaluations = options.maxEvaluations ?? 600
	const maxPasses = options.maxPasses ?? 12
	const shrinkRoot = options.shrinkRoot ?? true

	let best = value
	let evaluations = 0

	for (let pass = 0; pass < maxPasses; pass++) {
		let improved = false

		for (const path of positions(best, 200)) {
			if (path.length === 0 && !shrinkRoot) continue
			if (evaluations >= maxEvaluations) return best
			const current = readAt(best, path)
			for (const candidate of candidatesFor(current)) {
				if (evaluations >= maxEvaluations) return best
				evaluations++
				const attempt = replaceAt(best, path, candidate) as T
				let holds = false
				try {
					holds = await stillFails(attempt)
				} catch {
					// A candidate that breaks the predicate itself is not a valid
					// simplification; treat it as "does not reproduce".
					holds = false
				}
				if (holds) {
					best = attempt
					improved = true
					break
				}
			}
		}

		if (!improved) break
	}

	return best
}
