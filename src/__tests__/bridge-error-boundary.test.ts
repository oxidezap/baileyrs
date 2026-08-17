/**
 * The translation contract, piece by piece.
 *
 * `bridge-rejection-caller-stack.test.ts` proves the symptom against the real
 * wasm boundary; this file pins the mechanism with plain objects, where every
 * edge is cheap to reach: what is copied, what is not invented, and what
 * passes through untouched.
 */

import { describe, it } from 'node:test'

import { withCallerStack, wrapBridgeClient } from '../Socket/bridge-error-boundary.ts'
import { expect } from './expect.ts'

/** An error shaped the way the engine's glue builds one. */
const bridgeError = (payload: Record<string, unknown>): Error => {
	const error = new Error(String(payload.message ?? 'server error 429: rate-overlimit'))
	delete payload.message
	return Object.assign(error, { name: 'WhatsAppError', kind: 'server', ...payload })
}

describe('withCallerStack: what survives', () => {
	it('keeps the fields a consumer already switches on', () => {
		const translated = withCallerStack(bridgeError({ serverCode: 429, serverText: 'rate-overlimit' })) as Record<
			string,
			unknown
		>
		expect(translated.kind).toBe('server')
		expect(translated.serverCode).toBe(429)
		expect(translated.serverText).toBe('rate-overlimit')
		let branch = ''
		switch (translated.kind) {
			case 'server':
				branch = 'server'
				break
			default:
				branch = 'other'
		}
		expect(branch).toBe('server')
	})

	it('keeps name, message and instanceof Error', () => {
		const translated = withCallerStack(bridgeError({})) as Error
		expect(translated instanceof Error).toBe(true)
		expect(translated.name).toBe('WhatsAppError')
		expect(translated.message).toBe('server error 429: rate-overlimit')
	})

	it('carries the 0.14.0 server fields when the server sent them', () => {
		const translated = withCallerStack(bridgeError({ errorType: 'rate-overlimit', backoffSeconds: 60 })) as Record<
			string,
			unknown
		>
		expect(translated.errorType).toBe('rate-overlimit')
		expect(translated.backoffSeconds).toBe(60)
	})

	it('does not invent keys the rejection did not carry', () => {
		const translated = withCallerStack(bridgeError({ serverCode: 429, serverText: 'rate-overlimit' })) as object
		expect('backoffSeconds' in translated).toBe(false)
		expect('errorType' in translated).toBe(false)
	})

	it('carries a field this repository has never heard of', () => {
		const translated = withCallerStack(bridgeError({ nextBridgeField: 'v0.15' })) as Record<string, unknown>
		expect(translated.nextBridgeField).toBe('v0.15')
	})

	it('chains the original as cause', () => {
		const original = bridgeError({})
		const translated = withCallerStack(original) as Error
		expect(translated.cause).toBe(original)
	})
})

describe('withCallerStack: what passes through by identity', () => {
	it('a plain Error without kind', () => {
		const plain = new Error('nothing to do with the bridge')
		expect(withCallerStack(plain)).toBe(plain)
	})

	// A consumer store or cache can throw its own discriminated errors through
	// a bridge call; a string kind alone must not claim them for translation.
	it('an Error with a kind but not the bridge name', () => {
		class CacheError extends Error {
			kind = 'cache-miss'
		}
		const foreign = new CacheError('consumer-owned')
		expect(withCallerStack(foreign)).toBe(foreign)
	})

	it('a string, null, and a non-Error object carrying kind', () => {
		expect(withCallerStack('boom')).toBe('boom')
		expect(withCallerStack(null)).toBe(null)
		const bare = { kind: 'no-recipient-device', attempted: 2 }
		expect(withCallerStack(bare)).toBe(bare)
	})
})

describe('wrapBridgeClient', () => {
	const fakeClient = () => {
		const client = {
			calls: [] as unknown[][],
			isConnected() {
				return 'sync-value'
			},
			async fails() {
				await new Promise(resolve => setImmediate(resolve))
				throw bridgeError({ serverCode: 429 })
			},
			async succeeds(...args: unknown[]) {
				client.calls.push(args)
				return args.length
			},
			marker: 'not-a-function'
		}
		return client
	}

	it('rejections gain the awaiting caller frame', async () => {
		const wrapped = wrapBridgeClient(fakeClient() as never) as unknown as ReturnType<typeof fakeClient>
		async function theCallerToName() {
			return await wrapped.fails()
		}

		const error = await theCallerToName().then(
			() => null,
			e => e as Error
		)
		expect(String(error?.stack)).toContain('theCallerToName')
	})

	it('sync returns, arguments and non-function properties pass through', async () => {
		const raw = fakeClient()
		const wrapped = wrapBridgeClient(raw as never) as unknown as ReturnType<typeof fakeClient>
		expect(wrapped.isConnected()).toBe('sync-value')
		expect(wrapped.marker).toBe('not-a-function')
		expect(await wrapped.succeeds('a', 'b')).toBe(2)
		expect(raw.calls[0]).toEqual(['a', 'b'])
	})

	it('wraps one client to one stable proxy', () => {
		const raw = fakeClient()
		expect(wrapBridgeClient(raw as never)).toBe(wrapBridgeClient(raw as never))
	})
})
