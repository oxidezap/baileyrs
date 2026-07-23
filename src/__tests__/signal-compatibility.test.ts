import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KEY_BUNDLE_TYPE } from '../Defaults/index.ts'
import type { SignalKeyStore, SignalRepositoryWithLIDStore } from '../Types/index.ts'
import type { BinaryNode } from '../Types/index.ts'
import { encodeBigEndian } from '../Utils/generics.ts'
import {
	createSignalIdentity,
	extractDeviceJids,
	extractE2ESessionFromRetryReceipt,
	getPreKeys,
	parseAndInjectE2ESessions,
	xmppPreKey,
	xmppSignedPreKey
} from '../Utils/signal.ts'

const keyPair = (publicByte: number, privateByte = publicByte + 1) => ({
	public: Uint8Array.from({ length: 32 }, () => publicByte),
	private: Uint8Array.from({ length: 32 }, () => privateByte)
})

const sessionUserNode = (jid: string): BinaryNode => ({
	tag: 'user',
	attrs: { jid },
	content: [
		{ tag: 'registration', attrs: {}, content: encodeBigEndian(12, 4) },
		{ tag: 'identity', attrs: {}, content: keyPair(1).public },
		{
			tag: 'skey',
			attrs: {},
			content: [
				{ tag: 'id', attrs: {}, content: encodeBigEndian(7, 3) },
				{ tag: 'value', attrs: {}, content: keyPair(2).public },
				{ tag: 'signature', attrs: {}, content: Uint8Array.from({ length: 64 }, () => 3) }
			]
		},
		{
			tag: 'key',
			attrs: {},
			content: [
				{ tag: 'id', attrs: {}, content: encodeBigEndian(8, 3) },
				{ tag: 'value', attrs: {}, content: keyPair(4).public }
			]
		}
	]
})

describe('Signal utility compatibility', () => {
	it('matches identity, pre-key lookup and XMPP key nodes', async () => {
		const upstream = await import('baileys')
		const accountKey = keyPair(9).public
		assert.deepEqual(
			createSignalIdentity('5511999999999@s.whatsapp.net', accountKey),
			upstream.createSignalIdentity('5511999999999@s.whatsapp.net', accountKey)
		)

		const requested: string[][] = []
		const store: SignalKeyStore = {
			get: async (_type, ids) => {
				requested.push(ids)
				return Object.fromEntries(ids.map(id => [id, keyPair(Number(id))])) as never
			},
			set: async () => undefined
		}
		const localKeys = await getPreKeys(store, 3, 6)
		const upstreamGetPreKeys = upstream.getPreKeys as unknown as typeof getPreKeys
		const remoteKeys = await upstreamGetPreKeys(store, 3, 6)
		assert.deepEqual(localKeys, remoteKeys)
		assert.deepEqual(requested, [
			['3', '4', '5'],
			['3', '4', '5']
		])

		const signed = { keyPair: keyPair(5), signature: Uint8Array.from([6, 7]), keyId: 0x010203 }
		assert.deepEqual(xmppSignedPreKey(signed), upstream.xmppSignedPreKey(signed))
		assert.deepEqual(xmppPreKey(keyPair(8), 0x030201), upstream.xmppPreKey(keyPair(8), 0x030201))
	})

	it('extracts valid retry sessions and rejects malformed bundles exactly like upstream', async () => {
		const upstream = await import('baileys')
		const user = sessionUserNode('peer@s.whatsapp.net')
		const valid: BinaryNode = {
			tag: 'receipt',
			attrs: {},
			content: [
				{ tag: 'registration', attrs: {}, content: encodeBigEndian(12, 4) },
				{
					tag: 'keys',
					attrs: {},
					content: [
						{ tag: 'type', attrs: {}, content: KEY_BUNDLE_TYPE },
						...(user.content as BinaryNode[]).filter(child => child.tag !== 'registration')
					]
				}
			]
		}
		const fixtures: BinaryNode[] = [
			valid,
			{ tag: 'receipt', attrs: {} },
			{
				...valid,
				content: [
					{ tag: 'registration', attrs: {}, content: encodeBigEndian(12, 4) },
					{ tag: 'keys', attrs: {}, content: [{ tag: 'type', attrs: {}, content: Uint8Array.from([9]) }] }
				]
			}
		]
		for (const fixture of fixtures) {
			assert.deepEqual(extractE2ESessionFromRetryReceipt(fixture), upstream.extractE2ESessionFromRetryReceipt(fixture))
		}
	})

	it('injects parsed sessions and propagates stanza errors like upstream', async () => {
		const upstream = await import('baileys')
		const root: BinaryNode = {
			tag: 'iq',
			attrs: {},
			content: [
				{ tag: 'list', attrs: {}, content: [sessionUserNode('one@s.whatsapp.net'), sessionUserNode('two@lid')] }
			]
		}
		const run = async (implementation: typeof parseAndInjectE2ESessions, node: BinaryNode) => {
			const injected: unknown[] = []
			const repository = {
				injectE2ESession: async (session: unknown) => injected.push(session)
			} as unknown as SignalRepositoryWithLIDStore
			await implementation(node, repository)
			return injected
		}
		const upstreamParser = upstream.parseAndInjectE2ESessions as unknown as typeof parseAndInjectE2ESessions
		assert.deepEqual(await run(parseAndInjectE2ESessions, root), await run(upstreamParser, root))

		const withError: BinaryNode = {
			tag: 'iq',
			attrs: {},
			content: [
				{
					tag: 'list',
					attrs: {},
					content: [{ tag: 'user', attrs: {}, content: [{ tag: 'error', attrs: { code: '404', text: 'missing' } }] }]
				}
			]
		}
		await assert.rejects(run(parseAndInjectE2ESessions, withError), /missing/)
		await assert.rejects(run(upstreamParser, withError), /missing/)
	})

	it('matches device extraction across PN, LID, hosted and own-device cases', async () => {
		const upstream = await import('baileys')
		const result = [
			{
				id: '5511999999999@s.whatsapp.net',
				devices: {
					deviceList: [{ id: 0 }, { id: 2, keyIndex: 1 }, { id: 3 }, { id: 4, keyIndex: 2, isHosted: true }]
				}
			},
			{
				id: '12345@lid',
				devices: { deviceList: [{ id: 0 }, { id: 8, keyIndex: 1, isHosted: true }] }
			}
		]
		for (const excludeZero of [false, true]) {
			assert.deepEqual(
				extractDeviceJids(result, '5511999999999:2@s.whatsapp.net', '99999@lid', excludeZero),
				upstream.extractDeviceJids(result, '5511999999999:2@s.whatsapp.net', '99999@lid', excludeZero)
			)
		}
	})
})
