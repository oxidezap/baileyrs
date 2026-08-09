import { bridgeGroupMetadataToBaileys } from '../Compatibility/group-metadata.ts'
import { bridgeParticipantChangesToBaileys } from '../Compatibility/socket-results.ts'
import { PARTICIPANT_ACTIONS, type GroupMetadata, type ParticipantAction } from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import { makeGroupMethods } from './groups.ts'
import type { SocketContext } from './types.ts'

type LinkedGroup = {
	id: string | undefined
	subject: string
	creation: number | undefined
	owner: string | undefined
	size: number | undefined
}

export const makeCommunityMethods = (ctx: SocketContext, groups = makeGroupMethods(ctx)) => {
	const communityMetadata = async (jid: string): Promise<GroupMetadata> => groups.groupMetadata(jid)

	const communityFetchAllParticipating = async (): Promise<Record<string, GroupMetadata>> => {
		const bridgeCommunities = await (await ctx.getClient()).communityFetchAllParticipating()
		const result: Record<string, GroupMetadata> = {}
		for (const [communityJid, metadata] of Object.entries(bridgeCommunities)) {
			result[communityJid] = bridgeGroupMetadataToBaileys(metadata)
		}

		ctx.ev.emit('groups.update', Object.values(result))
		return result
	}

	return {
		communityMetadata,

		communityCreate: async (subject: string, body: string): Promise<GroupMetadata | null> => {
			const metadata = await (await ctx.getClient()).createCommunity(subject, body || undefined, true, true, true)
			return bridgeGroupMetadataToBaileys(metadata)
		},

		communityCreateGroup: async (
			subject: string,
			participants: string[],
			parentCommunityJid: string
		): Promise<GroupMetadata | null> => {
			const metadata = await (await ctx.getClient()).createCommunitySubgroup(subject, participants, parentCommunityJid)
			return bridgeGroupMetadataToBaileys(metadata)
		},

		communityLeave: async (id: string): Promise<void> => {
			await (await ctx.getClient()).deactivateCommunity(id)
		},

		communityUpdateSubject: async (jid: string, subject: string): Promise<void> => {
			await groups.groupUpdateSubject(jid, subject)
		},

		communityLinkGroup: async (groupJid: string, parentCommunityJid: string): Promise<void> => {
			await (await ctx.getClient()).linkCommunitySubgroups(parentCommunityJid, [groupJid])
		},

		communityUnlinkGroup: async (groupJid: string, parentCommunityJid: string): Promise<void> => {
			await (await ctx.getClient()).unlinkCommunitySubgroups(parentCommunityJid, [groupJid], false)
		},

		communityFetchLinkedGroups: async (
			jid: string
		): Promise<{ communityJid: string; isCommunity: boolean; linkedGroups: LinkedGroup[] }> => {
			const metadata = await groups.groupMetadata(jid)
			const communityJid = metadata.linkedParent || jid
			const isCommunity = !metadata.linkedParent
			const subgroups = await (await ctx.getClient()).getCommunitySubgroups(communityJid)
			const linkedGroups: LinkedGroup[] = subgroups.map(group => ({
				id: group.id,
				subject: group.subject,
				creation: group.creation,
				owner: group.owner,
				size: group.participantCount
			}))

			return { communityJid, isCommunity, linkedGroups }
		},

		communityRequestParticipantsList: groups.groupRequestParticipantsList,
		communityRequestParticipantsUpdate: groups.groupRequestParticipantsUpdate,

		communityParticipantsUpdate: async (jid: string, participants: string[], action: ParticipantAction) => {
			assertArgumentDomain('communityParticipantsUpdate', 'action', action, PARTICIPANT_ACTIONS)
			return bridgeParticipantChangesToBaileys(
				await (await ctx.getClient()).communityParticipantsUpdate(jid, participants, action)
			)
		},

		communityUpdateDescription: groups.groupUpdateDescription,
		communityInviteCode: groups.groupInviteCode,
		communityRevokeInvite: groups.groupRevokeInvite,
		communityAcceptInvite: groups.groupAcceptInvite,
		communityRevokeInviteV4: async (communityJid: string, invitedJid: string): Promise<boolean> => {
			return groups.groupRevokeInviteV4(communityJid, invitedJid)
		},
		communityAcceptInviteV4: groups.groupAcceptInviteV4,
		communityGetInviteInfo: groups.groupGetInviteInfo,
		communityToggleEphemeral: groups.groupToggleEphemeral,
		communitySettingUpdate: groups.groupSettingUpdate,
		communityMemberAddMode: groups.groupMemberAddMode,
		communityJoinApprovalMode: groups.groupJoinApprovalMode,
		communityFetchAllParticipating
	}
}
