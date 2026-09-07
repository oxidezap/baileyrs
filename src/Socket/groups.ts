import {
	bridgeInviteLinkToCode,
	bridgeMembershipRequestsToBaileys,
	bridgeMembershipRequestUpdatesToBaileys,
	bridgeParticipantChangesToBaileys
} from '../Compatibility/socket-results.ts'
import { emitMessageUpsert } from '../Compatibility/message-upsert.ts'
import {
	PARTICIPANT_ACTIONS,
	WAMessageStubType,
	type GroupMetadata,
	type ParticipantAction,
	type WAMessageKey
} from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import { generateMessageIDV2, toNumber, unixTimestampSeconds } from '../Utils/generics.ts'
import { proto } from '../WAProto/runtime.ts'
import { bridgeGroupMetadataToBaileys } from '../Compatibility/group-metadata.ts'
import type { SocketContext } from './types.ts'

const GROUP_SETTING_ALIASES = {
	announcement: { setting: 'announce', value: true },
	not_announcement: { setting: 'announce', value: false },
	locked: { setting: 'locked', value: true },
	unlocked: { setting: 'locked', value: false }
} as const satisfies Record<string, { setting: 'locked' | 'announce'; value: boolean }>

/** The table is the definition: both the type and the accepted set come off it. */
export type GroupSetting = keyof typeof GROUP_SETTING_ALIASES

export const GROUP_SETTINGS: readonly GroupSetting[] = Object.keys(GROUP_SETTING_ALIASES) as GroupSetting[]

export const GROUP_REQUEST_ACTIONS = ['approve', 'reject'] as const

export type GroupRequestAction = (typeof GROUP_REQUEST_ACTIONS)[number]

export const MEMBER_ADD_MODES = ['admin_add', 'all_member_add'] as const

export type MemberAddMode = (typeof MEMBER_ADD_MODES)[number]

export const JOIN_APPROVAL_MODES = ['on', 'off'] as const

export type JoinApprovalMode = (typeof JOIN_APPROVAL_MODES)[number]

// `toNumber` rather than calling `.toNumber()`: a 64-bit field now crosses the
// bridge as a plain `{ low, high, unsigned }` once the value is too wide to be
// exact as a double, and that shape carries no methods. The helper reads both
// forms, and reconstructs the high word instead of dropping it.
const inviteExpirationNumber = (value: proto.Message.IGroupInviteMessage['inviteExpiration']): number => toNumber(value)

export const makeGroupMethods = (ctx: SocketContext) => {
	const groupMetadata = async (jid: string): Promise<GroupMetadata> => {
		const metadata = await (await ctx.getClient()).getGroupMetadata(jid)
		return bridgeGroupMetadataToBaileys(metadata)
	}

	const groupSettingUpdate = async (jid: string, setting: GroupSetting): Promise<void> => {
		const checked = assertArgumentDomain('groupSettingUpdate', 'setting', setting, GROUP_SETTINGS)
		const mapped = GROUP_SETTING_ALIASES[checked]
		await (await ctx.getClient()).groupSettingUpdate(jid, mapped.setting, mapped.value)
	}

	const groupAcceptInviteV4 = ctx.ev.createBufferedFunction(
		async (
			key: string | WAMessageKey,
			inviteMessage: proto.Message.IGroupInviteMessage
			// oxlint-disable-next-line typescript/no-explicit-any -- the established public contract returns Promise<any>.
		): Promise<any> => {
			const messageKey = typeof key === 'string' ? { remoteJid: key } : key
			const groupJid = inviteMessage.groupJid
			if (!groupJid || !inviteMessage.inviteCode || !messageKey.remoteJid) {
				throw new TypeError('groupAcceptInviteV4 requires groupJid, inviteCode and inviter JID')
			}

			const joinedJid: string = await (
				await ctx.getClient()
			).groupAcceptInviteV4(
				groupJid,
				inviteMessage.inviteCode,
				inviteExpirationNumber(inviteMessage.inviteExpiration),
				messageKey.remoteJid
			)

			if (messageKey.id) {
				const expiredInvite = proto.Message.GroupInviteMessage.fromObject(inviteMessage)
				expiredInvite.inviteExpiration = 0
				expiredInvite.inviteCode = ''
				ctx.ev.emit('messages.update', [
					{
						key: messageKey,
						update: { message: { groupInviteMessage: expiredInvite } }
					}
				])
			}

			emitMessageUpsert(
				ctx,
				[
					{
						key: {
							remoteJid: inviteMessage.groupJid,
							id: generateMessageIDV2(ctx.getUser()?.id),
							fromMe: false,
							participant: messageKey.remoteJid
						},
						messageStubType: WAMessageStubType.GROUP_PARTICIPANT_ADD,
						messageStubParameters: [JSON.stringify(ctx.getMe())!],
						participant: messageKey.remoteJid,
						messageTimestamp: unixTimestampSeconds()
					}
				],
				{ type: 'notify' }
			)

			return joinedJid
		}
	)

	return {
		groupMetadata,

		groupCreate: async (subject: string, participants: string[]): Promise<GroupMetadata> => {
			const metadata = await (await ctx.getClient()).createGroup(subject, participants)
			return bridgeGroupMetadataToBaileys(metadata)
		},

		groupLeave: async (id: string): Promise<void> => {
			await (await ctx.getClient()).groupLeave(id)
		},

		groupUpdateSubject: async (jid: string, subject: string): Promise<void> => {
			await (await ctx.getClient()).groupUpdateSubject(jid, subject)
		},

		groupRequestParticipantsList: async (jid: string): Promise<Array<Record<string, string>>> => {
			return bridgeMembershipRequestsToBaileys(await (await ctx.getClient()).groupRequestParticipantsList(jid))
		},

		groupRequestParticipantsUpdate: async (jid: string, participants: string[], action: GroupRequestAction) => {
			assertArgumentDomain('groupRequestParticipantsUpdate', 'action', action, GROUP_REQUEST_ACTIONS)
			return bridgeMembershipRequestUpdatesToBaileys(
				await (await ctx.getClient()).groupRequestParticipantsUpdate(jid, participants, action)
			)
		},

		groupParticipantsUpdate: async (jid: string, participants: string[], action: ParticipantAction) => {
			assertArgumentDomain('groupParticipantsUpdate', 'action', action, PARTICIPANT_ACTIONS)
			return bridgeParticipantChangesToBaileys(
				await (await ctx.getClient()).groupParticipantsUpdate(jid, participants, action)
			)
		},

		groupUpdateDescription: async (jid: string, description?: string): Promise<void> => {
			await (await ctx.getClient()).groupUpdateDescription(jid, description)
		},

		groupInviteCode: async (jid: string): Promise<string | undefined> => {
			return bridgeInviteLinkToCode(await (await ctx.getClient()).groupInviteCode(jid))
		},

		groupRevokeInvite: async (jid: string): Promise<string | undefined> => {
			return bridgeInviteLinkToCode(await (await ctx.getClient()).groupRevokeInvite(jid))
		},

		groupAcceptInvite: async (code: string): Promise<string | undefined> => {
			return (await ctx.getClient()).groupAcceptInvite(code)
		},

		groupRevokeInviteV4: async (groupJid: string, invitedJid: string): Promise<boolean> => {
			return (await ctx.getClient()).groupRevokeInviteV4(groupJid, invitedJid)
		},

		groupAcceptInviteV4,

		groupGetInviteInfo: async (code: string): Promise<GroupMetadata> => {
			return bridgeGroupMetadataToBaileys(await (await ctx.getClient()).groupGetInviteInfo(code))
		},

		groupToggleEphemeral: async (jid: string, ephemeralExpiration: number): Promise<void> => {
			await (await ctx.getClient()).groupToggleEphemeral(jid, ephemeralExpiration)
		},

		groupSettingUpdate,

		groupMemberAddMode: async (jid: string, mode: MemberAddMode): Promise<void> => {
			assertArgumentDomain('groupMemberAddMode', 'mode', mode, MEMBER_ADD_MODES)
			await (await ctx.getClient()).groupMemberAddMode(jid, mode)
		},

		groupJoinApprovalMode: async (jid: string, mode: JoinApprovalMode): Promise<void> => {
			// Anything but 'on' used to mean off, so a typo turned approvals off
			// and reported success.
			assertArgumentDomain('groupJoinApprovalMode', 'mode', mode, JOIN_APPROVAL_MODES)
			await (await ctx.getClient()).groupSettingUpdate(jid, 'membership_approval', mode === 'on')
		},

		groupFetchAllParticipating: async (): Promise<Record<string, GroupMetadata>> => {
			const bridgeGroups = await (await ctx.getClient()).groupFetchAllParticipating()
			const result: Record<string, GroupMetadata> = {}
			for (const [groupJid, metadata] of Object.entries(bridgeGroups)) {
				result[groupJid] = bridgeGroupMetadataToBaileys(metadata)
			}

			ctx.ev.emit('groups.update', Object.values(result))
			return result
		},

		updateMemberLabel: async (jid: string, memberLabel: string): Promise<string> => {
			return (await ctx.getClient()).updateMemberLabel(jid, memberLabel.slice(0, 30))
		}
	}
}
