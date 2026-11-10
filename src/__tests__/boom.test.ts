import { describe, it } from 'node:test'
import { Boom, isBoom } from '../Utils/boom.ts'
import { expect } from './expect.ts'

describe('Boom compatibility', () => {
	it('uses the canonical output status and payload', () => {
		const error = new Boom('bad', { statusCode: 400 })
		expect(error.output.statusCode).toBe(400)
		expect(error.output.payload).toEqual({
			statusCode: 400,
			error: 'Bad Request',
			message: 'bad'
		})
	})

	it('defaults to a sanitized 500 response', () => {
		const error = new Boom('internal detail')
		expect(error.output.statusCode).toBe(500)
		expect(error.output.payload.message).toBe('An internal server error occurred')
		expect(error.isServer).toBe(true)
	})

	it('is an Error and preserves generic data', () => {
		interface MyData {
			directPath: string
		}
		const error = new Boom<MyData>('x', { data: { directPath: '/abc' } })
		expect(error).toBeInstanceOf(Error)
		expect(error.data?.directPath).toBe('/abc')
	})

	it('exposes the complete upstream runtime contract', () => {
		const error = new Boom('x', { statusCode: 503 })
		expect(typeof error.reformat).toBe('function')
		expect(typeof error.typeof).toBe('function')
		error.output.headers['retry-after'] = 30
		expect(error.output.headers['retry-after']).toBe(30)
	})

	it('isBoom recognizes canonical Boom values without accepting shallow lookalikes', () => {
		expect(isBoom(new Boom('x'))).toBe(true)
		expect(isBoom(new Error('x'))).toBe(false)
		expect(isBoom({ isBoom: true, message: 'x' })).toBe(false)
		expect(isBoom(null)).toBe(false)
	})
})
