import { Buffer } from 'node:buffer'
import { bridgeNewsletterMetadataToBaileys } from '../Compatibility/newsletter-results.ts'
import type { NewsletterMetadataResult } from '@oxidezap/whatsapp-rust-bridge'
import type { NewsletterMetadata, NewsletterUpdate } from '../Types/Newsletter.ts'
import type { WAMediaUpload } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { generateProfilePicture } from '../Utils/messages-media.ts'
import type { SocketContext } from './types.ts'

export const makeNewsletterMethods = (ctx: SocketContext) => ({
	newsletterCreate: async (name: string, description?: string): Promise<NewsletterMetadata> => {
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterCreate(name, description ?? null))
	},

	/**
	 * `type` selects which lookup runs: the bridge has a method per key kind
	 * rather than one that inspects the key. Resolves to null when the
	 * newsletter does not exist, matching upstream.
	 */
	newsletterMetadata: async (type: 'invite' | 'jid', key: string): Promise<NewsletterMetadata | null> => {
		if (type !== 'invite' && type !== 'jid') {
			throw new Boom(`newsletterMetadata: unknown key type '${type}'`, { statusCode: 400 })
		}
		const client = await ctx.getClient()
		const result =
			type === 'invite' ? await client.newsletterMetadataByInvite(key) : await client.newsletterMetadata(key)
		return result ? bridgeNewsletterMetadataToBaileys(result) : null
	},

	/**
	 * `picture` is base64 of an already-generated image, and the empty string
	 * means remove, as upstream builds it. The core splits those into two
	 * methods, so the field is dispatched rather than forwarded.
	 */
	newsletterUpdate: async (jid: string, updates: NewsletterUpdate): Promise<NewsletterMetadata> => {
		const client = await ctx.getClient()
		let result: NewsletterMetadataResult | undefined
		if (updates.name !== undefined || updates.description !== undefined) {
			result = await client.newsletterUpdate(jid, updates.name ?? null, updates.description ?? null)
		}
		if (updates.picture === '') {
			result = await client.newsletterRemovePicture(jid)
		} else if (updates.picture !== undefined) {
			result = await client.newsletterSetPicture(jid, new Uint8Array(Buffer.from(updates.picture, 'base64')))
		}
		// Only when the delta asked for nothing: every write above already
		// answers with the refreshed metadata, so reading it would be a round
		// trip whose result is thrown away.
		return bridgeNewsletterMetadataToBaileys(result ?? (await client.newsletterMetadata(jid)))
	},

	newsletterUpdateName: async (jid: string, name: string): Promise<NewsletterMetadata> => {
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterUpdate(jid, name, null))
	},

	newsletterUpdateDescription: async (jid: string, description: string): Promise<NewsletterMetadata> => {
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterUpdate(jid, null, description))
	},

	newsletterUpdatePicture: async (jid: string, content: WAMediaUpload): Promise<NewsletterMetadata> => {
		const { img } = await generateProfilePicture(content)
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterSetPicture(jid, img))
	},

	newsletterRemovePicture: async (jid: string): Promise<NewsletterMetadata> => {
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterRemovePicture(jid))
	},

	newsletterFollow: async (jid: string): Promise<NewsletterMetadata> => {
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterSubscribe(jid))
	},

	newsletterUnfollow: async (jid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterUnsubscribe(jid)
	},

	/**
	 * The names this package used before it grew upstream's. Kept so existing
	 * callers do not break on a rename that buys them nothing.
	 */
	newsletterSubscribe: async (jid: string): Promise<NewsletterMetadata> => {
		return bridgeNewsletterMetadataToBaileys(await (await ctx.getClient()).newsletterSubscribe(jid))
	},

	newsletterUnsubscribe: async (jid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterUnsubscribe(jid)
	},

	/**
	 * The follower-activity mute, which is the one a subscriber toggles. The
	 * core's other newsletter mute is for admin activity and is a different
	 * control, so the ambiguous alias is avoided here.
	 */
	newsletterMute: async (jid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterFollowerMute(jid, true)
	},

	newsletterUnmute: async (jid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterFollowerMute(jid, false)
	},

	newsletterSubscribers: async (jid: string): Promise<{ subscribers: number }> => {
		const metadata = await (await ctx.getClient()).newsletterMetadata(jid)
		return { subscribers: metadata.subscriberCount }
	},

	newsletterReactMessage: async (jid: string, serverId: string, reaction?: string): Promise<void> => {
		await (await ctx.getClient()).newsletterReactMessage(jid, serverId, reaction ?? null)
	},

	/**
	 * `since` and `after` have no equivalent: the core's query pages backward
	 * from a `before` cursor and carries no time filter. Mapping `after` onto
	 * `before` would page the opposite direction and return a plausible wrong
	 * answer, so a caller asking for either is told instead.
	 *
	 * Zero is not asking. `since: 0` is the epoch and `after: 0` is no cursor,
	 * which is what the unfiltered query already does, so the common
	 * `(jid, count, 0, 0)` call runs rather than being refused for nothing.
	 */
	newsletterFetchMessages: async (jid: string, count: number, since?: number, after?: number) => {
		if (since) {
			throw new Boom('newsletterFetchMessages: `since` is not supported, the message query carries no time filter', {
				statusCode: 400
			})
		}
		if (after) {
			throw new Boom(
				'newsletterFetchMessages: `after` is not supported, the message query pages backward from a `before` cursor',
				{ statusCode: 400 }
			)
		}
		return await (await ctx.getClient()).newsletterMessages(jid, count, null)
	},

	subscribeNewsletterUpdates: async (jid: string): Promise<{ duration: string }> => {
		const duration = await (await ctx.getClient()).newsletterSubscribeLiveUpdates(jid)
		return { duration: String(duration) }
	},

	/**
	 * The count rides on the admin-info result and the server omits it for an
	 * account that may not see it. Absent is reported as absent: `0` here would
	 * read as "no admins", which no newsletter can be.
	 */
	newsletterAdminCount: async (jid: string): Promise<number> => {
		const info = await (await ctx.getClient()).newsletterAdminInfo(jid)
		if (info.adminCount === undefined) {
			throw new Boom('newsletterAdminCount: the server did not return an admin count for this newsletter', {
				statusCode: 404
			})
		}
		return info.adminCount
	},

	newsletterChangeOwner: async (jid: string, newOwnerJid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterChangeOwner(jid, newOwnerJid)
	},

	newsletterDemote: async (jid: string, userJid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterDemoteAdmin(jid, userJid)
	},

	newsletterDelete: async (jid: string): Promise<void> => {
		await (await ctx.getClient()).newsletterDelete(jid)
	}
})
