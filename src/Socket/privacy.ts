import type {
	WAPrivacyCallValue,
	WAPrivacyGroupAddValue,
	WAPrivacyMessagesValue,
	WAPrivacyOnlineValue,
	WAPrivacyValue,
	WAReadReceiptsValue
} from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
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
	},

	updateCallPrivacy: async (value: WAPrivacyCallValue) => {
		await (await ctx.getClient()).updatePrivacySetting('calladd', value)
	},

	updateMessagesPrivacy: async (value: WAPrivacyMessagesValue) => {
		await (await ctx.getClient()).updatePrivacySetting('messages', value)
	},

	/**
	 * Declared to reject rather than to run: the core issues these tokens on
	 * every 1:1 send, rate limited by a sender bucket. A manual call would
	 * issue a second token outside that bucket and move the timestamp the
	 * limiter reads.
	 */
	issuePrivacyTokens: async (_jids: string[], _timestamp?: number): Promise<never> => {
		throw new Boom(
			'issuePrivacyTokens is not supported: the engine issues privacy tokens automatically on every 1:1 send, and a manual call would bypass its rate limiter. Remove the call.',
			{ statusCode: 501 }
		)
	}
})
