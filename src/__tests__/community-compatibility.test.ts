import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { GroupMetadataResult, WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeGroupMethods } from '../Socket/groups.ts'
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

describe('bridge 0.25 full participating metadata', () => {
	for (const community of [false, true]) {
		it(`hydrates ${community ? 'community' : 'group'} overviews before emitting a complete update`, async () => {
			const fetched: string[] = []
			const listing = {
				'parent@g.us': { id: 'parent@g.us', hierarchy: { type: 'community' as const } },
				'child@g.us': {
					id: 'child@g.us',
					hierarchy: { type: 'subgroup' as const, parent: 'parent@g.us', kind: 'default' }
				}
			}
			const client: Partial<WasmWhatsAppClient> = {
				groupFetchAllParticipating: async () => listing,
				communityFetchAllParticipating: async () => listing,
				getGroupMetadata: async jid => {
					fetched.push(jid)
					return neutralGroup({
						id: jid,
						subject: 'Full metadata',
						participantCount: 9,
						participants: [{ jid: 'member@lid', participantType: 'admin', isAdmin: true, isSuperAdmin: false }]
					})
				}
			}
			const ctx = context(client)
			const emitted: unknown[] = []
			ctx.ev.on('groups.update', update => emitted.push(update))
			const methods = community ? makeCommunityMethods(ctx) : makeGroupMethods(ctx)
			const result = community
				? await (methods as ReturnType<typeof makeCommunityMethods>).communityFetchAllParticipating()
				: await (methods as ReturnType<typeof makeGroupMethods>).groupFetchAllParticipating()
			assert.deepEqual(fetched, ['parent@g.us', 'child@g.us'])
			assert.equal(result['parent@g.us']?.size, 9)
			assert.equal(result['parent@g.us']?.subject, 'Full metadata')
			assert.equal(result['parent@g.us']?.participants[0]?.admin, 'admin')
			assert.deepEqual(emitted, [Object.values(result)])
		})
		it(`rejects ${community ? 'community' : 'group'} hydration failure without emitting partial metadata`, async () => {
			const failure = Object.assign(new Error('metadata denied'), { kind: 'server', serverCode: 403 })
			const listing = { 'parent@g.us': { id: 'parent@g.us', hierarchy: { type: 'community' as const } } }
			const ctx = context({
				groupFetchAllParticipating: async () => listing,
				communityFetchAllParticipating: async () => listing,
				getGroupMetadata: async () => {
					throw failure
				}
			})
			const emitted: unknown[] = []
			ctx.ev.on('groups.update', update => emitted.push(update))
			await assert.rejects(
				community
					? makeCommunityMethods(ctx).communityFetchAllParticipating()
					: makeGroupMethods(ctx).groupFetchAllParticipating(),
				error => error === failure
			)
			assert.deepEqual(emitted, [])
		})
	}
	it('does not repeat community creation after a configuration failure', async () => {
		let creates = 0
		const cause = Object.assign(new Error('denied'), { kind: 'server', serverCode: 403 })
		const failure = Object.assign(new Error('created but configuration failed'), {
			kind: 'server',
			createdJid: 'parent@g.us',
			step: 'description',
			cause
		})
		const methods = makeCommunityMethods(
			context({
				createCommunity: async () => {
					creates++
					throw failure
				}
			})
		)
		await assert.rejects(methods.communityCreate('Parent', 'Description'), error => error === failure)
		assert.equal(creates, 1)
	})
})
