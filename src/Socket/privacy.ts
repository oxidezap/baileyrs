import type {
	WAPrivacyGroupAddValue,
	WAPrivacyOnlineValue,
	WAPrivacyValue,
	WAReadReceiptsValue
} from '../Types/index.ts'
import type { SocketContext } from './types.ts'

export const makePrivacyMethods = (ctx: SocketContext) => ({
	fetchPrivacySettings: async (force?: boolean) => {
		void force
		return (await ctx.getClient()).fetchPrivacySettings()
	},

	updatePrivacySetting: async (category: string, value: string) => {
		await (await ctx.getClient()).updatePrivacySetting(category, value)
	},

	updateLastSeenPrivacy: async (value: WAPrivacyValue) => {
		await (await ctx.getClient()).updatePrivacySetting('last', value)
	},

	updateOnlinePrivacy: async (value: WAPrivacyOnlineValue) => {
		await (await ctx.getClient()).updatePrivacySetting('online', value)
	},

	updateProfilePicturePrivacy: async (value: WAPrivacyValue) => {
		await (await ctx.getClient()).updatePrivacySetting('profile', value)
	},

	updateStatusPrivacy: async (value: WAPrivacyValue) => {
		await (await ctx.getClient()).updatePrivacySetting('status', value)
	},

	updateReadReceiptsPrivacy: async (value: WAReadReceiptsValue) => {
		await (await ctx.getClient()).updatePrivacySetting('readreceipts', value)
	},

	updateGroupsAddPrivacy: async (value: WAPrivacyGroupAddValue) => {
		await (await ctx.getClient()).updatePrivacySetting('groupadd', value)
	}
})
