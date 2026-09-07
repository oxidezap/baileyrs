import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
/**
 * Catalog, collections, orders and the business profile.
 *
 * Two things here are not delegation and are the reason the file exists.
 *
 * Money never becomes a `number`. The bridge sends `amount1000` as a decimal
 * string of thousandths, and above 2^53 thousandths a `number` stops being
 * exact. Upstream types price as `number`; matching that would make a large
 * order silently wrong, so the string travels through untouched.
 *
 * The three product write methods reject. Not "not ported yet": the operations
 * upstream sends for them appear in no WhatsApp Web bundle, so there is no
 * route to delegate to and there never will be.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { CatalogResult, OrderResult, WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { makeBusinessMethods } from '../Socket/business.ts'
import type { WithClientSocketContext as SocketContext } from '../Socket/types.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const SELLER = '15551230000@s.whatsapp.net'

const logger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as ILogger

const makeHarness = (overrides: Record<string, unknown> = {}, ownId?: string) => {
	const calls: Array<[string, unknown[]]> = []
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
	const ctx = {
		ev: new EventEmitter(),
		logger,
		getMe: () => (ownId === undefined ? undefined : { id: ownId }),
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) => operation((await client) as MockClient)
	} as unknown as SocketContext
	return { calls, methods: makeBusinessMethods(ctx) }
}

describe('the reads delegate with the options the bridge takes', () => {
	it('getCatalog maps upstream cursor onto the after cursor', async () => {
		const { calls, methods } = makeHarness()

		await methods.getCatalog({ jid: SELLER, limit: 10, cursor: 'CURSOR1' })

		expect(calls).toEqual([['getCatalog', [SELLER, { limit: 10, after: 'CURSOR1' }]]])
	})

	it('getCollections maps limit onto the collection limit', async () => {
		const { calls, methods } = makeHarness()

		await methods.getCollections(SELLER, 5)

		expect(calls).toEqual([['getCollections', [SELLER, { collectionLimit: 5 }]]])
	})

	/**
	 * Upstream reads the caller's own catalog when the jid is left out, from the
	 * persisted credentials rather than the socket's own initialisation, so a
	 * restored session can call it right away. The id there carries a device
	 * suffix that the catalog query does not take.
	 */
	for (const [label, run] of [
		['getCatalog', (m: ReturnType<typeof makeHarness>['methods']) => m.getCatalog({ limit: 1 })],
		['getCollections', (m: ReturnType<typeof makeHarness>['methods']) => m.getCollections()]
	] as const) {
		it(`${label} without a jid reads the account's own catalog`, async () => {
			const { calls, methods } = makeHarness({}, '15559990000:7@s.whatsapp.net')

			await run(methods)

			expect(calls[0]![1][0]).toBe('15559990000@s.whatsapp.net')
		})

		it(`${label} rejects when there is no jid and no account to fall back on`, async () => {
			const { calls, methods } = makeHarness()

			await expect(run(methods)).rejects.toThrow(/no authenticated account/)
			expect(calls).toEqual([])
		})
	}
})

/**
 * Upstream reads an order over the legacy server-addressed route, so its
 * signature has no seller. The route the real client uses is keyed by the
 * business, so the JID is needed and the shortfall is reported rather than
 * guessed at.
 */
describe('getOrderDetails needs the seller the modern route is keyed by', () => {
	it('passes seller, order and token in the order the bridge takes them', async () => {
		const { calls, methods } = makeHarness()

		await methods.getOrderDetails('ORDER1', 'TOKEN1', SELLER)

		expect(calls).toEqual([['getOrder', [SELLER, 'ORDER1', 'TOKEN1']]])
	})

	it('rejects when called with only upstream two arguments, and says why', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.getOrderDetails('ORDER1', 'TOKEN1')).rejects.toThrow(/seller jid is required/)
		expect(calls).toEqual([])
	})
})

describe('money crosses as a string and stays one', () => {
	// 9007199254740993 thousandths is 2^53 + 1: the first integer a double
	// cannot represent, so a Number() anywhere on this path loses it.
	const UNSAFE = '9007199254740993'

	it('a catalog price survives a value that a number could not hold', async () => {
		const catalog: CatalogResult = {
			products: [{ id: 'p1', price: { amount1000: UNSAFE, currency: 'BRL' }, images: [], videos: [] }]
		}
		const { methods } = makeHarness({ getCatalog: async () => catalog })

		const result = await methods.getCatalog({ jid: SELLER })

		expect(result.products[0]!.price!.amount1000).toBe(UNSAFE)
		expect(typeof result.products[0]!.price!.amount1000).toBe('string')
		// The round trip a Number() would have made lossy.
		expect(String(Number(UNSAFE))).toBe('9007199254740992')
	})

	it('an order total survives the same value', async () => {
		const order: OrderResult = {
			products: [],
			priceDetails: { currency: 'BRL', total: { amount1000: UNSAFE, currency: 'BRL' } }
		}
		const { methods } = makeHarness({ getOrder: async () => order })

		const result = await methods.getOrderDetails('ORDER1', 'TOKEN1', SELLER)

		expect(result.priceDetails!.total!.amount1000).toBe(UNSAFE)
	})
})

describe('updateBussinesProfile carries every field the delta has', () => {
	it('forwards the plain fields', async () => {
		const { calls, methods } = makeHarness()

		await methods.updateBussinesProfile({
			address: 'Rua 1',
			description: 'Loja',
			email: 'a@b.invalid',
			websites: ['https://example.invalid']
		})

		expect(calls).toEqual([
			[
				'updateBusinessProfile',
				[
					{
						address: 'Rua 1',
						description: 'Loja',
						email: 'a@b.invalid',
						websites: ['https://example.invalid']
					}
				]
			]
		])
	})

	it('converts opening hours, and sends times only for the mode that takes them', async () => {
		const { calls, methods } = makeHarness()

		await methods.updateBussinesProfile({
			hours: {
				timezone: 'America/Sao_Paulo',
				days: [
					{ day: 'mon', mode: 'specific_hours', openTimeInMinutes: '540', closeTimeInMinutes: '1080' },
					{ day: 'sun', mode: 'open_24h' }
				]
			}
		})

		const update = (calls[0]![1][0] as { businessHours: { config: unknown[] } }).businessHours
		expect(update.config).toEqual([
			{ dayOfWeek: 'mon', mode: 'specific_hours', openTime: 540, closeTime: 1080 },
			{ dayOfWeek: 'sun', mode: 'open_24h', openTime: undefined, closeTime: undefined }
		])
	})
})

describe('an unusable opening-hour time is refused, not read as midnight', () => {
	for (const [label, open, close] of [
		['empty', '', '1080'],
		['blank', '   ', '1080'],
		['not a number', 'nine', '1080'],
		['out of range', '540', '5000']
	] as const) {
		it(`${label} rejects`, async () => {
			const { calls, methods } = makeHarness()

			await expect(
				methods.updateBussinesProfile({
					hours: {
						timezone: 'America/Sao_Paulo',
						days: [{ day: 'mon', mode: 'specific_hours', openTimeInMinutes: open, closeTimeInMinutes: close }]
					}
				})
			).rejects.toThrow(/is not a count of minutes past midnight/)
			expect(calls).toEqual([])
		})
	}
})

describe('removeCoverPhoto works and updateCoverPhoto says what is missing', () => {
	it('remove delegates', async () => {
		const { calls, methods } = makeHarness()

		await methods.removeCoverPhoto('COVER1')

		expect(calls).toEqual([['removeBusinessCoverPhoto', ['COVER1']]])
	})

	it('update rejects naming the receipt this package cannot obtain', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.updateCoverPhoto(Buffer.from('jpeg'))).rejects.toThrow(/meta_hmac/)
		expect(calls).toEqual([])
	})
})

/**
 * These three are not pending work. `product_catalog_add`, `_edit` and
 * `_delete` appear in no WhatsApp Web bundle, so the message has to say "will
 * not" rather than "not yet", or the next reader files it as a gap to close.
 */
describe('the product write methods reject, and say the route does not exist', () => {
	for (const [label, run] of [
		['productCreate', (m: ReturnType<typeof makeHarness>['methods']) => m.productCreate({} as never)],
		['productUpdate', (m: ReturnType<typeof makeHarness>['methods']) => m.productUpdate('p1', {} as never)],
		['productDelete', (m: ReturnType<typeof makeHarness>['methods']) => m.productDelete(['p1'])]
	] as const) {
		it(`${label} rejects`, async () => {
			const { calls, methods } = makeHarness()

			await expect(run(methods)).rejects.toThrow(/has no product create, edit or delete operation/)
			expect(calls).toEqual([])
		})
	}
})

describe('business methods do not swallow a bridge failure', () => {
	it('a rejection propagates', async () => {
		const { methods } = makeHarness({
			getCatalog: async () => {
				throw new Error('server error 403: forbidden')
			}
		})

		await expect(methods.getCatalog({ jid: SELLER })).rejects.toThrow(/server error 403/)
	})
})
