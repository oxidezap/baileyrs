import type { GroupMetadataResult } from 'whatsapp-rust-bridge'
import type { GroupMetadata } from '../Types/index.ts'
import type { SocketContext } from './types.ts'

/**
 * Verbs accepted by upstream Baileys' single-arg `groupSettingUpdate(jid, verb)`:
 * `'announcement' | 'not_announcement' | 'locked' | 'unlocked'`. Native
 * settings (`'announce' | 'membership_approval'`) flow through the
 * two-arg form with an explicit boolean value.
 */
type GroupSettingArg = 'announce' | 'membership_approval' | 'locked' | 'unlocked' | 'announcement' | 'not_announcement'
type GroupSettingResolved = { setting: 'locked' | 'announce' | 'membership_approval'; value: boolean }
const GROUP_SETTING_ALIASES: Partial<Record<GroupSettingArg, GroupSettingResolved>> = {
	announcement: { setting: 'announce', value: true },
	not_announcement: { setting: 'announce', value: false },
	locked: { setting: 'locked', value: true },
	unlocked: { setting: 'locked', value: false }
}

/** Convert bridge GroupMetadataResult to Baileys GroupMetadata */
function bridgeGroupToMetadata(g: GroupMetadataResult): GroupMetadata {
	return {
		id: g.id,
		subject: g.subject,
		addressingMode: g.addressingMode as GroupMetadata['addressingMode'],
		owner: g.creator,
		creation: g.creationTime,
		desc: g.description,
		descId: g.descriptionId,
		restrict: g.isLocked,
		announce: g.isAnnouncement,
		memberAddMode: g.memberAddMode === 'all_member_add',
		joinApprovalMode: g.membershipApproval,
		isCommunity: g.isParentGroup,
		linkedParent: g.parentGroupJid,
		size: g.size,
		// Bridge doesn't distinguish superadmin from admin
		participants: g.participants.map(p => ({
			id: p.jid,
			isAdmin: p.isAdmin,
			admin: p.isAdmin ? ('admin' as const) : null
		})),
		ephemeralDuration: g.ephemeralExpiration,
		subjectOwner: g.subjectOwner,
		subjectTime: g.subjectTime
	}
}

export const makeGroupMethods = (ctx: SocketContext) => ({
	groupMetadata: async (jid: string): Promise<GroupMetadata> => {
		const g = await (await ctx.getClient()).getGroupMetadata(jid)
		return bridgeGroupToMetadata(g)
	},

	groupCreate: async (subject: string, participants: string[]): Promise<GroupMetadata> => {
		// Bridge's `createGroup` parses the full `<group>` node from the
		// server's create response and returns the same `GroupMetadataResult`
		// shape as `getGroupMetadata` — single round-trip, matches upstream
		// Baileys' `extractGroupMetadata(result)` flow.
		const metadata = await (await ctx.getClient()).createGroup(subject, participants)
		return bridgeGroupToMetadata(metadata)
	},

	groupLeave: async (jid: string) => {
		await (await ctx.getClient()).groupLeave(jid)
	},

	groupUpdateSubject: async (jid: string, subject: string) => {
		await (await ctx.getClient()).groupUpdateSubject(jid, subject)
	},

	groupUpdateDescription: async (jid: string, description?: string) => {
		await (await ctx.getClient()).groupUpdateDescription(jid, description)
	},

	groupParticipantsUpdate: async (
		jid: string,
		participants: string[],
		action: 'add' | 'remove' | 'promote' | 'demote'
	) => {
		return await (await ctx.getClient()).groupParticipantsUpdate(jid, participants, action)
	},

	groupFetchAllParticipating: async (): Promise<Record<string, GroupMetadata>> => {
		const bridgeGroups = await (await ctx.getClient()).groupFetchAllParticipating()
		const result: Record<string, GroupMetadata> = {}
		for (const [groupJid, g] of Object.entries(bridgeGroups)) {
			result[groupJid] = bridgeGroupToMetadata(g)
		}

		return result
	},

	groupInviteCode: async (jid: string): Promise<string> => {
		return await (await ctx.getClient()).groupInviteCode(jid)
	},

	groupRevokeInvite: async (jid: string): Promise<string> => {
		return await (await ctx.getClient()).groupRevokeInvite(jid)
	},

	groupSettingUpdate: async (jid: string, setting: GroupSettingArg, value?: boolean) => {
		// Map upstream-Baileys legacy single-arg verbs onto the bridge's
		// (setting, boolean) contract via GROUP_SETTING_ALIASES. Native
		// settings ('locked' / 'announce' / 'membership_approval') require
		// an explicit `value` — silently defaulting to `false` masks a
		// caller bug as a successful "turn off" call.
		const alias = GROUP_SETTING_ALIASES[setting]
		if (alias) {
			await (await ctx.getClient()).groupSettingUpdate(jid, alias.setting, alias.value)
			return
		}
		if (value === undefined) {
			throw new TypeError(`groupSettingUpdate: setting "${setting}" requires an explicit boolean value`)
		}
		await (await ctx.getClient()).groupSettingUpdate(jid, setting as GroupSettingResolved['setting'], value)
	},

	groupToggleEphemeral: async (jid: string, expiration: number) => {
		await (await ctx.getClient()).groupToggleEphemeral(jid, expiration)
	},

	groupAcceptInvite: async (code: string): Promise<string | undefined> => {
		return await (await ctx.getClient()).groupAcceptInvite(code)
	},

	/** Join a group via a GroupInviteMessage (V4 invite). */
	groupAcceptInviteV4: async (
		key: { remoteJid?: string | null },
		msg: { inviteCode?: string | null; inviteExpiration?: number | null; groupJid?: string | null }
	): Promise<string | undefined> => {
		if (!msg.inviteCode || !msg.groupJid) return undefined
		const adminJid = key.remoteJid || ''
		return await (
			await ctx.getClient()
		).groupAcceptInviteV4(msg.groupJid, msg.inviteCode, msg.inviteExpiration || 0, adminJid)
	},

	groupGetInviteInfo: async (code: string): Promise<GroupMetadata> => {
		const g = await (await ctx.getClient()).groupGetInviteInfo(code)
		return bridgeGroupToMetadata(g)
	},

	groupRequestParticipantsList: async (jid: string) => {
		return await (await ctx.getClient()).groupRequestParticipantsList(jid)
	},

	groupRequestParticipantsUpdate: async (jid: string, participants: string[], action: 'approve' | 'reject') => {
		return await (await ctx.getClient()).groupRequestParticipantsUpdate(jid, participants, action)
	},

	/**
	 * Set or clear the bot's per-group "member label" — the small tag rendered
	 * under the bot's display name inside that group's UI. Empty `label`
	 * clears it. Sent as a `ProtocolMessage` over the regular message path
	 * (matching WA Web's wire format), not as an IQ.
	 *
	 * Self-applied only — WhatsApp's protocol does not let admins change
	 * other members' labels even with admin privileges; the same restriction
	 * applies in the official mobile app.
	 */
	updateMemberLabel: async (jid: string, label: string): Promise<void> => {
		await (await ctx.getClient()).updateMemberLabel(jid, label)
	}
})
