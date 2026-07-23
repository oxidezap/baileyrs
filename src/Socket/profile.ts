import type { WAMediaUpload } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { generateProfilePicture } from '../Utils/messages-media.ts'
import { isJidGroup } from '../WABinary/index.ts'
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

		updateProfilePicture: async (
			jid: string,
			content: WAMediaUpload,
			dimensions?: { width: number; height: number }
		): Promise<void> => {
			if (!jid) {
				throw new Boom(
					'Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update'
				)
			}
			const { img } = await generateProfilePicture(content, dimensions)
			const client = await ctx.getClient()
			if (isJidGroup(jid)) {
				await client.setGroupProfilePicture(jid, img)
				return
			}
			await client.updateProfilePicture(img)
		},

		removeProfilePicture: async (jid: string): Promise<void> => {
			if (!jid) {
				throw new Boom(
					'Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update'
				)
			}
			const client = await ctx.getClient()
			if (isJidGroup(jid)) {
				await client.removeGroupProfilePicture(jid)
				return
			}
			await client.removeProfilePicture()
		},

		updateProfileStatus: async (status: string) => {
			await (await ctx.getClient()).updateProfileStatus(status)
		}
	}
}
