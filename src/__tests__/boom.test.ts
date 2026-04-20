import { describe, it } from 'node:test'
import { Boom } from '../Utils/boom.ts'
import { expect } from './expect.ts'

describe('Boom', () => {
	it('stores statusCode from options', () => {
		const b = new Boom('bad', { statusCode: 400 })
		expect(b.statusCode).toBe(400)
		expect(b.output.statusCode).toBe(400)
	})

	it('defaults to statusCode 500', () => {
		expect(new Boom('x').statusCode).toBe(500)
	})

	it('is an instance of Error', () => {
		expect(new Boom('x')).toBeInstanceOf(Error)
	})

	it('preserves data with generic typing', () => {
		interface MyData {
			directPath: string
		}
		const b = new Boom<MyData>('x', { data: { directPath: '/abc' } })
		expect(b.data?.directPath).toBe('/abc')
	})

	it('propagates message and stack when wrapping an Error', () => {
		const inner = new Error('inner')
		const b = new Boom(inner)
		expect(b.message).toBe('inner')
		expect(b.stack).toBe(inner.stack)
	})

	it('respects cause option', () => {
		const cause = new Error('root')
		const b = new Boom('outer', { cause })
		expect(b.cause).toBe(cause)
	})

	it('isServer reflects statusCode >= 500', () => {
		expect(new Boom('x', { statusCode: 400 }).isServer).toBe(false)
		expect(new Boom('x', { statusCode: 500 }).isServer).toBe(true)
		expect(new Boom('x', { statusCode: 503 }).isServer).toBe(true)
	})

	it('output has canonical payload shape', () => {
		const b = new Boom('msg', { statusCode: 401 })
		expect(b.output.payload).toEqual({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'msg'
		})
	})

	it('output is structurally consistent across accesses', () => {
		// We deliberately do NOT cache `output` (the previous `#private` cache
		// crashed when the prototype chain was rewritten by `@hapi/boom`-style
		// wrappers). Each access should still return the same shape/values —
		// just not the same reference.
		const b = new Boom('x', { statusCode: 400 })
		expect(b.output).toEqual(b.output)
	})

	it('survives a HapiBoom-style wrap that hijacks the prototype', () => {
		// Simulates `new HapiBoom(ourBoom)` which uses `Object.setPrototypeOf`
		// to make the input `instanceof Boom` without re-running our
		// constructor. The previous `#output` field crashed here at the first
		// `.output` access because the WeakMap had no entry for the rewrapped
		// instance.
		const original = new Boom('x', { statusCode: 408 })
		const hijacked = Object.create(Boom.prototype) as Boom
		Object.assign(hijacked, original)
		expect(() => hijacked.output).not.toThrow()
		expect(hijacked.output.statusCode).toBe(408)
	})

	it('shares the same frozen headers across instances', () => {
		const a = new Boom('x')
		const b = new Boom('y')
		expect(a.output.headers).toBe(b.output.headers)
	})

	it('falls back to generic phrase for unknown codes', () => {
		expect(new Boom('x', { statusCode: 418 }).output.payload.error).toBe('Client Error')
		expect(new Boom('x', { statusCode: 599 }).output.payload.error).toBe('Server Error')
		expect(new Boom('x', { statusCode: 200 }).output.payload.error).toBe('Error')
	})

	it('Boom.isBoom narrows via user-defined type guard', () => {
		expect(Boom.isBoom(new Boom('x'))).toBe(true)
		expect(Boom.isBoom(new Error('x'))).toBe(false)
		expect(Boom.isBoom(null)).toBe(false)
		expect(Boom.isBoom(undefined)).toBe(false)
		expect(Boom.isBoom('string')).toBe(false)
	})

	it('Boom.isBoom duck-types external { isBoom: true } objects (@hapi/boom interop)', () => {
		expect(Boom.isBoom({ isBoom: true, message: 'x' })).toBe(true)
	})

	it('public fields are readonly at compile time', () => {
		const b = new Boom('x', { statusCode: 400 })
		// @ts-expect-error statusCode is readonly
		b.statusCode = 500
		// @ts-expect-error isBoom is readonly
		b.isBoom = false
	})
})
