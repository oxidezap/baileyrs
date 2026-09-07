import { MIN_PREKEY_COUNT } from '../Defaults/index.ts'
import type { SocketContext } from './types.ts'

type PreKeyContext = Pick<SocketContext, 'logger' | 'withClient'>

export const makePreKeyMethods = (ctx: PreKeyContext) => {
	return {
		uploadPreKeys: async (count = MIN_PREKEY_COUNT): Promise<void> => {
			await ctx.withClient(client => client.refreshPreKeys(count))
		},

		uploadPreKeysToServerIfRequired: async (): Promise<void> => {
			try {
				await ctx.withClient(client => client.ensurePreKeys())
			} catch (error) {
				ctx.logger.error({ error }, 'Failed to check/upload pre-keys during initialization')
			}
		},

		digestKeyBundle: async (): Promise<void> => {
			await ctx.withClient(client => client.validateKeyBundle())
		},

		rotateSignedPreKey: async (): Promise<void> => {
			await ctx.withClient(client => client.rotateSignedKey())
		}
	}
}
