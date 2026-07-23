import type { SocketContext } from './types.ts'

export const makeNewsletterMethods = (ctx: SocketContext) => ({
	newsletterCreate: async (name: string, description?: string) => {
		return await (await ctx.getClient()).newsletterCreate(name, description)
	},

	newsletterMetadata: async (jid: string) => {
		return await (await ctx.getClient()).newsletterMetadata(jid)
	},

	newsletterSubscribe: async (jid: string) => {
		return await (await ctx.getClient()).newsletterSubscribe(jid)
	},

	newsletterUnsubscribe: async (jid: string) => {
		await (await ctx.getClient()).newsletterUnsubscribe(jid)
	},

	newsletterReactMessage: async (jid: string, serverId: string, reaction?: string) => {
		await (await ctx.getClient()).newsletterReactMessage(jid, serverId, reaction ?? null)
	},

	/**
	 * Mute or unmute a newsletter (channel) — silences its follower-activity
	 * notifications, the mute a subscriber toggles. `mute = true` silences.
	 */
	newsletterMute: async (jid: string, mute: boolean) => {
		await (await ctx.getClient()).newsletterMute(jid, mute)
	}
})
