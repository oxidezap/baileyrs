import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { it } from 'node:test'
import { equivalent, normalise, omitsKeysOnly } from '../compare.ts'

const strict = { coerceScalars: false, preservePresence: true } as const

const chain = (depth: number, leaf: unknown, key = 'next'): unknown => {
	let value = leaf
	for (let index = 0; index < depth; index++) value = { [key]: value }
	return value
}

it('rejects cycles explicitly instead of returning equality or exhausting the stack', () => {
	// A subprocess bounds the regression even when a broken iterative walker loops.
	const probe = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`
		import assert from 'node:assert/strict'
		import { normalise, equivalent, omitsKeysOnly, compareOutcomes } from ${JSON.stringify(new URL('../compare.ts', import.meta.url).href)}
		for (const value of [{}, [], new Map(), new Set()]) {
			if (Array.isArray(value)) value.push(value)
			else if (value instanceof Map) value.set('self', value)
			else if (value instanceof Set) value.add(value)
			else value.self = value
			for (const call of [() => normalise(value), () => equivalent(value, value), () => omitsKeysOnly(value, value),
				() => compareOutcomes({ kind: 'return', value }, { kind: 'return', value })]) {
				assert.throws(call, { name: 'TypeError', message: /cycle/i })
			}
		}
	`
		],
		{ encoding: 'utf8', timeout: 3_000 }
	)
	assert.ifError(probe.error)
	assert.equal(probe.status, 0, probe.stdout + probe.stderr)
})

it('reports budget exhaustion as an error, never equality', () => {
	const value = Array.from({ length: 100_001 }, () => 0)
	assert.throws(() => normalise(value), /budget/i)
	assert.throws(() => equivalent(value, value), /budget/i)
	assert.throws(() => omitsKeysOnly(value, value), /budget/i)
})

it('counts sparse array slots and omitted fields toward the work budget', () => {
	const sparse: unknown[] = []
	sparse.length = 100_001
	const omitted = Object.fromEntries(Array.from({ length: 100_001 }, (_, index) => [`field${index}`, undefined]))
	assert.throws(() => normalise(sparse), /budget/i)
	assert.throws(() => normalise(omitted), /budget/i)
})

it('orders deeply nested Map keys independently of insertion order', () => {
	const a = chain(10_000, { value: 'a' })
	const b = chain(10_000, { value: 'b' })
	assert.equal(
		equivalent(
			new Map([
				[a, 1],
				[b, 1]
			]),
			new Map([
				[b, 1],
				[a, 1]
			])
		),
		true
	)
})

it('distinguishes generated markers from literal objects', () => {
	for (const [value, literal] of [
		[undefined, { __undefined__: true }],
		[-0, { __negative_zero__: true }],
		[123n, { __bigint__: '123' }],
		[Buffer.from([0]), { __bytes__: 'AA==' }],
		[new Date(0), { __date__: 0 }],
		[new Map(), { __map__: [] }],
		[new Set(), { __set__: [] }]
	]) {
		assert.equal(equivalent({ value }, { value: literal }, strict), false)
		assert.equal(omitsKeysOnly({}, value, strict), false)
	}
	assert.equal(omitsKeysOnly({}, { __bytes__: 'literal' }, strict), true)
})

for (const depth of [4_095, 4_096, 4_097, 10_000]) {
	it(`compares and classifies omissions without recursion at depth ${depth}`, () => {
		const left = chain(depth, { a: 1, b: 2 })
		assert.doesNotThrow(() => normalise(left))
		assert.equal(equivalent(left, chain(depth, { a: 1, b: 2 })), true)
		assert.equal(equivalent(left, chain(depth, { a: 9, b: 2 })), false)
		assert.equal(omitsKeysOnly(chain(depth, { b: 2 }), left), true)
		assert.equal(omitsKeysOnly(left, chain(depth, { b: 2 })), false)
	})
}

for (const depth of [0, 12, 13, 14, 400]) {
	for (const options of [{}, strict]) {
		it(`compares every branch value at depth ${depth}, strict=${options === strict}`, () => {
			assert.equal(equivalent(chain(depth, { a: 1, b: 2 }), chain(depth, { a: 1, b: 2 }), options), true)
			assert.equal(equivalent(chain(depth, { a: 1, b: 2 }), chain(depth, { a: 9, b: 2 }), options), false)
		})
	}
}

for (const depth of [0, 12, 13, 14, 400]) {
	it(`preserves chain identity at depth ${depth}`, () => {
		assert.equal(equivalent(chain(depth, chain(2, 1)), chain(depth, chain(2, 1, 'other'))), false)
		assert.equal(equivalent(chain(depth, 1), chain(depth + 1, 1)), false)
	})

	it(`keeps schema paths and array field paths at depth ${depth}`, () => {
		const paths: string[][] = []
		const expected = [...Array.from({ length: depth }, () => 'next'), 'text']
		const options = {
			isTextField: (path: readonly string[]) => {
				paths.push([...path])
				return path.join('.') === expected.join('.')
			}
		}
		for (const [a, b] of [
			['0', 0],
			[['0'], [0]]
		]) {
			assert.equal(equivalent(chain(depth, { text: a }), chain(depth, { text: b })), true)
			assert.equal(equivalent(chain(depth, { text: a }), chain(depth, { text: b }), options), false)
		}
		assert.deepEqual(paths, [expected, expected])
		const prefixed: string[][] = []
		normalise(
			chain(depth, { text: '0' }),
			99,
			{
				isTextField: path => {
					prefixed.push([...path])
					return true
				}
			},
			['Message']
		)
		assert.deepEqual(prefixed, [['Message', ...expected]])
	})

	it(`honours scalar and presence policies at depth ${depth}`, () => {
		for (const [left, right] of [
			[123, '123'],
			[123, 123n],
			['123', 123n],
			[-0, 0]
		]) {
			assert.equal(equivalent(chain(depth, left), chain(depth, right)), true)
			assert.equal(equivalent(chain(depth, left), chain(depth, right), strict), false)
		}
		assert.equal(equivalent(chain(depth, NaN), chain(depth, NaN), strict), true)
		const a = chain(depth, { a: undefined, b: 2 })
		const b = chain(depth, { b: 2 })
		assert.equal(equivalent(a, b), true)
		assert.equal(equivalent(a, b, { preservePresence: true }), false)
		// Retain the existing Long policy, including strict mode.
		assert.equal(equivalent(chain(depth, { low: 123, high: 0 }), chain(depth, 123)), true)
		assert.equal(equivalent(chain(depth, { low: -1, high: -1 }), chain(depth, -1n)), true)
		assert.equal(equivalent(chain(depth, { low: 123, high: 0 }), chain(depth, 123), strict), false)
	})

	it(`compares container contents at depth ${depth}`, () => {
		for (const options of [{}, strict]) {
			for (const [left, right] of [
				[Buffer.from([1, 2]), Uint8Array.from([1, 9])],
				[new Date(1), new Date(9)],
				[new Map([['key', { a: 1, b: 2 }]]), new Map([['key', { a: 9, b: 2 }]])],
				[new Set([1, 2]), new Set([1, 9])],
				[
					[1, 2],
					[1, 9]
				],
				[[1], { '0': 1 }]
			])
				assert.equal(equivalent(chain(depth, left), chain(depth, right), options), false)
			for (const make of [
				() => new Date(1),
				() => new Map([['key', { a: 1, b: 2 }]]),
				() => new Set([1, 2]),
				() => [1, 2]
			]) {
				assert.equal(equivalent(chain(depth, make()), chain(depth, make()), options), true)
			}
			assert.equal(equivalent(chain(depth, Buffer.from([1, 2])), chain(depth, Uint8Array.from([1, 2])), options), true)
		}
	})

	it(`separates key omission from changed values at depth ${depth}`, () => {
		for (const options of [{}, strict]) {
			const left = { nested: chain(depth, { a: 9, b: 2 }) }
			const right = { missing: true, nested: chain(depth, { a: 1, b: 2 }) }
			assert.equal(equivalent(left, right, options), false)
			assert.equal(omitsKeysOnly(left, right, options), false)
			const subset = chain(depth, { b: 2 })
			const whole = chain(depth, { a: 1, b: 2 })
			assert.equal(omitsKeysOnly(subset, whole, options), true)
			assert.equal(omitsKeysOnly(whole, subset, options), false)
			assert.equal(omitsKeysOnly(whole, chain(depth, { a: 1, b: 2 }), options), false)
		}
		const options = { isTextField: (path: readonly string[]) => path.at(-1) === 'text' }
		assert.equal(
			omitsKeysOnly(
				{ nested: chain(depth, { text: 0 }) },
				{ missing: true, nested: chain(depth, { text: '0' }) },
				options
			),
			false
		)
	})
}

it('treats shared children as values, not cycles or identity constraints', () => {
	const child = { a: 1, b: 2 }
	const shared = { left: child, right: child }
	const copies = { left: { a: 1, b: 2 }, right: { a: 1, b: 2 } }
	assert.equal(equivalent(shared, copies, strict), true)
	assert.equal(omitsKeysOnly(shared, copies, strict), false)
	assert.equal(equivalent({ left: child, right: { a: 9, b: 2 } }, copies, strict), false)
})

it('keeps Map key/value ordering and ordered Set semantics', () => {
	const a = new Map<unknown, unknown>([
		[2, 'two'],
		[1, 'one']
	])
	const b = new Map<unknown, unknown>([
		[1, 'one'],
		[2, 'two']
	])
	assert.equal(equivalent(a, b), true)
	assert.deepEqual((normalise(a) as { __map__: unknown }).__map__, [
		[1n, 'one'],
		[2n, 'two']
	])
	assert.equal(equivalent(new Set([1, 2]), new Set([2, 1])), false)
	const f = () => 1
	const g = () => 2
	assert.equal(
		equivalent(
			new Map([
				[f, 'a'],
				[g, 'b']
			]),
			new Map([
				[g, 'b'],
				[f, 'a']
			])
		),
		true
	)
	assert.equal(omitsKeysOnly(new Map([['a', {}]]), new Map([['a', { missing: true }]])), false)
	assert.equal(omitsKeysOnly(new Set([{}]), new Set([{ missing: true }])), false)
})
