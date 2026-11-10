import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import P from 'pino'
import type { SignalAuthState } from '../../Types/index.ts'
import {
	bindSignalRepositoryContext,
	jidToSignalProtocolAddressCompat,
	makeDefaultSignalRepository,
	makeSignalRepository
} from '../signal-repository.ts'

const logger = P({ level: 'silent' })

const makeRepository = (client: Partial<WasmWhatsAppClient>) =>
	makeSignalRepository({
		logger,
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) =>
			operation((await (client as WasmWhatsAppClient)) as MockClient)
	})

describe('Signal repository compatibility adapter', () => {
	it('binds the default config factory to the socket-owned native client', async () => {
		const auth = { creds: {} as never, keys: {} as never } satisfies SignalAuthState
		const client = {
			signalValidateSession: async (jid: string) => jid === '5511999999999@s.whatsapp.net'
		} as Partial<WasmWhatsAppClient>
		bindSignalRepositoryContext(auth, {
			logger,
			withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) =>
				operation((await (client as WasmWhatsAppClient)) as MockClient)
		})

		const repository = makeDefaultSignalRepository(auth, logger)
		assert.deepEqual(await repository.validateSession('5511999999999@s.whatsapp.net'), { exists: true })

		const unbound = makeDefaultSignalRepository({ creds: {} as never, keys: {} as never }, logger)
		await assert.rejects(() => unbound.validateSession('5511999999999@s.whatsapp.net'), /not bound to an active socket/)
	})

	it('delegates every stateful Signal operation without dropping writes', async () => {
		const calls: Array<[string, ...unknown[]]> = []
		const bytes = Uint8Array.from([1, 2, 3])
		const client: Partial<WasmWhatsAppClient> = {
			signalDecryptMessage: async (...args) => {
				calls.push(['decrypt', ...args])
				return bytes
			},
			signalEncryptMessage: async (...args) => {
				calls.push(['encrypt', ...args])
				return { type: 'msg', ciphertext: bytes }
			},
			signalDecryptGroupMessage: async (...args) => {
				calls.push(['decrypt-group', ...args])
				return bytes
			},
			signalEncryptGroupMessage: async (...args) => {
				calls.push(['encrypt-group', ...args])
				return { senderKeyDistributionMessage: bytes, ciphertext: bytes }
			},
			signalProcessSenderKeyDistribution: async (...args) => {
				calls.push(['process-sender-key', ...args])
			},
			signalGetSenderKeyDistribution: async (...args) => {
				calls.push(['get-sender-key', ...args])
				return bytes
			},
			signalHasSenderKey: async (...args) => {
				calls.push(['has-sender-key', ...args])
				return true
			},
			signalGetSessionInfo: async jid => {
				calls.push(['session-info', jid])
				return { baseKey: bytes, registrationId: 17 }
			},
			signalInstallPreKeyBundle: async (...args) => {
				calls.push(['install-session', ...args])
			},
			signalValidateSession: async jid => {
				calls.push(['validate', jid])
				return true
			},
			signalMigrateSessions: async (...args) => {
				calls.push(['migrate', ...args])
				return { migrated: 2, skipped: 1, total: 3 }
			},
			signalDeleteSessions: async jids => {
				calls.push(['delete', jids])
			}
		}
		const repository = makeRepository(client)
		const pn = '5511999999999@s.whatsapp.net'
		const lid = '123456789@lid'
		const group = '120363000000000000@g.us'

		assert.deepEqual(await repository.decryptMessage({ jid: pn, type: 'msg', ciphertext: bytes }), bytes)
		assert.deepEqual(await repository.encryptMessage({ jid: pn, data: bytes }), { type: 'msg', ciphertext: bytes })
		assert.deepEqual(await repository.decryptGroupMessage({ group, authorJid: pn, msg: bytes }), bytes)
		assert.deepEqual(await repository.encryptGroupMessage({ group, meId: pn, data: bytes }), {
			senderKeyDistributionMessage: bytes,
			ciphertext: bytes
		})
		await repository.processSenderKeyDistributionMessage({
			item: { groupId: group, axolotlSenderKeyDistributionMessage: bytes },
			authorJid: pn
		})
		assert.deepEqual(await repository.getSenderKeyDistributionMessage({ group, meId: pn }), bytes)
		assert.equal(await repository.hasSenderKey({ group, meId: pn }), true)
		assert.deepEqual(await repository.getSessionInfo(pn), { baseKey: bytes, registrationId: 17 })
		const session = {
			registrationId: 17,
			identityKey: bytes,
			signedPreKey: { keyId: 4, publicKey: bytes, signature: bytes },
			preKey: { keyId: 5, publicKey: bytes }
		}
		await repository.injectE2ESession({ jid: pn, session })
		assert.deepEqual(await repository.validateSession(pn), { exists: true })
		assert.deepEqual(await repository.migrateSession(pn, lid), { migrated: 2, skipped: 1, total: 3 })
		await repository.deleteSession([pn])

		assert.deepEqual(calls, [
			['decrypt', pn, 'msg', bytes],
			['encrypt', pn, bytes],
			['decrypt-group', group, pn, bytes],
			['encrypt-group', group, bytes, pn],
			['process-sender-key', group, pn, bytes],
			['get-sender-key', group, pn],
			['has-sender-key', group, pn],
			['session-info', pn],
			['install-session', pn, session],
			['validate', pn],
			['migrate', pn, lid],
			['delete', [pn]]
		])
	})

	it('matches upstream protocol-address formatting for PN, LID and hosted JIDs', async () => {
		const upstream = await import('baileys')
		const upstreamRepository = upstream.DEFAULT_CONNECTION_CONFIG.makeSignalRepository(
			{
				creds: {} as never,
				keys: {} as never
			},
			logger
		)
		for (const jid of [
			'5511999999999@s.whatsapp.net',
			'5511999999999:7@s.whatsapp.net',
			'123456789@lid',
			'123456789:7@lid',
			'5511999999999:99@hosted',
			'123456789:99@hosted.lid'
		]) {
			assert.equal(jidToSignalProtocolAddressCompat(jid), upstreamRepository.jidToSignalProtocolAddress(jid))
		}
		upstreamRepository.close?.()
	})

	it('preserves devices and hosted namespaces while batching mapping writes', async () => {
		const writes: unknown[] = []
		const client: Partial<WasmWhatsAppClient> = {
			lidForPn: async () => '123456789@lid',
			pnForLid: async () => '5511999999999@s.whatsapp.net',
			addLidPnMappings: async mappings => {
				writes.push(mappings)
				return mappings.length
			}
		}
		const repository = makeRepository(client)

		assert.deepEqual(
			await repository.lidMapping.getLIDsForPNs(['5511999999999:7@s.whatsapp.net', '5511999999999:99@hosted']),
			[
				{ pn: '5511999999999:7@s.whatsapp.net', lid: '123456789:7@lid' },
				{ pn: '5511999999999:99@hosted', lid: '123456789:99@hosted.lid' }
			]
		)
		assert.deepEqual(await repository.lidMapping.getPNsForLIDs(['123456789:7@lid', '123456789:99@hosted.lid']), [
			{ pn: '5511999999999:7@s.whatsapp.net', lid: '123456789:7@lid' },
			{ pn: '5511999999999:99@hosted', lid: '123456789:99@hosted.lid' }
		])

		await repository.lidMapping.storeLIDPNMappings([
			{ pn: '5511999999999@s.whatsapp.net', lid: '123456789@lid' },
			{ pn: '5511999999999:99@hosted', lid: '123456789:99@hosted.lid' },
			{ pn: 'invalid@lid', lid: 'invalid@s.whatsapp.net' }
		])
		assert.deepEqual(writes, [
			[
				{ pn: '5511999999999@s.whatsapp.net', lid: '123456789@lid' },
				{ pn: '5511999999999:99@hosted', lid: '123456789:99@hosted.lid' }
			]
		])
	})

	it('rejects malformed distributions and preserves migration sentinels locally', async () => {
		const repository = makeRepository({})
		await assert.rejects(
			repository.processSenderKeyDistributionMessage({ item: {}, authorJid: '1@s.whatsapp.net' }),
			/Group ID is required/
		)
		assert.deepEqual(await repository.migrateSession('', ''), { migrated: 0, skipped: 0, total: 0 })
		assert.deepEqual(await repository.migrateSession('123@lid', '456@lid'), {
			migrated: 0,
			skipped: 0,
			total: 1
		})
	})
})
