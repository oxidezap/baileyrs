import type { OrderResult, BusinessProfileUpdateInput } from '@oxidezap/whatsapp-rust-bridge'
import type { CatalogPage, CollectionsPage, GetCatalogOptions } from '../Types/Product.ts'
import type { UpdateBussinesProfileProps } from '../Types/Bussines.ts'
import { Boom } from '../Utils/boom.ts'
import { jidNormalizedUser } from '../WABinary/jid-utils.ts'
import type { SocketContext } from './types.ts'

/**
 * Product create, update and delete exist only in Baileys: the operations they
 * send appear in no WhatsApp Web bundle. Declared so a migrating caller reads
 * why instead of a bare TypeError, and rejecting because there is nothing to
 * call.
 */
const noProductWriteRoute = (method: string): never => {
	throw new Boom(
		`${method} is not supported: the WhatsApp Web client has no product create, edit or delete operation, so there is nothing for this to call. Manage the catalog from the WhatsApp Business app.`,
		{ statusCode: 501 }
	)
}

/**
 * Upstream types these as strings, so an empty one is reachable from an
 * unfilled form. `Number('')` is midnight, which would quietly rewrite the
 * schedule instead of being refused.
 */
const minutesPastMidnight = (value: string, which: 'open' | 'close'): number => {
	const minutes = Number(value)
	if (value.trim() === '' || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
		throw new Boom(`updateBussinesProfile: ${which} time '${value}' is not a count of minutes past midnight`, {
			statusCode: 400
		})
	}
	return minutes
}

/**
 * Both catalog reads take an optional jid and mean "mine" without one, as
 * upstream does. Only a socket that has not finished logging in has no
 * identity to fall back on, and that is worth saying rather than sending an
 * empty jid the server would reject.
 */
const catalogSubject = (method: string, ctx: SocketContext, jid?: string): string => {
	const subject = jidNormalizedUser(jid || ctx.getUser()?.id)
	if (!subject) {
		throw new Boom(
			`${method}: no jid was given and the socket is not logged in yet, so there is no own catalog to read`,
			{
				statusCode: 400
			}
		)
	}
	return subject
}

export const makeBusinessMethods = (ctx: SocketContext) => ({
	getCatalog: async ({ jid, limit, cursor }: GetCatalogOptions): Promise<CatalogPage> => {
		const subject = catalogSubject('getCatalog', ctx, jid)
		return await (await ctx.getClient()).getCatalog(subject, { limit, after: cursor })
	},

	getCollections: async (jid?: string, limit?: number): Promise<CollectionsPage> => {
		const subject = catalogSubject('getCollections', ctx, jid)
		return await (await ctx.getClient()).getCollections(subject, { collectionLimit: limit })
	},

	/**
	 * `sellerJid` is not in upstream's signature because upstream reads orders
	 * over the legacy `fb:thrift_iq` route, which addresses the server. The
	 * route the real client uses is a MEX query keyed by the seller, so the JID
	 * is required here. It is on the order message the token came from.
	 */
	getOrderDetails: async (orderId: string, tokenBase64: string, sellerJid?: string): Promise<OrderResult> => {
		if (!sellerJid) {
			throw new Boom(
				'getOrderDetails: a third argument with the seller jid is required, because orders are read through a query keyed by the business rather than the legacy server-addressed one',
				{ statusCode: 400 }
			)
		}
		return await (await ctx.getClient()).getOrder(sellerJid, orderId, tokenBase64)
	},

	updateBussinesProfile: async (args: UpdateBussinesProfileProps): Promise<void> => {
		const update: BusinessProfileUpdateInput = {
			address: args.address,
			description: args.description,
			email: args.email,
			websites: args.websites,
			...(args.hours !== undefined
				? {
						businessHours: {
							timezone: args.hours.timezone,
							// Minutes past midnight as a number; upstream types the two
							// as strings and the core rejects them on the other modes.
							config: args.hours.days.map(day => ({
								dayOfWeek: day.day,
								mode: day.mode,
								openTime:
									day.mode === 'specific_hours' ? minutesPastMidnight(day.openTimeInMinutes, 'open') : undefined,
								closeTime:
									day.mode === 'specific_hours' ? minutesPastMidnight(day.closeTimeInMinutes, 'close') : undefined
							}))
						}
					}
				: {})
		}
		await (await ctx.getClient()).updateBusinessProfile(update)
	},

	/**
	 * Declared but not callable end to end. The core and the bridge take the
	 * `{fbid, meta_hmac, ts}` receipt of a cover photo upload, and this
	 * package's upload path cannot produce one: it requires a url and a
	 * direct path, which that endpoint does not return.
	 */
	updateCoverPhoto: async (_photo: unknown): Promise<never> => {
		throw new Boom(
			'updateCoverPhoto is not available yet: the cover photo upload returns an {fbid, meta_hmac, ts} receipt that this package cannot obtain. removeCoverPhoto works.',
			{ statusCode: 501 }
		)
	},

	removeCoverPhoto: async (id: string): Promise<void> => {
		await (await ctx.getClient()).removeBusinessCoverPhoto(id)
	},

	productCreate: async (_create: unknown): Promise<never> => noProductWriteRoute('productCreate'),

	productUpdate: async (_productId: string, _update: unknown): Promise<never> => noProductWriteRoute('productUpdate'),

	productDelete: async (_productIds: string[]): Promise<never> => noProductWriteRoute('productDelete')
})
