import { bridgeBlocklistToBaileys } from '../Compatibility/socket-results.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type { SocketContext } from './types.ts'

export const BLOCK_ACTIONS = ['block', 'unblock'] as const

export type BlockAction = (typeof BLOCK_ACTIONS)[number]

export const makeBlockingMethods = (ctx: SocketContext) => ({
	updateBlockStatus: async (jid: string, action: BlockAction) => {
		assertArgumentDomain('updateBlockStatus', 'action', action, BLOCK_ACTIONS)
		await (await ctx.getClient()).updateBlockStatus(jid, action)
	},

	fetchBlocklist: async (): Promise<Array<string | undefined>> => {
		return bridgeBlocklistToBaileys(await (await ctx.getClient()).fetchBlocklist())
	}
})
