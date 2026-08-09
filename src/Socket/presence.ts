import { WA_CHAT_STATES, WA_PRESENCE_STATUSES, type WAChatState, type WAPresenceStatus } from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type { SocketContext } from './types.ts'

export const makePresenceMethods = (ctx: SocketContext) => ({
	sendPresence: async (status: WAPresenceStatus) => {
		assertArgumentDomain('sendPresence', 'status', status, WA_PRESENCE_STATUSES)
		await (await ctx.getClient()).sendPresence(status)
	},

	presenceSubscribe: async (toJid: string) => {
		await (await ctx.getClient()).presenceSubscribe(toJid)
	},

	sendChatState: async (jid: string, state: WAChatState) => {
		assertArgumentDomain('sendChatState', 'state', state, WA_CHAT_STATES)
		await (await ctx.getClient()).sendChatState(jid, state)
	}
})
