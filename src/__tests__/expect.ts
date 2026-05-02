import assert from 'node:assert/strict'

type Ctor = new (...args: never[]) => unknown
type ThrowMatcher = string | RegExp | Error | Ctor | ((err: Error) => boolean)

interface Matchers<T> {
	toBe(expected: T): void
	toEqual(expected: unknown): void
	toBeDefined(): void
	toBeUndefined(): void
	toBeTruthy(): void
	toBeFalsy(): void
	toBeInstanceOf(ctor: Ctor): void
	toBeGreaterThan(n: number): void
	toBeGreaterThanOrEqual(n: number): void
	toBeLessThan(n: number): void
	toBeLessThanOrEqual(n: number): void
	toContain(item: unknown): void
	toHaveLength(n: number): void
	toHaveProperty(path: string): void
	toThrow(matcher?: ThrowMatcher): void
}

interface AsyncMatchers<T> {
	toBe(expected: T): Promise<void>
	toBeUndefined(): Promise<void>
	toThrow(matcher?: ThrowMatcher): Promise<void>
}

interface Expect<T> extends Matchers<T> {
	readonly not: Pick<Matchers<T>, 'toBe' | 'toThrow'>
	readonly resolves: AsyncMatchers<Awaited<T>>
	readonly rejects: AsyncMatchers<unknown>
}

function toContainImpl(actual: unknown, item: unknown): void {
	if (typeof actual === 'string') {
		assert.ok(actual.includes(String(item)), `expected string to contain ${String(item)}`)
		return
	}
	if (Array.isArray(actual)) {
		assert.ok(actual.includes(item), `expected array to contain ${String(item)}`)
		return
	}
	throw new TypeError('toContain requires a string or array')
}

function toHavePropertyImpl(actual: unknown, path: string): void {
	const parts = path.split('.')
	let cur: unknown = actual
	for (const p of parts) {
		if (cur == null || typeof cur !== 'object' || !(p in cur)) {
			assert.fail(`expected property at path "${path}"`)
		}
		cur = (cur as Record<string, unknown>)[p]
	}
}

export function expect<T>(actual: T): Expect<T> {
	const throwsFn = actual as () => unknown
	const maybePromise = actual as Promise<unknown>
	return {
		toBe: e => assert.strictEqual(actual, e),
		toEqual: e => assert.deepStrictEqual(actual, e),
		toBeDefined: () => assert.notStrictEqual(actual, undefined),
		toBeUndefined: () => assert.strictEqual(actual, undefined),
		toBeTruthy: () => assert.ok(actual),
		toBeFalsy: () => assert.ok(!actual),
		toBeInstanceOf: c => assert.ok(actual instanceof c),
		toBeGreaterThan: n => assert.ok((actual as number) > n, `expected ${String(actual)} > ${n}`),
		toBeGreaterThanOrEqual: n => assert.ok((actual as number) >= n, `expected ${String(actual)} >= ${n}`),
		toBeLessThan: n => assert.ok((actual as number) < n, `expected ${String(actual)} < ${n}`),
		toBeLessThanOrEqual: n => assert.ok((actual as number) <= n, `expected ${String(actual)} <= ${n}`),
		toContain: item => toContainImpl(actual, item),
		toHaveLength: n => assert.strictEqual((actual as { length?: number }).length, n),
		toHaveProperty: p => toHavePropertyImpl(actual, p),
		toThrow: m => assert.throws(throwsFn, m as Parameters<typeof assert.throws>[1]),
		not: {
			toBe: e => assert.notStrictEqual(actual, e),
			toThrow: m => assert.doesNotThrow(throwsFn, m as Parameters<typeof assert.doesNotThrow>[1])
		},
		resolves: {
			toBe: async e => assert.strictEqual(await maybePromise, e),
			toBeUndefined: async () => assert.strictEqual(await maybePromise, undefined),
			toThrow: async m => assert.rejects(maybePromise, m as Parameters<typeof assert.rejects>[1])
		} as AsyncMatchers<Awaited<T>>,
		rejects: {
			toBe: async () => {
				throw new Error('rejects.toBe is not supported; use rejects.toThrow')
			},
			toBeUndefined: async () => {
				throw new Error('rejects.toBeUndefined is not supported')
			},
			toThrow: async m => assert.rejects(maybePromise, m as Parameters<typeof assert.rejects>[1])
		}
	}
}
