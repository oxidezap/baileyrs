import type { GroupMetadataResult } from 'whatsapp-rust-bridge'
import type { GroupMetadata } from '../Types/index.ts'
import type { SocketContext } from './types.ts'

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

	groupCreate: async (subject: string, participants: string[]) => {
		return await (await ctx.getClient()).createGroup(subject, participants)
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

	groupSettingUpdate: async (
		jid: string,
		setting:
			| 'locked'
			| 'announce'
			| 'membership_approval'
			| 'announcement'
			| 'not_announcement'
			| 'unlocked'
			| 'on'
			| 'off',
		value?: boolean
	) => {
		// Map upstream-Baileys legacy single-arg verbs onto the bridge's
		// (setting, boolean) contract. Keeps `conn.groupSettingUpdate(jid, 'announcement')`
		// working without forcing call-site migration.
		let resolvedSetting: 'locked' | 'announce' | 'membership_approval'
		let resolvedValue: boolean
		switch (setting) {
			case 'announcement':
				resolvedSetting = 'announce'
				resolvedValue = true
				break
			case 'not_announcement':
				resolvedSetting = 'announce'
				resolvedValue = false
				break
			case 'unlocked':
				resolvedSetting = 'locked'
				resolvedValue = false
				break
			case 'on':
				resolvedSetting = 'locked'
				resolvedValue = true
				break
			case 'off':
				resolvedSetting = 'locked'
				resolvedValue = false
				break
			default:
				resolvedSetting = setting
				resolvedValue = value ?? false
		}

		await (await ctx.getClient()).groupSettingUpdate(jid, resolvedSetting, resolvedValue)
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
