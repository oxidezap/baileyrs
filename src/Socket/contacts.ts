import type { SocketContext } from './types.ts'

export type OnWhatsAppResult = {
	exists: boolean
	jid: string
	lid?: string
	/** PN counterpart, present when the server returned a LID as primary JID. */
	pnJid?: string
	isBusiness?: boolean
}

export const makeContactMethods = (ctx: SocketContext) => ({
	onWhatsApp: async (...jids: string[]): Promise<OnWhatsAppResult[]> => {
		const client = await ctx.getClient()
		// Single batched usync — the bridge splits PN/LID inputs internally and
		// returns lid/pnJid/isBusiness in the same payload, so no secondary IQ.
		const results = await client.isOnWhatsApp(jids)
		return results.map(r => {
			const out: OnWhatsAppResult = { exists: r.isRegistered, jid: r.jid, isBusiness: r.isBusiness }
			if (r.lid) out.lid = r.lid
			if (r.pnJid) out.pnJid = r.pnJid
			return out
		})
	},

	profilePictureUrl: async (jid: string, type: 'preview' | 'image' = 'preview') => {
		const result = await (await ctx.getClient()).profilePictureUrl(jid, type)
		return result?.url
	},

	fetchUserInfo: async (...jids: string[]) => {
		return await (await ctx.getClient()).fetchUserInfo(jids)
	}
})
