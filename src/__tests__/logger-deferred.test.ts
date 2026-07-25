import fs from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import logger from '../Utils/logger.ts'
import { expect } from './expect.ts'

// The default export is a process-wide singleton, so these cases share state and
// run in declaration order: everything that must observe an unbuilt pino comes
// before the first log call.
const requireFrom = createRequire(import.meta.url)
const pinoIsBuilt = (): boolean => Object.keys(requireFrom.cache).some(path => /[\\/]pino[\\/]/.test(path))
const configuredLevel = process.env.BAILEYRS_LOG_LEVEL || 'info'

/** pino writes through sonic-boom straight to the descriptor, so stdout has to be captured at `fs.write`. */
const captureStdout = (run: () => void): string[] => {
	const lines: string[] = []
	const realWrite = fs.write as unknown as (...args: unknown[]) => unknown
	fs.write = ((descriptor: number, chunk: unknown, ...rest: unknown[]): unknown => {
		if (descriptor !== 1) return realWrite(descriptor, chunk, ...rest)
		lines.push(String(chunk))
		const callback = rest.at(-1)
		if (typeof callback === 'function') (callback as (...args: unknown[]) => void)(null, String(chunk).length, chunk)
		return undefined
	}) as unknown as typeof fs.write
	try {
		run()
	} finally {
		fs.write = realWrite as unknown as typeof fs.write
	}
	return lines
}

describe('deferred logger', () => {
	it('keeps pino unbuilt while only child() and level are used', () => {
		expect(pinoIsBuilt()).toBe(false)
		const child = logger.child({ class: 'baileys' })
		expect(logger.level).toBe(configuredLevel)
		expect(child.level).toBe(configuredLevel)
		expect(pinoIsBuilt()).toBe(false)
	})

	it('propagates a level assigned before anything resolves', () => {
		logger.level = 'debug'
		expect(logger.level).toBe('debug')
		expect(logger.child({ a: 1 }).level).toBe('debug')
		expect(logger.child({ a: 1 }).child({ b: 2 }).level).toBe('debug')
		expect(pinoIsBuilt()).toBe(false)
	})

	it('builds pino on the first log call', () => {
		logger.level = 'silent'
		logger.info('resolves the logger without emitting anything')
		expect(pinoIsBuilt()).toBe(true)
		expect(logger.level).toBe('silent')
	})

	it('keeps pino level inheritance after resolving', () => {
		expect(logger.child({ c: 3 }).level).toBe('silent')
		const child = logger.child({ c: 3 })
		child.level = 'error'
		expect(child.level).toBe('error')
		expect(logger.level).toBe('silent')
	})

	it('reports the parent live level to an unresolved child', () => {
		// Once the parent has resolved, its level lives on pino — reading the
		// pending value instead would hand children a stale one.
		logger.level = 'warn'
		try {
			expect(logger.level).toBe('warn')
			expect(logger.child({ d: 4 }).level).toBe('warn')
		} finally {
			logger.level = 'silent'
		}
	})

	it('merges bindings across nested children', () => {
		expect(logger.child({ a: 1 }).child({ b: 2 }).bindings()).toMatchObject({ name: 'baileyrs', a: 1, b: 2 })
	})

	it('exposes pino members beyond the ILogger surface', () => {
		expect(typeof logger.fatal).toBe('function')
		expect(typeof logger.flush).toBe('function')
		expect(logger.levels.values.debug).toBe(20)
		expect('fatal' in logger).toBe(true)
		expect('definitelyNotAPinoMember' in logger).toBe(false)
		expect(Object.keys(logger).length).toBeGreaterThan(0)
	})

	it('caches resolved methods by identity', () => {
		expect(logger.info).toBe(logger.info)
	})

	it('drops cached methods when the level changes', () => {
		// pino replaces disabled log methods with noops, so a cache that survived
		// the assignment would keep calling the silent one.
		const silent = logger.info
		logger.level = 'info'
		try {
			expect(logger.info).not.toBe(silent)
		} finally {
			logger.level = 'silent'
		}
	})

	it('emits from a child at a level assigned to an unresolved parent', async () => {
		// A fresh module instance: the singleton above has already resolved, and
		// this is the ordering that regressed — the child resolving first.
		const fresh = (await import(`${'../Utils/logger.ts'}?fresh-instance`)).default as typeof logger
		fresh.level = 'debug'
		const child = fresh.child({ scope: 'fresh' })
		const lines = captureStdout(() => child.debug('inherited'))
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]!)).toMatchObject({ level: 20, scope: 'fresh', msg: 'inherited' })
	})

	it('keeps the configured redaction and timestamp format', () => {
		logger.level = 'info'
		let lines: string[] = []
		try {
			lines = captureStdout(() =>
				logger.info({ creds: { noiseKey: 'secret' }, nested: { privateKey: 'secret' }, keep: 'visible' }, 'redaction')
			)
		} finally {
			logger.level = 'silent'
		}
		expect(lines).toHaveLength(1)
		const entry = JSON.parse(lines[0]!) as {
			creds: string
			nested: { privateKey: string }
			keep: string
			time: string
		}
		expect(entry.creds).toBe('[REDACTED]')
		expect(entry.nested.privateKey).toBe('[REDACTED]')
		expect(entry.keep).toBe('visible')
		expect(entry.time).toBe(new Date(entry.time).toJSON())
	})
})
