import type { SocketContext } from './types'

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
	}
})
