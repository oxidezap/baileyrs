import type { CanonicalGroupAction, CanonicalGroupUpdate } from '../Bridge/types.ts'
import type { BaileysEventMap, GroupMetadata, WAMessage } from '../Types/index.ts'
import { WAProto } from '../Types/index.ts'
import { encodeStubParticipant } from '../Utils/group-stub-params.ts'

/**
 * Bridges `<notification type="w:gp2">` actions onto the two event surfaces
 * upstream Baileys consumers expect:
 *
 *   1. **Domain event** — either `group-participants.update` (for
 *      add/remove/promote/demote/modify) or `groups.update` (for metadata
 *      / settings changes), shaped exactly like upstream's emissions.
 *   2. **Stub `messages.upsert`** — a body-less `WAMessage` per affected
 *      entity, carrying `messageStubType` (the matching
 *      `WAMessageStubType.GROUP_*` constant) and `messageStubParameters`.
 *      Many bots (sung, etc.) update their persisted state exclusively from
 *      this path because the high-level event filters out the bot itself
 *      when it's the target of the action.
 *
 * Inputs are already-normalized `CanonicalGroup*` values from the
 * `src/Bridge` adapter — see that module for the bridge → canonical mapping.
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

const isParticipantAction = (a: CanonicalGroupAction): a is CanonicalGroupAction & { type: ParticipantActionType } =>
	a.type in PARTICIPANT_STUBS

/**
 * Domain event a group notification maps to (either participant or
 * settings). `null` when the action carries nothing useful for callers
 * (e.g. raw `create`/`link`/`unlink` payloads).
 */
export type GroupNotificationDomainEvent =
	| { name: 'group-participants.update'; payload: BaileysEventMap['group-participants.update'] }
	| { name: 'groups.update'; payload: BaileysEventMap['groups.update'] }
	| null

/**
 * Whitelist of `RequestJoinMethod` values upstream Baileys recognizes.
 * The bridge's `MembershipRequestMethod` is a wire-string enum that may
 * grow with new variants; validating here keeps an unknown server-side
 * method from leaking into consumer code as a typed but invalid value.
 */
const KNOWN_REQUEST_METHODS = new Set<NonNullable<BaileysEventMap['group.join-request']['method']>>([
	'invite_link',
	'linked_group_join',
	'non_admin_add'
])

const validateRequestMethod = (raw: string | undefined): BaileysEventMap['group.join-request']['method'] => {
	if (!raw) return undefined
	return KNOWN_REQUEST_METHODS.has(raw as NonNullable<BaileysEventMap['group.join-request']['method']>)
		? (raw as BaileysEventMap['group.join-request']['method'])
		: undefined
}

/**
 * Build all `group.join-request` events a notification fans out to —
 * upstream emits one event per affected participant. Returns an empty
 * array for non-join-request actions.
 */
export const buildGroupJoinRequestEvents = (
	notification: CanonicalGroupUpdate
): BaileysEventMap['group.join-request'][] => {
	const action = notification.action
	const author = notification.author
	const authorPn = notification.authorPn

	if (action.type === 'membershipApprovalRequest') {
		// Single user requesting join. The author IS the requester, so
		// without a real author there is no addressable participant —
		// dropping the event beats emitting one with `participant: ''`.
		if (!author) return []
		return [
			{
				id: notification.groupJid,
				author,
				authorPn,
				participant: author,
				participantPn: authorPn,
				action: 'created',
				method: validateRequestMethod(action.requestMethod)
			}
		]
	}

	if (action.type === 'createdMembershipRequests') {
		// Batched fanout (typically community parent → linked group). Emit
		// one event per request entry; skip entries without a participant
		// JID rather than synthesizing blanks.
		if (!author) return []
		const method = validateRequestMethod(action.requestMethod)
		return action.requests
			.filter(req => !!req.jid)
			.map(req => ({
				id: notification.groupJid,
				author,
				authorPn,
				participant: req.jid,
				participantPn: req.phoneNumber,
				action: 'created',
				method
			}))
	}

	if (action.type === 'revokedMembershipRequests') {
		// Admin revoked one or more pending requests. Method is unknown at
		// this point (server doesn't echo the original method back).
		if (!author) return []
		return action.participants
			.filter(p => !!p.jid)
			.map(p => ({
				id: notification.groupJid,
				author,
				authorPn,
				participant: p.jid,
				participantPn: p.phoneNumber,
				action: 'revoked',
				method: undefined
			}))
	}

	return []
}

/** Build the upstream-style high-level event for a canonical group update. */
export const buildGroupNotificationDomainEvent = (notification: CanonicalGroupUpdate): GroupNotificationDomainEvent => {
	const action = notification.action
	if (isParticipantAction(action)) {
		const participants = action.participants.map(p => {
			const entry: { id: string; admin?: 'admin' | 'superadmin' | null; phoneNumber?: string } = { id: p.jid }
			if (action.type === 'promote') entry.admin = 'admin'
			else if (action.type === 'demote') entry.admin = null
			// Carry the PN counterpart when the canonical layer extracted it
			// from the bridge `<participant phone_number="...">` attribute.
			// Lets bots in LID-mode groups DM the user via PN without an
			// extra `lidMapping.getPNForLID` round-trip.
			if (p.phoneNumber) entry.phoneNumber = p.phoneNumber
			return entry
		})
		return {
			name: 'group-participants.update',
			payload: {
				id: notification.groupJid,
				author: notification.author ?? '',
				authorPn: notification.authorPn,
				participants,
				action: action.type
			}
		}
	}

	const update: Partial<GroupMetadata> = { id: notification.groupJid }
	if (notification.author !== undefined) update.author = notification.author
	if (notification.authorPn !== undefined) update.authorPn = notification.authorPn

	switch (action.type) {
		case 'subject':
			update.subject = action.subject
			if (action.subjectOwner) update.subjectOwner = action.subjectOwner
			if (action.subjectTime != null) update.subjectTime = action.subjectTime
			break
		case 'description':
			update.descId = action.id
			if (action.description != null) update.desc = action.description
			break
		case 'ephemeral':
			update.ephemeralDuration = action.expiration
			break
		case 'locked':
			update.restrict = true
			break
		case 'unlocked':
			update.restrict = false
			break
		case 'announce':
			update.announce = true
			break
		case 'notAnnounce':
			update.announce = false
			break
		case 'membershipApprovalMode':
			update.joinApprovalMode = action.enabled
			break
		case 'memberAddMode':
			update.memberAddMode = action.mode === 'all_member_add'
			break
		// invite/revokeInvite/create/delete/link/unlink/etc. → minimal id-only
		// update; consumers that care can refetch via groupMetadata.
	}

	return { name: 'groups.update', payload: [update] }
}

interface StubRecipe {
	stubType: number
	stubParams: string[]
	/** Disambiguator within the notification (used in `key.id`). */
	idSuffix: string
}

/**
 * Toggle-style actions: same stubType for both states, distinguished by
 * stubParams[0] = 'on' | 'off'. `idSuffix` is shared (counter in the
 * caller distinguishes individual emits).
 */
const TOGGLE_STUBS: Record<string, { stubType: number; on: boolean; idSuffix: string }> = {
	locked: { stubType: STUB.GROUP_CHANGE_RESTRICT, on: true, idSuffix: 'restrict' },
	unlocked: { stubType: STUB.GROUP_CHANGE_RESTRICT, on: false, idSuffix: 'restrict' },
	announce: { stubType: STUB.GROUP_CHANGE_ANNOUNCE, on: true, idSuffix: 'announce' },
	notAnnounce: { stubType: STUB.GROUP_CHANGE_ANNOUNCE, on: false, idSuffix: 'announce' }
}

/** Marker actions with no stubParams payload. */
const SIMPLE_STUBS: Record<string, { stubType: number; idSuffix: string }> = {
	revokeInvite: { stubType: STUB.GROUP_CHANGE_INVITE_LINK, idSuffix: 'rinv' },
	create: { stubType: STUB.GROUP_CREATE, idSuffix: 'create' },
	noFrequentlyForwarded: { stubType: STUB.GROUP_CHANGE_NO_FREQUENTLY_FORWARDED, idSuffix: 'nff' }
}

const stubRecipesFor = (action: CanonicalGroupAction): StubRecipe[] => {
	if (isParticipantAction(action)) {
		const stubType = PARTICIPANT_STUBS[action.type]
		return action.participants.map((p, idx) => ({
			stubType,
			stubParams: [encodeStubParticipant({ id: p.jid, phoneNumber: p.phoneNumber })],
			idSuffix: `${idx}-${p.jid.split('@')[0]}`
		}))
	}

	const toggle = TOGGLE_STUBS[action.type]
	if (toggle) return [{ stubType: toggle.stubType, stubParams: [toggle.on ? 'on' : 'off'], idSuffix: toggle.idSuffix }]

	const simple = SIMPLE_STUBS[action.type]
	if (simple) return [{ stubType: simple.stubType, stubParams: [], idSuffix: simple.idSuffix }]

	switch (action.type) {
		case 'subject':
			return [{ stubType: STUB.GROUP_CHANGE_SUBJECT, stubParams: [action.subject], idSuffix: 'subject' }]
		case 'description':
			return [
				{
					stubType: STUB.GROUP_CHANGE_DESCRIPTION,
					stubParams: action.description != null ? [action.description] : [],
					idSuffix: 'desc'
				}
			]
		case 'membershipApprovalMode':
			return [
				{
					stubType: STUB.GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE,
					stubParams: [action.enabled ? 'on' : 'off'],
					idSuffix: 'jam'
				}
			]
		case 'memberAddMode':
			return [{ stubType: STUB.GROUP_MEMBER_ADD_MODE, stubParams: [action.mode], idSuffix: 'mam' }]
		default:
			return []
	}
}

/**
 * Process-monotonic counter mixed into stub IDs so two notifications
 * with the same `(timestamp, stubType, idSuffix)` (e.g. admin renames
 * a group twice in the same second) generate distinct keys. Without
 * this, message stores indexed by `key.id` would silently overwrite
 * the earlier event.
 */
let stubIdCounter = 0

/**
 * Build all stub WAMessages a group notification action should fan out to.
 *
 * `fromMe` is computed by the caller (events.ts) from the current user
 * identity — it isn't part of the bridge payload, so it doesn't belong on
 * the canonical type.
 */
export const buildGroupNotificationStubMessages = (notification: CanonicalGroupUpdate, fromMe: boolean): WAMessage[] =>
	stubRecipesFor(notification.action).map(
		r =>
			WAProto.WebMessageInfo.fromObject({
				key: {
					remoteJid: notification.groupJid,
					fromMe,
					id: `BAE-GP-${notification.timestamp}-${r.stubType}-${r.idSuffix}-${(stubIdCounter++).toString(36)}`,
					participant: notification.author
				},
				participant: notification.author,
				messageTimestamp: notification.timestamp,
				messageStubType: r.stubType,
				messageStubParameters: r.stubParams
			}) as WAMessage
	)
