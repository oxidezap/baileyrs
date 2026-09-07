import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import type {
	BinaryNode,
	GroupMetadata as UpstreamGroupMetadata,
	GroupParticipant as UpstreamGroupParticipant
} from 'baileys'
import { extractGroupMetadata } from 'baileys/lib/Socket/groups.js'
import type { GroupMetadataResult } from '@oxidezap/whatsapp-rust-bridge'

import { bridgeGroupMetadataToBaileys } from '../Compatibility/group-metadata.ts'
import { makeGroupMethods } from '../Socket/groups.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BaileysEventMap } from '../Types/Events.ts'
import type { GroupMetadata, GroupParticipant } from '../Types/GroupMetadata.ts'
import { expect } from './expect.ts'

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
		? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
			? true
			: false
		: false
type Assert<Condition extends true> = Condition
type WithoutAddressingMode<Value> = Omit<Value, 'addressingMode'>
type StringValues<Value> = Value extends string ? `${Value}` : never

// Compile-time contract checks. String enums from two packages are nominally
// distinct, so their value sets are compared separately from the object shape.
type _GroupMetadataShapeMatches = Assert<
	Equal<WithoutAddressingMode<GroupMetadata>, WithoutAddressingMode<UpstreamGroupMetadata>>
>
type _GroupAddressingModeValuesMatch = Assert<
	Equal<
		StringValues<Exclude<GroupMetadata['addressingMode'], undefined>>,
		StringValues<Exclude<UpstreamGroupMetadata['addressingMode'], undefined>>
	>
>
type _GroupParticipantMatches = Assert<Equal<GroupParticipant, UpstreamGroupParticipant>>

const neutralGroup = (overrides: Partial<GroupMetadataResult> = {}): GroupMetadataResult => ({
	id: 'compat-group@g.us',
	subject: 'Compatibility fixture',
	participants: [],
	addressingMode: 'pn',
	isLocked: false,
	isAnnouncement: false,
	membershipApproval: false,
	isParentGroup: false,
	isDefaultSubGroup: false,
	isGeneralChat: false,
	allowNonAdminSubGroupCreation: false,
	noFrequentlyForwarded: false,
	isSuspended: false,
	allowAdminReports: false,
	isHiddenGroup: false,
	isIncognito: false,
	hasGroupHistory: false,
	isLimitSharingEnabled: false,
	...overrides
})

describe('bridge group metadata compatibility boundary', () => {
	it('matches upstream extractGroupMetadata field names, values, roles, and optional fields', () => {
		const response: BinaryNode = {
			tag: 'iq',
			attrs: {},
			content: [
				{
					tag: 'group',
					attrs: {
						id: 'compat-group',
						notify: 'Fixture notification',
						addressing_mode: 'lid',
						subject: 'Compatibility fixture',
						s_o: 'subject-owner@lid',
						s_o_pn: 'subject-owner@s.whatsapp.net',
						s_o_username: 'subject.owner',
						s_t: '1750000100',
						size: '3',
						creation: '1750000000',
						creator: 'creator@c.us',
						creator_pn: 'creator-pn@c.us',
						creator_username: 'group.creator',
						creator_country_code: 'ZZ'
					},
					content: [
						{
							tag: 'description',
							attrs: {
								id: 'DESCRIPTION-1',
								participant: 'description-owner@c.us',
								participant_pn: 'description-owner-pn@c.us',
								participant_username: 'description.owner',
								t: '1750000200'
							},
							content: [{ tag: 'body', attrs: {}, content: 'Protocol-neutral fixture' }]
						},
						{ tag: 'locked', attrs: {} },
						{ tag: 'announcement', attrs: {} },
						{ tag: 'parent', attrs: {} },
						{ tag: 'default_sub_group', attrs: {} },
						{ tag: 'linked_parent', attrs: { jid: 'parent-community@g.us' } },
						{
							tag: 'membership_approval_mode',
							attrs: {},
							content: [{ tag: 'group_join', attrs: { state: 'on' } }]
						},
						{ tag: 'member_add_mode', attrs: {}, content: 'all_member_add' },
						{ tag: 'ephemeral', attrs: { expiration: '0', trigger: '7' } },
						{
							tag: 'participant',
							attrs: {
								jid: 'member-a@lid',
								phone_number: 'member-a@s.whatsapp.net',
								participant_username: 'member.a',
								type: 'admin'
							}
						},
						{
							tag: 'participant',
							attrs: {
								jid: 'member-b@s.whatsapp.net',
								lid: 'member-b@lid',
								username: 'member.b',
								type: 'superadmin'
							}
						},
						{
							tag: 'participant',
							attrs: { jid: 'member-c@lid', phone_number: 'member-c@c.us' }
						}
					]
				}
			]
		}

		const bridge = neutralGroup({
			id: 'compat-group',
			notify: 'Fixture notification',
			addressingMode: 'lid',
			creator: 'creator@c.us',
			creatorPn: 'creator-pn@c.us',
			creatorUsername: 'group.creator',
			creatorCountryCode: 'ZZ',
			creationTime: 1_750_000_000,
			subjectTime: 1_750_000_100,
			subjectOwner: 'subject-owner@lid',
			subjectOwnerPn: 'subject-owner@s.whatsapp.net',
			subjectOwnerUsername: 'subject.owner',
			description: 'Protocol-neutral fixture',
			descriptionId: 'DESCRIPTION-1',
			descriptionOwner: 'description-owner@c.us',
			descriptionOwnerPn: 'description-owner-pn@c.us',
			descriptionOwnerUsername: 'description.owner',
			descriptionTime: 1_750_000_200,
			isLocked: true,
			isAnnouncement: true,
			ephemeral: { expiration: 0, trigger: 7 },
			membershipApproval: true,
			memberAddMode: 'all_member_add',
			size: 3,
			isParentGroup: true,
			parentGroupJid: 'parent-community@g.us',
			isDefaultSubGroup: true,
			participants: [
				{
					jid: 'member-a@lid',
					phoneNumber: 'member-a@s.whatsapp.net',
					username: 'member.a',
					participantType: 'admin',
					isAdmin: true,
					isSuperAdmin: false
				},
				{
					jid: 'member-b@s.whatsapp.net',
					lid: 'member-b@lid',
					username: 'member.b',
					participantType: 'superadmin',
					isAdmin: true,
					isSuperAdmin: true
				},
				{
					jid: 'member-c@lid',
					phoneNumber: 'member-c@c.us',
					participantType: 'member',
					isAdmin: false,
					isSuperAdmin: false
				}
			]
		})

		expect(bridgeGroupMetadataToBaileys(bridge)).toEqual(extractGroupMetadata(response))
	})

	it('matches upstream defaults, NaN timestamps, participant-count size, and absent ephemeral settings', () => {
		const response: BinaryNode = {
			tag: 'iq',
			attrs: {},
			content: [
				{
					tag: 'group',
					attrs: { id: 'minimal@g.us', subject: 'Minimal fixture' },
					content: [
						{ tag: 'participant', attrs: { jid: 'minimal-member@lid' } },
						{ tag: 'participant', attrs: { jid: 'minimal-member-2@lid' } }
					]
				}
			]
		}

		const bridge = neutralGroup({
			id: 'minimal@g.us',
			subject: 'Minimal fixture',
			participants: [
				{
					jid: 'minimal-member@lid',
					participantType: 'member',
					isAdmin: false,
					isSuperAdmin: false
				},
				{
					jid: 'minimal-member-2@lid',
					participantType: 'member',
					isAdmin: false,
					isSuperAdmin: false
				}
			]
		})

		expect(bridgeGroupMetadataToBaileys(bridge)).toEqual(extractGroupMetadata(response))
	})

	it('groupFetchAllParticipating returns and emits the same metadata set', async () => {
		const ev = Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		})
		const emitted: BaileysEventMap['groups.update'][] = []
		ev.on('groups.update', payload => emitted.push(payload))
		const fixture = neutralGroup({ id: '120363@g.us', subject: 'Participating group' })
		const ctx = {
			ev,
			withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) =>
				operation(
					(await { groupFetchAllParticipating: async () => ({ '120363@g.us': fixture }) }) as unknown as MockClient
				)
		} as unknown as SocketContext

		const result = await makeGroupMethods(ctx).groupFetchAllParticipating()
		expect(Object.keys(result)).toEqual(['120363@g.us'])
		expect(emitted).toHaveLength(1)
		expect(emitted[0]).toEqual(Object.values(result))
	})
})
