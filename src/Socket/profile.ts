import type { SocketContext } from './types'

export const makeProfileMethods = (ctx: SocketContext) => {
	const setPushName = async (name: string) => {
		await (await ctx.getClient()).setPushName(name)
	}

	return {
		requestPairingCode: async (phoneNumber: string, customPairingCode?: string): Promise<string> => {
			return await (await ctx.getClient()).requestPairingCode(phoneNumber, customPairingCode)
		},

		setPushName,

		/** Alias for setPushName (upstream Baileys compat) */
		updateProfileName: setPushName,

		getPushName: async () => {
			return await (await ctx.getClient()).getPushName()
		},

		getJid: async () => {
			return await (await ctx.getClient()).getJid()
		},

		getLid: async () => {
			return await (await ctx.getClient()).getLid()
		},

		updateProfilePicture: async (jid: string, imgData: Uint8Array) => {
			const selfJid = ctx.getUser()?.id
			if (selfJid && jid !== selfJid) {
				ctx.logger.warn(
					{ jid, selfJid },
					'updateProfilePicture: bridge only supports updating own picture, ignoring target jid'
				)
			}

			return await (await ctx.getClient()).updateProfilePicture(imgData)
		},

		removeProfilePicture: async () => {
			return await (await ctx.getClient()).removeProfilePicture()
		},

		updateProfileStatus: async (status: string) => {
			await (await ctx.getClient()).updateProfileStatus(status)
		}
	}
}
