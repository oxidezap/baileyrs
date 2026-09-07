import { makeWithClient } from './client-operations.ts'
import { bridgeGroupMetadataToBaileys } from '../Compatibility/group-metadata.ts'
import { bridgeParticipantChangesToBaileys } from '../Compatibility/socket-results.ts'
import { PARTICIPANT_ACTIONS, type GroupMetadata, type ParticipantAction } from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import {
	GROUP_REQUEST_ACTIONS,
	GROUP_SETTINGS,
	JOIN_APPROVAL_MODES,
	makeGroupMethods,
	MEMBER_ADD_MODES,
	type GroupRequestAction,
	type GroupSetting,
	type JoinApprovalMode,
	type MemberAddMode
} from './groups.ts'
import type { CompatibleSocketContext as SocketContext } from './types.ts'

type LinkedGroup = {
	id: string | undefined
	subject: string
	creation: number | undefined
	owner: string | undefined
	size: number | undefined
}

export const makeCommunityMethods = (ctx: SocketContext, groups = makeGroupMethods(ctx)) => {
	const withClient = makeWithClient(ctx)

	const communityMetadata = async (jid: string): Promise<GroupMetadata> => groups.groupMetadata(jid)

	const communityFetchAllParticipating = async (): Promise<Record<string, GroupMetadata>> => {
		const bridgeCommunities = await withClient(client => client.communityFetchAllParticipating())
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
			const metadata = await withClient(client => client.createCommunity(subject, body || undefined, true, true, true))
			return bridgeGroupMetadataToBaileys(metadata)
		},

		communityCreateGroup: async (
			subject: string,
			participants: string[],
			parentCommunityJid: string
		): Promise<GroupMetadata | null> => {
			const metadata = await withClient(client =>
				client.createCommunitySubgroup(subject, participants, parentCommunityJid)
			)
			return bridgeGroupMetadataToBaileys(metadata)
		},

		communityLeave: async (id: string): Promise<void> => {
			await withClient(client => client.deactivateCommunity(id))
		},

		communityUpdateSubject: async (jid: string, subject: string): Promise<void> => {
			await groups.groupUpdateSubject(jid, subject)
		},

		communityLinkGroup: async (groupJid: string, parentCommunityJid: string): Promise<void> => {
			await withClient(client => client.linkCommunitySubgroups(parentCommunityJid, [groupJid]))
		},

		communityUnlinkGroup: async (groupJid: string, parentCommunityJid: string): Promise<void> => {
			await withClient(client => client.unlinkCommunitySubgroups(parentCommunityJid, [groupJid], false))
		},

		communityFetchLinkedGroups: async (
			jid: string
		): Promise<{ communityJid: string; isCommunity: boolean; linkedGroups: LinkedGroup[] }> => {
			const metadata = await groups.groupMetadata(jid)
			const communityJid = metadata.linkedParent || jid
			const isCommunity = !metadata.linkedParent
			const subgroups = await withClient(client => client.getCommunitySubgroups(communityJid))
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

		/**
		 * The community methods that are the group operation check under their own
		 * name before delegating: a refusal has to name the method that was called.
		 */
		communityRequestParticipantsUpdate: async (jid: string, participants: string[], action: GroupRequestAction) => {
			assertArgumentDomain('communityRequestParticipantsUpdate', 'action', action, GROUP_REQUEST_ACTIONS)
			return groups.groupRequestParticipantsUpdate(jid, participants, action)
		},

		communityParticipantsUpdate: async (jid: string, participants: string[], action: ParticipantAction) => {
			assertArgumentDomain('communityParticipantsUpdate', 'action', action, PARTICIPANT_ACTIONS)
			return bridgeParticipantChangesToBaileys(
				await withClient(client => client.communityParticipantsUpdate(jid, participants, action))
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
		communitySettingUpdate: async (jid: string, setting: GroupSetting): Promise<void> => {
			assertArgumentDomain('communitySettingUpdate', 'setting', setting, GROUP_SETTINGS)
			return groups.groupSettingUpdate(jid, setting)
		},
		communityMemberAddMode: async (jid: string, mode: MemberAddMode): Promise<void> => {
			assertArgumentDomain('communityMemberAddMode', 'mode', mode, MEMBER_ADD_MODES)
			return groups.groupMemberAddMode(jid, mode)
		},
		communityJoinApprovalMode: async (jid: string, mode: JoinApprovalMode): Promise<void> => {
			assertArgumentDomain('communityJoinApprovalMode', 'mode', mode, JOIN_APPROVAL_MODES)
			return groups.groupJoinApprovalMode(jid, mode)
		},
		communityFetchAllParticipating
	}
}
