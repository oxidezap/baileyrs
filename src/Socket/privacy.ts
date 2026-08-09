import {
	WA_PRIVACY_CALL_VALUES,
	WA_PRIVACY_GROUP_ADD_VALUES,
	WA_PRIVACY_MESSAGES_VALUES,
	WA_PRIVACY_ONLINE_VALUES,
	WA_PRIVACY_VALUES,
	WA_READ_RECEIPTS_VALUES,
	type WAPrivacyCallValue,
	type WAPrivacyGroupAddValue,
	type WAPrivacyMessagesValue,
	type WAPrivacyOnlineValue,
	type WAPrivacyValue,
	type WAReadReceiptsValue
} from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type { SocketContext } from './types.ts'

export const makePrivacyMethods = (ctx: SocketContext) => {
	/** Per socket, so a send loop calling this does not flood the log. */
	let warnedAboutPrivacyTokens = false

	return {
		fetchPrivacySettings: async (force?: boolean) => {
			void force
			return (await ctx.getClient()).fetchPrivacySettings()
		},

		/**
		 * The untyped escape hatch, left open on purpose: the bridge takes both
		 * halves as plain strings and the core's wire enums carry a fallback, so
		 * this is the way to reach a category or value the wrappers below do not
		 * name yet. The wrappers are the checked path.
		 */
		updatePrivacySetting: async (category: string, value: string) => {
			await (await ctx.getClient()).updatePrivacySetting(category, value)
		},

		updateLastSeenPrivacy: async (value: WAPrivacyValue) => {
			assertArgumentDomain('updateLastSeenPrivacy', 'value', value, WA_PRIVACY_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('last', value)
		},

		updateOnlinePrivacy: async (value: WAPrivacyOnlineValue) => {
			assertArgumentDomain('updateOnlinePrivacy', 'value', value, WA_PRIVACY_ONLINE_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('online', value)
		},

		updateProfilePicturePrivacy: async (value: WAPrivacyValue) => {
			assertArgumentDomain('updateProfilePicturePrivacy', 'value', value, WA_PRIVACY_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('profile', value)
		},

		updateStatusPrivacy: async (value: WAPrivacyValue) => {
			assertArgumentDomain('updateStatusPrivacy', 'value', value, WA_PRIVACY_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('status', value)
		},

		updateReadReceiptsPrivacy: async (value: WAReadReceiptsValue) => {
			assertArgumentDomain('updateReadReceiptsPrivacy', 'value', value, WA_READ_RECEIPTS_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('readreceipts', value)
		},

		updateGroupsAddPrivacy: async (value: WAPrivacyGroupAddValue) => {
			assertArgumentDomain('updateGroupsAddPrivacy', 'value', value, WA_PRIVACY_GROUP_ADD_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('groupadd', value)
		},

		updateCallPrivacy: async (value: WAPrivacyCallValue) => {
			assertArgumentDomain('updateCallPrivacy', 'value', value, WA_PRIVACY_CALL_VALUES)
			await (await ctx.getClient()).updatePrivacySetting('calladd', value)
		},

		updateMessagesPrivacy: async (value: WAPrivacyMessagesValue) => {
			assertArgumentDomain('updateMessagesPrivacy', 'value', value, WA_PRIVACY_MESSAGES_VALUES)
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
