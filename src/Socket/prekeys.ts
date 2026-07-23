import { MIN_PREKEY_COUNT } from '../Defaults/index.ts'
import type { SocketContext } from './types.ts'

type PreKeyContext = Pick<SocketContext, 'getClient' | 'logger'>

export const makePreKeyMethods = (ctx: PreKeyContext) => ({
	uploadPreKeys: async (count = MIN_PREKEY_COUNT): Promise<void> => {
		await (await ctx.getClient()).refreshPreKeys(count)
	},

	uploadPreKeysToServerIfRequired: async (): Promise<void> => {
		try {
			await (await ctx.getClient()).ensurePreKeys()
		} catch (error) {
			ctx.logger.error({ error }, 'Failed to check/upload pre-keys during initialization')
		}
	},

	digestKeyBundle: async (): Promise<void> => {
		await (await ctx.getClient()).validateKeyBundle()
	},

	rotateSignedPreKey: async (): Promise<void> => {
		await (await ctx.getClient()).rotateSignedKey()
	}
})
