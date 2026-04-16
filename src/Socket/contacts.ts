import type { SocketContext } from './types'

export const makeContactMethods = (ctx: SocketContext) => ({
	onWhatsApp: async (...jids: string[]) => {
		const client = await ctx.getClient()
		const results: { exists: boolean; jid: string }[] = []
		for (const jid of jids) {
			const r = await client.isOnWhatsApp(jid)
			for (const entry of r) {
				results.push({ exists: entry.isRegistered, jid: entry.jid })
			}
		}

		return results
	},

	profilePictureUrl: async (jid: string, type: 'preview' | 'image' = 'preview') => {
		const result = await (await ctx.getClient()).profilePictureUrl(jid, type)
		return result?.url
	},

	fetchUserInfo: async (...jids: string[]) => {
		return await (await ctx.getClient()).fetchUserInfo(jids)
	}
})
