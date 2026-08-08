/**
 * Upstream exposes a good deal of socket internals: caches, buffers, a clock
 * offset, a retry manager. In this package that state lives in the Rust core by
 * design, so most of these are refusals rather than implementations, and the
 * tests here are mostly about the refusals being loud and specific.
 *
 * The two that are real work are `waitForSocketOpen`, where the choice is which
 * of the bridge's two waits matches upstream's meaning, and `upsertMessage`,
 * where only the event half belongs to this layer.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { makeInternalMethods } from '../Socket/internals.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { WAMessage } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const makeHarness = (overrides: Record<string, unknown> = {}, connectTimeoutMs?: number) => {
	const calls: Array<[string, unknown[]]> = []
	const logged: string[] = []
	const logger = {
		level: 'silent',
		child: () => logger,
		trace: () => undefined,
		debug: () => undefined,
		info: () => undefined,
		warn: (a: unknown, b?: unknown) => logged.push(typeof a === 'string' ? a : String(b)),
		error: (a: unknown, b?: unknown) => logged.push(typeof a === 'string' ? a : String(b))
	} as unknown as ILogger
	const client = new Proxy({} as Record<string, unknown>, {
		get: (_t, prop) => {
			if (typeof prop !== 'string' || prop === 'then') return undefined
			if (prop in overrides) return overrides[prop]
			return async (...args: unknown[]) => {
				calls.push([prop, args])
				return undefined
			}
		}
	}) as unknown as WasmWhatsAppClient
	const events: Array<[string, unknown]> = []
	const ev = new EventEmitter()
	ev.on('messages.upsert', payload => events.push(['messages.upsert', payload]))
	const ctx = {
		ev,
		logger,
		fullConfig: connectTimeoutMs === undefined ? {} : { connectTimeoutMs },
		getClient: async () => client
	} as unknown as SocketContext
	return { calls, events, logged, methods: makeInternalMethods(ctx) }
}

describe('waitForSocketOpen waits for the socket, not for the login', () => {
	it('takes the socket wait, since upstream waits for the transport to open', async () => {
		const { calls, methods } = makeHarness({}, 20_000)

		await methods.waitForSocketOpen()

		expect(calls).toEqual([['waitForSocket', [20_000]]])
	})

	it('bounds the wait by the socket connect timeout rather than waiting forever', async () => {
		const { calls, methods } = makeHarness({}, 5_000)

		await methods.waitForSocketOpen()

		expect(calls).toEqual([['waitForSocket', [5_000]]])
	})

	it('a timeout from the bridge surfaces rather than resolving', async () => {
		const { methods } = makeHarness({
			waitForSocket: async () => {
				throw new Error('request timed out')
			}
		})

		await expect(methods.waitForSocketOpen()).rejects.toThrow(/timed out/)
	})
})

describe('upsertMessage publishes the event and nothing else', () => {
	it('emits messages.upsert with the message and type', async () => {
		const { calls, events, methods } = makeHarness()
		const message = { key: { id: 'M1' } } as WAMessage

		await methods.upsertMessage(message, 'notify')

		expect(events).toEqual([['messages.upsert', { messages: [message], type: 'notify' }]])
		// The push-name half of upstream's version is not reproduced: contact
		// state is the core's, and a second writer would diverge from it.
		expect(calls).toEqual([])
	})
})

describe('resyncAppState is a no-op that says so once', () => {
	it('resolves with upstream two required arguments', async () => {
		const { calls, methods } = makeHarness()

		await methods.resyncAppState(['critical_unblock_low'], false)

		expect(calls).toEqual([])
	})

	it('warns once, not per call', async () => {
		const { logged, methods } = makeHarness()

		await methods.resyncAppState(['regular'], false)
		await methods.resyncAppState(['regular'], false)

		expect(logged.filter(line => line.includes('resyncAppState')).length).toBe(1)
	})
})

describe('onUnexpectedError reports rather than swallowing', () => {
	it('logs the error with the context it was given', () => {
		const { logged, methods } = makeHarness()

		methods.onUnexpectedError(new Error('boom'), 'message handler')

		expect(logged.some(line => line.includes('message handler'))).toBe(true)
	})
})

/**
 * Each refusal has to name why, because the reason is the whole content: a
 * reader who only sees "not supported" files it as work to do later, and
 * reimplementing any of these here is the thing the refusal exists to prevent.
 */
describe('the refusals name the reason, not just the absence', () => {
	for (const [label, run, reason] of [
		[
			'updateServerTimeOffset',
			(m: ReturnType<typeof makeHarness>['methods']) => async () => m.updateServerTimeOffset({ tag: 'iq', attrs: {} }),
			/tracks the server clock offset itself/
		],
		[
			'sendUnifiedSession',
			(m: ReturnType<typeof makeHarness>['methods']) => () => m.sendUnifiedSession(),
			/lifecycle machinery the engine owns/
		],
		[
			'appPatch',
			(m: ReturnType<typeof makeHarness>['methods']) => () => m.appPatch({} as never),
			/use the typed chatModify variants/
		]
	] as const) {
		it(`${label} rejects and says why`, async () => {
			const { calls, methods } = makeHarness()

			await expect(run(methods)()).rejects.toThrow(reason)
			expect(calls).toEqual([])
		})
	}
})

describe('messageRetryManager is null rather than a second retry manager', () => {
	it('is declared, and empty, because retry belongs to the engine', () => {
		const { methods } = makeHarness()

		expect(methods.messageRetryManager).toBe(null)
	})
})
