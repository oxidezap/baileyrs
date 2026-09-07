import { makeWithClient } from './client-operations.ts'
import { bridgeBlocklistToBaileys } from '../Compatibility/socket-results.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type { CompatibleSocketContext as SocketContext } from './types.ts'

export const BLOCK_ACTIONS = ['block', 'unblock'] as const

export type BlockAction = (typeof BLOCK_ACTIONS)[number]

export const makeBlockingMethods = (ctx: SocketContext) => {
	const withClient = makeWithClient(ctx)
	return {
		updateBlockStatus: async (jid: string, action: BlockAction) => {
			assertArgumentDomain('updateBlockStatus', 'action', action, BLOCK_ACTIONS)
			await withClient(client => client.updateBlockStatus(jid, action))
		},

		fetchBlocklist: async (): Promise<Array<string | undefined>> => {
			return bridgeBlocklistToBaileys(await withClient(client => client.fetchBlocklist()))
		}
	}
}
