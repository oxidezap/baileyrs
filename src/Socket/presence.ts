import { makeWithClient } from './client-operations.ts'
import { WA_CHAT_STATES, WA_PRESENCE_STATUSES, type WAChatState, type WAPresenceStatus } from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type { CompatibleSocketContext as SocketContext } from './types.ts'

export const makePresenceMethods = (ctx: SocketContext) => {
	const withClient = makeWithClient(ctx)
	return {
		sendPresence: async (status: WAPresenceStatus) => {
			assertArgumentDomain('sendPresence', 'status', status, WA_PRESENCE_STATUSES)
			await withClient(client => client.sendPresence(status))
		},

		presenceSubscribe: async (toJid: string) => {
			await withClient(client => client.presenceSubscribe(toJid))
		},

		sendChatState: async (jid: string, state: WAChatState) => {
			assertArgumentDomain('sendChatState', 'state', state, WA_CHAT_STATES)
			await withClient(client => client.sendChatState(jid, state))
		}
	}
}
