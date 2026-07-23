import type { CanonicalGroupAction, CanonicalGroupParticipant, CanonicalGroupUpdate } from '../Bridge/types.ts'
import type {
	BaileysEventMap,
	ChatUpdate,
	GroupMetadata,
	GroupParticipant,
	WAMessage,
	WAMessageKey
} from '../Types/index.ts'
import { WAProto } from '../Types/index.ts'
import { encodeStubParticipant } from './group-stub-params.ts'
import { areJidsSameUser, isLidUser, isPnUser } from '../WABinary/jid-utils.ts'

/**
 * Baileys-facing translation for neutral `w:gp2` notifications.
 *
 * The Rust core and bridge intentionally retain wire concepts and snake_case
 * field names. This module is the single place that applies upstream Baileys'
 * public field names, omission rules, stub encoding and event semantics.
 */

const STUB = WAProto.WebMessageInfo.StubType

const PARTICIPANT_STUBS = {
	add: STUB.GROUP_PARTICIPANT_ADD,
	remove: STUB.GROUP_PARTICIPANT_REMOVE,
	promote: STUB.GROUP_PARTICIPANT_PROMOTE,
	demote: STUB.GROUP_PARTICIPANT_DEMOTE,
	modify: STUB.GROUP_PARTICIPANT_CHANGE_NUMBER
} as const

type ParticipantActionType = keyof typeof PARTICIPANT_STUBS

const isParticipantAction = (
	action: CanonicalGroupAction
): action is CanonicalGroupAction & { type: ParticipantActionType; participants: CanonicalGroupParticipant[] } =>
	action.type in PARTICIPANT_STUBS

/** Match the object built from a `<participant>` by upstream messages-recv. */
export const canonicalGroupParticipantToBaileys = (participant: CanonicalGroupParticipant): GroupParticipant => {
	const admin: GroupParticipant['admin'] =
		participant.role === 'admin' || participant.role === 'superadmin' ? participant.role : null
	const result: GroupParticipant = { id: participant.jid, admin }

	if (isLidUser(participant.jid) && isPnUser(participant.phoneNumber)) {
		result.phoneNumber = participant.phoneNumber
	}

	if (isPnUser(participant.jid) && isLidUser(participant.lid)) {
		result.lid = participant.lid
	}

	if (participant.username) result.username = participant.username
	return result
}

export type GroupNotificationDomainEvent =
	| { name: 'group-participants.update'; payload: BaileysEventMap['group-participants.update'] }
	| { name: 'groups.update'; payload: BaileysEventMap['groups.update'] }
	| null

const KNOWN_REQUEST_METHODS = new Set<NonNullable<BaileysEventMap['group.join-request']['method']>>([
	'invite_link',
	'linked_group_join',
	'non_admin_add'
])

const validateRequestMethod = (raw: string | undefined): BaileysEventMap['group.join-request']['method'] => {
	if (!raw) return undefined
	return KNOWN_REQUEST_METHODS.has(raw as NonNullable<BaileysEventMap['group.join-request']['method']>)
		? (raw as NonNullable<BaileysEventMap['group.join-request']['method']>)
		: undefined
}

const sameDefinedUser = (left: string | undefined, right: string | undefined) =>
	left !== undefined && right !== undefined && areJidsSameUser(left, right)

const participantMatchesAuthor = (participant: CanonicalGroupParticipant, notification: CanonicalGroupUpdate) =>
	sameDefinedUser(participant.jid, notification.author) ||
	sameDefinedUser(participant.jid, notification.authorPn) ||
	sameDefinedUser(participant.phoneNumber, notification.author) ||
	sameDefinedUser(participant.phoneNumber, notification.authorPn)

/** Build the public join-request events, one per affected participant. */
export const buildGroupJoinRequestEvents = (
	notification: CanonicalGroupUpdate
): BaileysEventMap['group.join-request'][] => {
	const action = notification.action
	const author = notification.author
	if (!author) return []

	const common = {
		id: notification.groupJid,
		author,
		authorPn: notification.authorPn,
		authorUsername: notification.authorUsername
	}

	if (action.type === 'membershipApprovalRequest') {
		return [
			{
				...common,
				participant: author,
				participantPn: notification.authorPn,
				action: 'created',
				method: validateRequestMethod(action.requestMethod)
			}
		]
	}

	if (action.type === 'createdMembershipRequests') {
		const method = validateRequestMethod(action.requestMethod)
		return action.requests.map(request => ({
			...common,
			participant: request.jid,
			participantPn: request.phoneNumber,
			action: 'created',
			method
		}))
	}

	if (action.type === 'revokedMembershipRequests') {
		return action.participants.map(participant => ({
			...common,
			participant: participant.jid,
			participantPn: participant.phoneNumber,
			action: participantMatchesAuthor(participant, notification) ? 'revoked' : 'rejected',
			method: undefined
		}))
	}

	return []
}

/** Build the public high-level event derived by upstream process-message. */
export const buildGroupNotificationDomainEvent = (notification: CanonicalGroupUpdate): GroupNotificationDomainEvent => {
	const action = notification.action
	if (isParticipantAction(action)) {
		return {
			name: 'group-participants.update',
			payload: {
				id: notification.groupJid,
				author: notification.author ?? '',
				authorPn: notification.authorPn,
				authorUsername: notification.authorUsername,
				participants: action.participants.map(canonicalGroupParticipantToBaileys),
				action: action.type
			}
		}
	}

	let change: Partial<GroupMetadata> | undefined
	switch (action.type) {
		case 'subject':
			change = { subject: action.subject }
			break
		case 'description':
			change = { desc: action.description }
			break
		case 'locked':
			change = { restrict: true }
			break
		case 'unlocked':
			change = { restrict: false }
			break
		case 'announce':
			change = { announce: true }
			break
		case 'notAnnounce':
			change = { announce: false }
			break
		case 'invite':
			change = { inviteCode: action.code }
			break
		case 'membershipApprovalMode':
			change = { joinApprovalMode: action.enabled }
			break
		case 'memberAddMode':
			change = { memberAddMode: action.mode === 'all_member_add' }
			break
		default:
			// Upstream emits no public groups.update for lifecycle markers,
			// ephemeral protocol messages or currently unsupported official tags.
			return null
	}

	const update: Partial<GroupMetadata> = { id: notification.groupJid, ...change }
	if (notification.author !== undefined) update.author = notification.author
	if (notification.authorPn !== undefined) update.authorPn = notification.authorPn
	if (notification.authorUsername !== undefined) update.authorUsername = notification.authorUsername
	return { name: 'groups.update', payload: [update] }
}

/** Chat updates that upstream process-message derives while handling stubs. */
export const buildGroupNotificationChatUpdates = (notification: CanonicalGroupUpdate): ChatUpdate[] => {
	const action = notification.action
	switch (action.type) {
		case 'subject':
			return [{ id: notification.groupJid, name: action.subject }]
		case 'description':
			return [{ id: notification.groupJid, description: action.description }]
		case 'ephemeral':
			return [
				{
					id: notification.groupJid,
					ephemeralSettingTimestamp: notification.timestamp,
					ephemeralExpiration: action.expiration || null
				}
			]
		default:
			return []
	}
}

interface StubRecipe {
	stubType?: number
	stubParams?: string[]
	message?: NonNullable<WAMessage['message']>
	idSuffix: string
}

const TOGGLE_STUBS: Partial<Record<CanonicalGroupAction['type'], { stubType: number; on: boolean; idSuffix: string }>> =
	{
		locked: { stubType: STUB.GROUP_CHANGE_RESTRICT, on: true, idSuffix: 'restrict' },
		unlocked: { stubType: STUB.GROUP_CHANGE_RESTRICT, on: false, idSuffix: 'restrict' },
		announce: { stubType: STUB.GROUP_CHANGE_ANNOUNCE, on: true, idSuffix: 'announce' },
		notAnnounce: { stubType: STUB.GROUP_CHANGE_ANNOUNCE, on: false, idSuffix: 'announce' }
	}

const participantStubRecipe = (
	notification: CanonicalGroupUpdate,
	action: CanonicalGroupAction & { type: ParticipantActionType; participants: CanonicalGroupParticipant[] }
): StubRecipe => {
	let stubType: number = PARTICIPANT_STUBS[action.type]
	if (
		action.type === 'remove' &&
		action.participants.length === 1 &&
		participantMatchesAuthor(action.participants[0]!, notification)
	) {
		stubType = STUB.GROUP_PARTICIPANT_LEAVE
	}

	return {
		stubType,
		stubParams: action.participants.map(participant =>
			encodeStubParticipant(canonicalGroupParticipantToBaileys(participant))
		),
		idSuffix: action.type
	}
}

const joinRequestStubRecipes = (notification: CanonicalGroupUpdate): StubRecipe[] =>
	buildGroupJoinRequestEvents(notification).map((request, index) => {
		const params = [JSON.stringify({ lid: request.participant, pn: request.participantPn }), request.action]
		if (request.method) params.push(request.method)
		return {
			stubType: STUB.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD,
			stubParams: params,
			idSuffix: `join-${index}`
		}
	})

const stubRecipesFor = (notification: CanonicalGroupUpdate): StubRecipe[] => {
	const action = notification.action
	if (isParticipantAction(action)) return [participantStubRecipe(notification, action)]

	const toggle = TOGGLE_STUBS[action.type]
	if (toggle) {
		return [{ stubType: toggle.stubType, stubParams: [toggle.on ? 'on' : 'off'], idSuffix: toggle.idSuffix }]
	}

	switch (action.type) {
		case 'subject':
			return [{ stubType: STUB.GROUP_CHANGE_SUBJECT, stubParams: [action.subject], idSuffix: 'subject' }]
		case 'description':
			return [
				{
					stubType: STUB.GROUP_CHANGE_DESCRIPTION,
					stubParams: action.description == null ? undefined : [action.description],
					idSuffix: 'description'
				}
			]
		case 'invite':
			return [{ stubType: STUB.GROUP_CHANGE_INVITE_LINK, stubParams: [action.code], idSuffix: 'invite' }]
		case 'membershipApprovalMode':
			return [
				{
					stubType: STUB.GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE,
					stubParams: [action.enabled ? 'on' : 'off'],
					idSuffix: 'join-approval-mode'
				}
			]
		case 'memberAddMode':
			return [{ stubType: STUB.GROUP_MEMBER_ADD_MODE, stubParams: [action.mode], idSuffix: 'member-add-mode' }]
		case 'ephemeral':
			return [
				{
					message: {
						protocolMessage: {
							type: WAProto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
							ephemeralExpiration: action.expiration
						}
					},
					idSuffix: 'ephemeral'
				}
			]
		case 'membershipApprovalRequest':
		case 'createdMembershipRequests':
		case 'revokedMembershipRequests':
			return joinRequestStubRecipes(notification)
		default:
			return []
	}
}

let fallbackStubIdCounter = 0

const stubMessageId = (notification: CanonicalGroupUpdate, recipe: StubRecipe, recipeIndex: number, count: number) => {
	const actionIndex = notification.actionIndex
	if (notification.notificationId) {
		if (actionIndex === 0 && count === 1) return notification.notificationId
		return `${notification.notificationId}:${actionIndex}:${recipeIndex}`
	}

	const discriminator = recipe.stubType ?? 'protocol'
	return `BAE-GP-${notification.timestamp}-${discriminator}-${recipe.idSuffix}-${(fallbackStubIdCounter++).toString(36)}`
}

const groupStubMessageKey = (
	notification: CanonicalGroupUpdate,
	fromMe: boolean,
	id: string,
	participant: string | undefined,
	participantAlt: string | undefined
): WAMessageKey => ({
	remoteJid: notification.groupJid,
	fromMe,
	id,
	participant,
	participantAlt,
	participantUsername: notification.authorUsername,
	addressingMode: notification.isLidAddressingMode ? 'lid' : 'pn'
})

/** Build the upstream-shaped notification messages for one canonical action. */
export const buildGroupNotificationStubMessages = (
	notification: CanonicalGroupUpdate,
	fromMe: boolean
): WAMessage[] => {
	const recipes = stubRecipesFor(notification)
	return recipes.map((recipe, index) => {
		const key = groupStubMessageKey(
			notification,
			fromMe,
			stubMessageId(notification, recipe, index, recipes.length),
			notification.author,
			notification.authorPn
		)

		// `create` intentionally performs the same shallow construction as
		// upstream and therefore preserves newer key extensions that are not in
		// the pinned public protobuf schema (participantAlt/username/mode).
		return WAProto.WebMessageInfo.create({
			key,
			participant: notification.author,
			messageTimestamp: notification.timestamp,
			message: recipe.message,
			messageStubType: recipe.stubType,
			messageStubParameters: recipe.stubParams
		}) as WAMessage
	})
}

/** Build the create stub after metadata has been resolved. */
export const buildGroupCreateStubMessage = (
	notification: CanonicalGroupUpdate,
	metadata: GroupMetadata,
	fromMe: boolean
): WAMessage => {
	const recipe: StubRecipe = {
		stubType: STUB.GROUP_CREATE,
		stubParams: [metadata.subject],
		idSuffix: 'create'
	}
	return WAProto.WebMessageInfo.create({
		key: groupStubMessageKey(
			notification,
			fromMe,
			stubMessageId(notification, recipe, 0, 1),
			metadata.owner,
			metadata.ownerPn
		),
		participant: notification.author,
		messageTimestamp: notification.timestamp,
		messageStubType: recipe.stubType,
		messageStubParameters: recipe.stubParams
	}) as WAMessage
}
