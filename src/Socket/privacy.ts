import type {
	WAPrivacyCallValue,
	WAPrivacyGroupAddValue,
	WAPrivacyMessagesValue,
	WAPrivacyOnlineValue,
	WAPrivacyValue,
	WAReadReceiptsValue
} from '../Types/index.ts'
import type { SocketContext } from './types.ts'

export const makePrivacyMethods = (ctx: SocketContext) => {
	/** Per socket, so a send loop calling this does not flood the log. */
	let warnedAboutPrivacyTokens = false

	return {
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
		 * Resolves without issuing anything. The engine already issues these
		 * tokens on every 1:1 send, rate limited by a sender bucket, so the
		 * caller's intent is met before they ask; a second manual issue would land
		 * outside that bucket and move the timestamp the limiter reads.
		 *
		 * Warned once rather than thrown: upstream callers await this inside a send
		 * workflow, and rejecting would abort a workflow that was going to succeed.
		 */
		issuePrivacyTokens: async (jids: string[], timestamp?: number): Promise<void> => {
			void timestamp
			if (!warnedAboutPrivacyTokens) {
				warnedAboutPrivacyTokens = true
				ctx.logger.warn(
					{ count: jids.length },
					'issuePrivacyTokens is a no-op: the engine issues privacy tokens on every 1:1 send, so this call can be removed'
				)
			}
		}
	}
}
