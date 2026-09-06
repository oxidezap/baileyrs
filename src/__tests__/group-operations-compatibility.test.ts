import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeCommunityMethods } from '../Socket/communities.ts'
import { makeGroupMethods } from '../Socket/groups.ts'
import type { SocketContext } from '../Socket/types.ts'
import { WAMessageStubType } from '../Types/index.ts'

describe('group operation compatibility', () => {
	it('accepts V4 invites and emits the complete buffered lifecycle', async () => {
		const ev = Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		})
		const updates: unknown[] = []
		const upserts: unknown[] = []
		ev.on('messages.update', value => updates.push(value))
		ev.on('messages.upsert', value => upserts.push(value))
		const calls: unknown[][] = []
		const client = {
			groupAcceptInviteV4: async (...args: unknown[]) => {
				calls.push(args)
				return 'parent@g.us'
			}
		} as unknown as WasmWhatsAppClient
		const ctx = {
			ev,
			getClient: async () => client,
			getUser: () => ({ id: 'bot@s.whatsapp.net', lid: 'bot@lid' }),
			getMe: () => ({ id: 'bot@s.whatsapp.net', lid: 'bot@lid', name: 'Bot' })
		} as unknown as SocketContext

		const result = await makeGroupMethods(ctx).groupAcceptInviteV4(
			{ remoteJid: 'inviter@lid', id: 'invite-message-id', fromMe: false },
			{ groupJid: 'parent@g.us', inviteCode: 'INVITE', inviteExpiration: 1_800_000_000 }
		)

		assert.equal(result, 'parent@g.us')
		assert.deepEqual(calls, [['parent@g.us', 'INVITE', 1_800_000_000, 'inviter@lid']])
		assert.equal(updates.length, 1)
		const update = updates[0] as Array<{
			update: { message: { groupInviteMessage: { inviteCode?: string | null; inviteExpiration?: number | null } } }
		}>
		assert.equal(update[0]?.update.message.groupInviteMessage.inviteCode, '')
		assert.equal(update[0]?.update.message.groupInviteMessage.inviteExpiration, 0)

		assert.equal(upserts.length, 1)
		const upsert = upserts[0] as {
			type: string
			messages: Array<{
				key: { remoteJid?: string | null; participant?: string | null; fromMe?: boolean | null }
				messageStubType?: number | null
				messageStubParameters?: string[] | null
			}>
		}
		assert.equal(upsert.type, 'notify')
		assert.equal(upsert.messages[0]?.key.remoteJid, 'parent@g.us')
		assert.equal(upsert.messages[0]?.key.participant, 'inviter@lid')
		assert.equal(upsert.messages[0]?.key.fromMe, false)
		assert.equal(upsert.messages[0]?.messageStubType, WAMessageStubType.GROUP_PARTICIPANT_ADD)
		assert.deepEqual(upsert.messages[0]?.messageStubParameters, [
			JSON.stringify({ id: 'bot@s.whatsapp.net', lid: 'bot@lid', name: 'Bot' })
		])
	})

	// The server also answers an accepted V4 join with a bare
	// `<iq type="result">` (no `<group>`/`<community>`/
	// `<membership_approval_request>` child). The core surfaces that shape as
	// an internal parse error even though the join succeeded; Baileys returns
	// the envelope's `from` there, which echoes the request's `to`, so this
	// layer answers with the requested group JID and still runs the buffered
	// lifecycle instead of rejecting (issue #114).
	it('answers a bare join success with the group JID and keeps the buffered lifecycle', async () => {
		const ev = Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		})
		const updates: unknown[] = []
		const upserts: unknown[] = []
		ev.on('messages.update', value => updates.push(value))
		ev.on('messages.upsert', value => upserts.push(value))
		const calls: unknown[][] = []
		const bareSuccess = Object.assign(
			new Error(
				'failed to parse IQ response: expected <group>, <community>, or <membership_approval_request> in join response'
			),
			{ name: 'WhatsAppError', kind: 'internal' }
		)
		const client = {
			groupAcceptInviteV4: async (...args: unknown[]) => {
				calls.push(args)
				throw bareSuccess
			}
		} as unknown as WasmWhatsAppClient
		const ctx = {
			ev,
			getClient: async () => client,
			getUser: () => ({ id: 'bot@s.whatsapp.net', lid: 'bot@lid' }),
			getMe: () => ({ id: 'bot@s.whatsapp.net', lid: 'bot@lid', name: 'Bot' })
		} as unknown as SocketContext

		const result = await makeGroupMethods(ctx).groupAcceptInviteV4(
			{ remoteJid: 'inviter@lid', id: 'invite-message-id', fromMe: false },
			{ groupJid: 'parent@g.us', inviteCode: 'INVITE', inviteExpiration: 1_800_000_000 }
		)

		assert.equal(result, 'parent@g.us')
		assert.deepEqual(calls, [['parent@g.us', 'INVITE', 1_800_000_000, 'inviter@lid']])
		assert.equal(updates.length, 1)
		assert.equal(upserts.length, 1)
		const upsert = upserts[0] as { type: string }
		assert.equal(upsert.type, 'notify')
	})

	// Only the bare-success shape falls back. Genuine failures — server
	// rejections and unrelated internal errors — must keep propagating by
	// identity, with no lifecycle side effects.
	it('rethrows V4 join failures that are not a bare success', async () => {
		const rejections = [
			Object.assign(new Error('server error 403: forbidden'), {
				name: 'WhatsAppError',
				kind: 'server',
				serverCode: 403,
				serverText: 'forbidden'
			}),
			Object.assign(new Error('internal: something else broke'), {
				name: 'WhatsAppError',
				kind: 'internal'
			})
		]
		for (const rejection of rejections) {
			const ev = Object.assign(new EventEmitter(), {
				createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
			})
			const updates: unknown[] = []
			const upserts: unknown[] = []
			ev.on('messages.update', value => updates.push(value))
			ev.on('messages.upsert', value => upserts.push(value))
			const client = {
				groupAcceptInviteV4: async () => {
					throw rejection
				}
			} as unknown as WasmWhatsAppClient
			const ctx = {
				ev,
				getClient: async () => client,
				getUser: () => ({ id: 'bot@s.whatsapp.net', lid: 'bot@lid' }),
				getMe: () => ({ id: 'bot@s.whatsapp.net', lid: 'bot@lid', name: 'Bot' })
			} as unknown as SocketContext

			const thrown = await makeGroupMethods(ctx)
				.groupAcceptInviteV4(
					{ remoteJid: 'inviter@lid', id: 'invite-message-id', fromMe: false },
					{ groupJid: 'parent@g.us', inviteCode: 'INVITE', inviteExpiration: 1_800_000_000 }
				)
				.then(() => undefined)
				.catch((err: unknown) => err)

			assert.equal(thrown, rejection, 'the original error object must survive')
			assert.equal(updates.length, 0)
			assert.equal(upserts.length, 0)
		}
	})

	// The `prev` conflict token that makes an update of an existing description
	// work is resolved by the core; this side only has to hand the description
	// over untouched, including the `undefined` that means "delete".
	it('forwards description updates and deletions to the same operation', async () => {
		const calls: unknown[][] = []
		const client = {
			groupUpdateDescription: async (...args: unknown[]) => {
				calls.push(args)
			}
		} as unknown as WasmWhatsAppClient
		const ev = Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		})
		const ctx = { ev, getClient: async () => client } as unknown as SocketContext
		const groups = makeGroupMethods(ctx)

		await groups.groupUpdateDescription('120363000000000001@g.us', 'new description')
		await groups.groupUpdateDescription('120363000000000001@g.us')
		await makeCommunityMethods(ctx, groups).communityUpdateDescription(
			'120363000000000002@g.us',
			'community description'
		)

		assert.deepEqual(calls, [
			['120363000000000001@g.us', 'new description'],
			['120363000000000001@g.us', undefined],
			['120363000000000002@g.us', 'community description']
		])
	})

	// The bridge classifies a server rejection as `kind: 'server'` with the
	// code on it. That only reaches a bot if this layer rethrows the error
	// untouched instead of wrapping or flattening it.
	it('propagates a server rejection without masking its code', async () => {
		const rejection = Object.assign(new Error('server error 409: conflict'), {
			name: 'WhatsAppError',
			kind: 'server',
			serverCode: 409,
			serverText: 'conflict'
		})
		const client = {
			groupUpdateDescription: async () => {
				throw rejection
			}
		} as unknown as WasmWhatsAppClient
		const ev = Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		})
		const ctx = { ev, getClient: async () => client } as unknown as SocketContext
		const groups = makeGroupMethods(ctx)

		const thrown = await groups
			.groupUpdateDescription('120363000000000001@g.us', 'texto')
			.then(() => undefined)
			.catch((err: unknown) => err)

		assert.equal(thrown, rejection, 'the original error object must survive')
		assert.equal((thrown as { serverCode?: number }).serverCode, 409)

		const fromCommunity = await makeCommunityMethods(ctx, groups)
			.communityUpdateDescription('120363000000000002@g.us', 'texto')
			.then(() => undefined)
			.catch((err: unknown) => err)

		assert.equal(fromCommunity, rejection)
	})
})
