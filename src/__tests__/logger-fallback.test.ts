import { describe, it } from 'node:test'
import { formatFallbackLine } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const parse = (line: string | undefined): Record<string, unknown> =>
	JSON.parse(line as string) as Record<string, unknown>

describe('fallback log lines', () => {
	it('redacts credential paths in child bindings, not just per-call objects', () => {
		const line = formatFallbackLine({
			method: 'info',
			currentLevel: 'info',
			bindings: { name: 'baileyrs', session: { secretKey: 'shh' }, keep: 'visible' },
			args: [{ event: 'test' }]
		})
		expect(parse(line)).toMatchObject({
			session: { secretKey: '[REDACTED]' },
			keep: 'visible',
			event: 'test'
		})
	})

	it('redacts per-call credential objects and wildcards one level deep', () => {
		const line = formatFallbackLine({
			method: 'info',
			currentLevel: 'info',
			bindings: {},
			args: [{ creds: { noiseKey: 'shh' }, nested: { privateKey: 'shh' }, keep: 'visible' }]
		})
		const entry = parse(line)
		expect(entry.creds).toBe('[REDACTED]')
		expect(entry).toMatchObject({ nested: { privateKey: '[REDACTED]' }, keep: 'visible' })
	})

	it('never mutates the caller object while redacting', () => {
		const logged = { creds: { noiseKey: 'shh' } }
		formatFallbackLine({ method: 'info', currentLevel: 'info', bindings: {}, args: [logged] })
		expect(logged).toEqual({ creds: { noiseKey: 'shh' } })
	})

	it('serializes Error values with message and stack instead of dropping them', () => {
		const error = new Error('boom')
		const line = formatFallbackLine({
			method: 'error',
			currentLevel: 'info',
			bindings: {},
			args: [{ err: error }, 'failed']
		})
		const entry = parse(line) as { err: { type: string; message: string; stack: string }; msg: string }
		expect(entry.err.type).toBe('Error')
		expect(entry.err.message).toBe('boom')
		expect(typeof entry.err.stack).toBe('string')
		expect(entry.msg).toBe('failed')
	})

	it('survives circular structures, BigInt values and functions without throwing', () => {
		const circular: Record<string, unknown> = { keep: 'visible', big: 10n, fn: () => {} }
		circular.self = circular
		const line = formatFallbackLine({ method: 'info', currentLevel: 'info', bindings: {}, args: [circular] })
		const entry = parse(line) as { keep: string; big: string; self: string }
		expect(entry.keep).toBe('visible')
		expect(entry.big).toBe('10')
		expect(entry.self).toBe('[Circular]')
		expect('fn' in entry).toBe(false)
	})

	it('interpolates printf-style placeholders and keeps leftover arguments', () => {
		const line = formatFallbackLine({
			method: 'info',
			currentLevel: 'info',
			bindings: {},
			args: ['hello %s, %d left', 'world', 3, { extra: true }]
		})
		expect(parse(line).msg).toBe('hello world, 3 left {"extra":true}')
	})

	it('escapes %% and leaves unmatched placeholders in place', () => {
		const line = formatFallbackLine({
			method: 'info',
			currentLevel: 'info',
			bindings: {},
			args: ['100%% sure %s']
		})
		expect(parse(line).msg).toBe('100% sure %s')
	})

	it('interpolates the message of object-first calls', () => {
		const line = formatFallbackLine({
			method: 'warn',
			currentLevel: 'info',
			bindings: {},
			args: [{ scope: 'retry' }, 'attempt %d', 2]
		})
		const entry = parse(line)
		expect(entry).toMatchObject({ scope: 'retry', msg: 'attempt 2' })
	})

	it('emits level, time and msg on string-first calls', () => {
		const line = formatFallbackLine({ method: 'debug', currentLevel: 'debug', bindings: {}, args: ['hi'] })
		const entry = parse(line)
		expect(entry.level).toBe(20)
		expect(entry.msg).toBe('hi')
		expect(typeof entry.time).toBe('string')
	})

	it('stays silent below the configured level and on silent', () => {
		const quiet = { method: 'debug', currentLevel: 'info', bindings: {}, args: ['hidden'] }
		expect(formatFallbackLine(quiet)).toBeUndefined()
		const silenced = { method: 'fatal', currentLevel: 'silent', bindings: {}, args: ['hidden'] }
		expect(formatFallbackLine(silenced)).toBeUndefined()
	})
})
