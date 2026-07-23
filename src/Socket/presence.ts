import type { SocketContext } from './types.ts'

export const makePresenceMethods = (ctx: SocketContext) => ({
	sendPresence: async (status: 'available' | 'unavailable') => {
		await (await ctx.getClient()).sendPresence(status)
	},

	presenceSubscribe: async (toJid: string) => {
		await (await ctx.getClient()).presenceSubscribe(toJid)
	},

	sendChatState: async (jid: string, state: 'composing' | 'recording' | 'paused') => {
		await (await ctx.getClient()).sendChatState(jid, state)
	}
})
