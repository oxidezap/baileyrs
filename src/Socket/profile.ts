import { isJidGroup, jidNormalizedUser } from '../WABinary/index.ts'
import type { SocketContext } from './types.ts'

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

		/**
		 * Update a profile picture. When `jid` is a group jid the bridge routes
		 * to the group set-picture IQ (admin only); otherwise the IQ targets
		 * the logged-in user's own profile (the `jid` argument is informational
		 * — own-profile updates can't be set on someone else's behalf).
		 */
		updateProfilePicture: async (jid: string, imgData: Uint8Array) => {
			const client = await ctx.getClient()
			if (isJidGroup(jid)) {
				return client.setGroupProfilePicture(jid, imgData)
			}

			const selfJid = ctx.getUser()?.id
			if (selfJid && jidNormalizedUser(jid) !== jidNormalizedUser(selfJid)) {
				ctx.logger.warn(
					{ jid, selfJid },
					'updateProfilePicture: only own profile or group avatars can be changed; falling back to self'
				)
			}

			return client.updateProfilePicture(imgData)
		},

		removeProfilePicture: async (jid?: string) => {
			const client = await ctx.getClient()
			if (jid && isJidGroup(jid)) {
				return client.removeGroupProfilePicture(jid)
			}

			return client.removeProfilePicture()
		},

		updateProfileStatus: async (status: string) => {
			await (await ctx.getClient()).updateProfileStatus(status)
		}
	}
}
