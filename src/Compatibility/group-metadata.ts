import type { GroupMetadataResult } from 'whatsapp-rust-bridge'
import type { GroupMetadata, GroupParticipant } from '../Types/GroupMetadata.ts'
import { WAMessageAddressingMode } from '../Types/Message.ts'
import { isLidUser, jidEncode, jidNormalizedUser } from '../WABinary/jid-utils.ts'

/**
 * Match Baileys' PN predicate at the compatibility boundary.
 *
 * baileyrs accepts legacy `@c.us` JIDs in other public helpers, while the
 * upstream group parser only treats `@s.whatsapp.net` as a participant PN.
 * Keeping that distinction local avoids changing unrelated APIs.
 */
const isBaileysParticipantPn = (jid: string | undefined): jid is string =>
	typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')

const normalizeOptionalUserJid = (jid: string | undefined) => (jid ? jidNormalizedUser(jid) : undefined)

const participantAdmin = (participantType: string): GroupParticipant['admin'] => {
	if (participantType === 'admin' || participantType === 'superadmin') return participantType
	return null
}

/**
 * Translate the bridge's protocol-neutral group DTO into the public Baileys
 * contract. All Baileys-specific defaults and field names belong here—not in
 * whatsapp-rust or whatsapp-rust-bridge.
 */
export const bridgeGroupMetadataToBaileys = (group: GroupMetadataResult): GroupMetadata => {
	const participants: GroupParticipant[] = group.participants.map(participant => ({
		id: participant.jid,
		phoneNumber:
			isLidUser(participant.jid) && isBaileysParticipantPn(participant.phoneNumber)
				? participant.phoneNumber
				: undefined,
		lid: isBaileysParticipantPn(participant.jid) && isLidUser(participant.lid) ? participant.lid : undefined,
		username: participant.username || undefined,
		admin: participantAdmin(participant.participantType)
	}))

	const hasDescriptionNodeData =
		group.description !== undefined ||
		group.descriptionId !== undefined ||
		group.descriptionOwner !== undefined ||
		group.descriptionOwnerPn !== undefined ||
		group.descriptionOwnerUsername !== undefined ||
		group.descriptionTime !== undefined

	return {
		id: group.id.includes('@') ? group.id : jidEncode(group.id, 'g.us'),
		notify: group.notify,
		addressingMode:
			group.addressingMode === WAMessageAddressingMode.LID ? WAMessageAddressingMode.LID : WAMessageAddressingMode.PN,
		subject: group.subject,
		subjectOwner: group.subjectOwner,
		subjectOwnerPn: group.subjectOwnerPn,
		subjectOwnerUsername: group.subjectOwnerUsername,
		subjectTime: group.subjectTime ?? Number.NaN,
		size: group.size ?? participants.length,
		creation: group.creationTime ?? Number.NaN,
		owner: normalizeOptionalUserJid(group.creator),
		ownerPn: normalizeOptionalUserJid(group.creatorPn),
		ownerUsername: group.creatorUsername || undefined,
		owner_country_code: group.creatorCountryCode,
		desc: group.description,
		descId: group.descriptionId,
		descOwner: normalizeOptionalUserJid(group.descriptionOwner),
		descOwnerPn: normalizeOptionalUserJid(group.descriptionOwnerPn),
		descOwnerUsername: group.descriptionOwnerUsername,
		descTime: hasDescriptionNodeData ? (group.descriptionTime ?? Number.NaN) : undefined,
		linkedParent: group.parentGroupJid || undefined,
		restrict: group.isLocked,
		announce: group.isAnnouncement,
		isCommunity: group.isParentGroup,
		isCommunityAnnounce: group.isDefaultSubGroup,
		joinApprovalMode: group.membershipApproval,
		memberAddMode: group.memberAddMode === 'all_member_add',
		participants,
		ephemeralDuration: group.ephemeral?.expiration
	}
}
