import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { GroupMetadataResult, WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeCommunityMethods } from '../Socket/communities.ts'
import type { SocketContext } from '../Socket/types.ts'

const neutralGroup = (overrides: Partial<GroupMetadataResult> = {}): GroupMetadataResult => ({
	id: 'parent@g.us',
	subject: 'Parent',
	participants: [],
	addressingMode: 'pn',
	isLocked: false,
	isAnnouncement: false,
	membershipApproval: false,
	isParentGroup: true,
	isDefaultSubGroup: false,
	isGeneralChat: false,
	allowNonAdminSubGroupCreation: true,
	noFrequentlyForwarded: false,
	isSuspended: false,
	allowAdminReports: false,
	isHiddenGroup: false,
	isIncognito: false,
	hasGroupHistory: false,
	isLimitSharingEnabled: false,
	...overrides
})

const context = (client: Partial<WasmWhatsAppClient>): SocketContext =>
	({
		ev: Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		}),
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) =>
			operation((await (client as WasmWhatsAppClient)) as MockClient)
	}) as unknown as SocketContext

describe('community socket compatibility', () => {
	it('creates parent groups with the protocol options required by the public method', async () => {
		const calls: unknown[][] = []
		const methods = makeCommunityMethods(
			context({
				createCommunity: async (...args: unknown[]) => {
					calls.push(args)
					return neutralGroup()
				}
			} as Partial<WasmWhatsAppClient>)
		)

		const result = await methods.communityCreate('Parent', 'Description')

		assert.equal(result?.id, 'parent@g.us')
		assert.deepEqual(calls, [['Parent', 'Description', true, true, true]])
	})

	it('uses the parent-aware participant operation and reconstructs the public node', async () => {
		const calls: unknown[][] = []
		const methods = makeCommunityMethods(
			context({
				communityParticipantsUpdate: async (...args: unknown[]) => {
					calls.push(args)
					return [{ jid: 'member@lid', status: 'admin' }]
				}
			} as Partial<WasmWhatsAppClient>)
		)

		const result = await methods.communityParticipantsUpdate('parent@g.us', ['member@lid'], 'promote')

		assert.deepEqual(calls, [['parent@g.us', ['member@lid'], 'promote']])
		assert.deepEqual(result, [
			{
				status: '200',
				jid: 'member@lid',
				content: { tag: 'participant', attrs: { jid: 'member@lid', type: 'admin' } }
			}
		])
	})

	it('resolves a subgroup to its parent before fetching linked groups', async () => {
		const requestedParents: string[] = []
		const methods = makeCommunityMethods(
			context({
				getGroupMetadata: async () =>
					neutralGroup({ id: 'child@g.us', isParentGroup: false, parentGroupJid: 'parent@g.us' }),
				getCommunitySubgroups: async (jid: string) => {
					requestedParents.push(jid)
					return [
						{
							id: 'child@g.us',
							subject: 'Child',
							creation: 1_750_000_000,
							owner: 'owner@lid',
							participantCount: 12,
							isDefaultSubGroup: false,
							isGeneralChat: false
						}
					]
				}
			} as Partial<WasmWhatsAppClient>)
		)

		const result = await methods.communityFetchLinkedGroups('child@g.us')

		assert.deepEqual(requestedParents, ['parent@g.us'])
		assert.deepEqual(result, {
			communityJid: 'parent@g.us',
			isCommunity: false,
			linkedGroups: [
				{
					id: 'child@g.us',
					subject: 'Child',
					creation: 1_750_000_000,
					owner: 'owner@lid',
					size: 12
				}
			]
		})
	})
})
