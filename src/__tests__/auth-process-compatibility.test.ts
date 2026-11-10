import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuthenticationCreds, SignalDataSet, SignalKeyStore, WAMessage, WAMessageKey } from '../Types/index.ts'
import { WAMessageStubType } from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { addTransactionCapability, assertMeId, makeCacheableSignalKeyStore } from '../Utils/auth-utils.ts'
import { aesEncryptGCM, hmacSign } from '../Utils/crypto.ts'
import { initAuthCreds } from '../Utils/generics.ts'
import type { ILogger } from '../Utils/logger.ts'
import {
	cleanMessage,
	decryptEventResponse,
	decryptPollVote,
	getChatId,
	isRealMessage,
	shouldIncrementChatUnread
} from '../Utils/process-message.ts'

const logger: ILogger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
}

function createMemoryStore(initial: Record<string, Record<string, unknown>> = {}, failingSets = 0) {
	const values = structuredClone(initial)
	const calls = { get: 0, set: 0, clear: 0 }
	let failuresLeft = failingSets
	const store: SignalKeyStore = {
		async get(type, ids) {
			calls.get++
			const result: Record<string, unknown> = {}
			for (const id of ids) {
				const value = values[type]?.[id]
				if (value !== undefined && value !== null) result[id] = value
			}
			return result as never
		},
		async set(data) {
			calls.set++
			if (failuresLeft-- > 0) throw new Error('transient commit failure')
			for (const [type, entries] of Object.entries(data)) {
				values[type] ||= {}
				for (const [id, value] of Object.entries(entries ?? {})) {
					if (value === null) delete values[type]![id]
					else values[type]![id] = value
				}
			}
		},
		async clear() {
			calls.clear++
			for (const key of Object.keys(values)) delete values[key]
		}
	}
	return { store, values, calls }
}

describe('auth key-store compatibility', () => {
	it('matches upstream authenticated-user assertion and Boom failure', async () => {
		const upstream = await import('baileys')
		const authenticated = initAuthCreds()
		authenticated.me = { id: '5511999999999@s.whatsapp.net' }
		assert.equal(assertMeId(authenticated), upstream.assertMeId(authenticated))

		for (const creds of [initAuthCreds(), { ...initAuthCreds(), me: { id: '' } }]) {
			let localError: unknown
			let remoteError: unknown
			try {
				assertMeId(creds as AuthenticationCreds)
			} catch (error) {
				localError = error
			}
			try {
				upstream.assertMeId(creds as AuthenticationCreds)
			} catch (error) {
				remoteError = error
			}
			assert.equal((localError as Error).message, (remoteError as Error).message)
			assert.equal((localError as { output: { statusCode: number } }).output.statusCode, 401)
			assert.equal(
				(localError as { output: { statusCode: number } }).output.statusCode,
				(remoteError as { output: { statusCode: number } }).output.statusCode
			)
		}
	})

	it('matches upstream cache hits, writes and clearing', async () => {
		const upstream = await import('baileys')
		const exercise = async (factory: (store: SignalKeyStore, logger?: ILogger) => SignalKeyStore) => {
			const memory = createMemoryStore({ session: { one: Uint8Array.from([1]) } })
			const cached = factory(memory.store, logger)
			const first = await cached.get('session', ['one', 'missing'])
			const second = await cached.get('session', ['one'])
			await cached.set({ session: { two: Uint8Array.from([2]) } })
			const written = await cached.get('session', ['two'])
			await cached.clear?.()
			return { first, second, written, calls: memory.calls, values: memory.values }
		}

		assert.deepEqual(
			await exercise(makeCacheableSignalKeyStore),
			await exercise(upstream.makeCacheableSignalKeyStore as unknown as typeof makeCacheableSignalKeyStore)
		)
	})

	it('matches upstream nested transactions, caching and pre-key validation', async () => {
		const upstream = await import('baileys')
		const exercise = async (factory: typeof addTransactionCapability) => {
			const memory = createMemoryStore({
				session: { one: Uint8Array.from([1]) },
				'pre-key': { '7': { public: Uint8Array.from([7]), private: Uint8Array.from([8]) } }
			})
			const transactional = factory(memory.store, logger, { maxCommitRetries: 3, delayBetweenTriesMs: 0 })
			const flags = [transactional.isInTransaction()]
			const result = await transactional.transaction(async () => {
				flags.push(transactional.isInTransaction())
				const first = await transactional.get('session', ['one'])
				const second = await transactional.get('session', ['one'])
				await transactional.get('pre-key', ['7'])
				await transactional.set({
					session: { two: Uint8Array.from([2]) },
					'pre-key': { '7': null }
				})
				const nested = await transactional.transaction(async () => transactional.isInTransaction(), 'same')
				return { first, second, nested }
			}, 'same')
			flags.push(transactional.isInTransaction())

			const deletion: SignalDataSet = { 'pre-key': { missing: null } }
			await transactional.set(deletion)
			return { result, flags, calls: memory.calls, values: memory.values, deletion }
		}

		assert.deepEqual(
			await exercise(addTransactionCapability),
			await exercise(upstream.addTransactionCapability as unknown as typeof addTransactionCapability)
		)
	})

	it('matches commit retries and transaction rollback', async () => {
		const upstream = await import('baileys')
		const exerciseRetry = async (factory: typeof addTransactionCapability) => {
			const memory = createMemoryStore({}, 2)
			const transactional = factory(memory.store, logger, { maxCommitRetries: 3, delayBetweenTriesMs: 0 })
			await transactional.transaction(
				async () => transactional.set({ session: { retry: Uint8Array.from([9]) } }),
				'retry'
			)
			return { calls: memory.calls, values: memory.values }
		}
		const exerciseRollback = async (factory: typeof addTransactionCapability) => {
			const memory = createMemoryStore()
			const transactional = factory(memory.store, logger, { maxCommitRetries: 1, delayBetweenTriesMs: 0 })
			await assert.rejects(
				transactional.transaction(async () => {
					await transactional.set({ session: { rollback: Uint8Array.from([3]) } })
					throw new Error('rollback')
				}, 'rollback'),
				/rollback/
			)
			return { calls: memory.calls, values: memory.values }
		}

		const upstreamTransactions = upstream.addTransactionCapability as unknown as typeof addTransactionCapability
		assert.deepEqual(await exerciseRetry(addTransactionCapability), await exerciseRetry(upstreamTransactions))
		assert.deepEqual(await exerciseRollback(addTransactionCapability), await exerciseRollback(upstreamTransactions))
	})
})

describe('received-message helper compatibility', () => {
	it('matches upstream message cleanup for hosted/device JIDs and nested keys', async () => {
		const upstream = await import('baileys')
		const fixture: WAMessage = {
			key: { remoteJid: '5511999999999:4@hosted', participant: '12345:9@hosted.lid', fromMe: false },
			message: {
				reactionMessage: {
					key: { remoteJid: 'old@s.whatsapp.net', participant: '5511999999999@s.whatsapp.net', fromMe: false },
					text: '👍'
				}
			}
		}
		const local = structuredClone(fixture)
		const remote = structuredClone(fixture)
		cleanMessage(local, '5511999999999@s.whatsapp.net', '12345@lid')
		;(upstream.cleanMessage as unknown as typeof cleanMessage)(remote, '5511999999999@s.whatsapp.net', '12345@lid')
		assert.deepEqual(local, remote)
	})

	/**
	 * Where the two libraries part company, and why this side is the one that
	 * follows WhatsApp Web.
	 *
	 * **A field with nothing to normalise stays absent.** `WAWebMsgKey` assigns
	 * the participant only when it has one — `h !== void 0 && (this.participant =
	 * h)` — and serialises the key by joining the parts that are present, so an
	 * empty participant would change the identity the message is stored under.
	 * Upstream pushes every field through `jidNormalizedUser`, which answers `''`
	 * for a jid it was not given, and writes `participant: ''` onto every direct
	 * message. That is upstream's bug, so this is asserted against WhatsApp Web's
	 * rule rather than against upstream's output.
	 *
	 * **A hosted jid is re-encoded onto its plain server**, and here the two do
	 * agree — checked against upstream, since agreement is the claim.
	 */
	it('does not add a key field that was not there', () => {
		// The assertion is on the property, not on its value. An earlier version
		// asked whether the field held `''` and passed on a key that had gained it
		// holding `undefined` — which is the same shape difference one step
		// quieter, and exactly what this is meant to catch.
		for (const key of [
			{ remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
			{ remoteJid: '5511999999999:99@hosted', fromMe: false },
			{ fromMe: false }
		] as WAMessageKey[]) {
			const before = Object.keys(key)
			const local: WAMessage = { key: structuredClone(key), message: { conversation: 'hi' } }
			cleanMessage(local, '5511999999999@s.whatsapp.net', '12345@lid')
			assert.deepEqual(
				Object.keys(local.key).toSorted(),
				before.toSorted(),
				`cleanMessage added a field to ${JSON.stringify(key)}`
			)
		}
	})

	it('differs from upstream here, which materialises the field instead', async () => {
		// So the entry beside this one is pinned to a live difference rather than a
		// remembered one: the day upstream adopts WhatsApp Web's rule, this fails
		// and `clean-message-empty-jid-key` can go.
		const upstream = await import('baileys')
		const remote: WAMessage = {
			key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
			message: { conversation: 'hi' }
		}
		;(upstream.cleanMessage as unknown as typeof cleanMessage)(remote, '5511999999999@s.whatsapp.net', '12345@lid')
		assert.equal(remote.key.participant, '', 'upstream still materialises an empty participant')
	})

	it('re-encodes a hosted jid onto its plain server, as upstream does', async () => {
		const upstream = await import('baileys')
		const keys: WAMessageKey[] = [
			// What WhatsApp Web accepts: `<digits>:99@hosted`.
			{ remoteJid: '5511999999999:99@hosted', fromMe: false },
			{ remoteJid: '100000000000000:99@hosted.lid', fromMe: false },
			// And what it rejects outright, where the two used to disagree over a
			// server neither of them should have been asked about.
			{ remoteJid: '_99:1@hosted', fromMe: false },
			{ remoteJid: '_1@hosted.lid', fromMe: false },
			{ participant: '@hosted', fromMe: false }
		]

		for (const key of keys) {
			const local: WAMessage = { key: structuredClone(key), message: { conversation: 'hi' } }
			const remote: WAMessage = { key: structuredClone(key), message: { conversation: 'hi' } }
			cleanMessage(local, '5511999999999@s.whatsapp.net', '12345@lid')
			;(upstream.cleanMessage as unknown as typeof cleanMessage)(remote, '5511999999999@s.whatsapp.net', '12345@lid')
			// Only the field the case actually carries. The other one is where the
			// two differ by design — upstream materialises `''` there — and that is
			// the subject of the test above, not of this one.
			if (key.remoteJid !== undefined) {
				assert.equal(local.key.remoteJid, remote.key.remoteJid, `remoteJid for ${JSON.stringify(key)}`)
			}
			if (key.participant !== undefined) {
				assert.equal(local.key.participant, remote.key.participant, `participant for ${JSON.stringify(key)}`)
			}
		}
	})

	it('matches real-message, unread and chat-id rules including failures', async () => {
		const upstream = await import('baileys')
		const messages: WAMessage[] = [
			{ key: { remoteJid: 'chat@s.whatsapp.net', fromMe: false }, message: { conversation: 'hello' } },
			{
				key: { remoteJid: 'chat@s.whatsapp.net', fromMe: false },
				message: { reactionMessage: { key: { id: 'quoted' }, text: '👍' } }
			},
			{
				key: { remoteJid: 'chat@s.whatsapp.net', fromMe: false },
				message: { senderKeyDistributionMessage: {} }
			},
			{
				key: { remoteJid: 'chat@s.whatsapp.net', fromMe: false },
				messageStubType: WAMessageStubType.CALL_MISSED_VOICE
			}
		]
		const upstreamIsRealMessage = upstream.isRealMessage as unknown as typeof isRealMessage
		const upstreamShouldIncrement = upstream.shouldIncrementChatUnread as unknown as typeof shouldIncrementChatUnread
		for (const message of messages) {
			assert.equal(isRealMessage(message), upstreamIsRealMessage(message))
			assert.equal(shouldIncrementChatUnread(message), upstreamShouldIncrement(message))
		}

		const keys = [
			{ remoteJid: 'chat@s.whatsapp.net', fromMe: false },
			{ remoteJid: 'status@broadcast', participant: 'peer@s.whatsapp.net', fromMe: false },
			{ remoteJid: 'list@broadcast', participant: 'peer@s.whatsapp.net', fromMe: false },
			{ remoteJid: 'list@broadcast', participant: 'peer@s.whatsapp.net', fromMe: true }
		]
		for (const key of keys) assert.equal(getChatId(key), upstream.getChatId(key))

		for (const key of [{}, { remoteJid: 'list@broadcast', fromMe: false }]) {
			let localError: unknown
			let remoteError: unknown
			try {
				getChatId(key)
			} catch (error) {
				localError = error
			}
			try {
				upstream.getChatId(key)
			} catch (error) {
				remoteError = error
			}
			assert.equal((localError as Error).message, (remoteError as Error).message)
			assert.deepEqual((localError as { data: unknown }).data, (remoteError as { data: unknown }).data)
		}
	})

	it('decrypts real poll and event payloads exactly like upstream', async () => {
		const upstream = await import('baileys')
		const iv = Buffer.from('11'.repeat(12), 'hex')
		const encrypt = (plain: Uint8Array, key: Uint8Array, signParts: string[], aad: string) => {
			const sign = Buffer.concat([...signParts.map(part => Buffer.from(part)), new Uint8Array([1])])
			const key0 = hmacSign(key, new Uint8Array(32), 'sha256')
			const decKey = hmacSign(sign, key0, 'sha256')
			return aesEncryptGCM(plain, decKey, iv, Buffer.from(aad))
		}

		const pollContext = {
			pollCreatorJid: 'creator@s.whatsapp.net',
			pollMsgId: 'POLL-1',
			pollEncKey: Buffer.from('22'.repeat(32), 'hex'),
			voterJid: 'voter@s.whatsapp.net'
		}
		const pollPlain = proto.Message.PollVoteMessage.encode({
			selectedOptions: [Buffer.from('option-a'), Buffer.from('option-b')]
		}).finish()
		const pollPayload = encrypt(
			pollPlain,
			pollContext.pollEncKey,
			[pollContext.pollMsgId, pollContext.pollCreatorJid, pollContext.voterJid, 'Poll Vote'],
			`${pollContext.pollMsgId}\0${pollContext.voterJid}`
		)
		const localPoll = decryptPollVote({ encPayload: pollPayload, encIv: iv }, pollContext)
		const remotePoll = upstream.decryptPollVote({ encPayload: pollPayload, encIv: iv }, pollContext)
		assert.deepEqual(
			localPoll.selectedOptions!.map(value => [...value]),
			remotePoll.selectedOptions.map(value => [...value])
		)

		const eventContext = {
			eventCreatorJid: 'creator@s.whatsapp.net',
			eventMsgId: 'EVENT-1',
			eventEncKey: Buffer.from('33'.repeat(32), 'hex'),
			responderJid: 'responder@s.whatsapp.net'
		}
		const eventPlain = proto.Message.EventResponseMessage.encode({
			response: proto.Message.EventResponseMessage.EventResponseType.GOING,
			timestampMs: 1234,
			extraGuestCount: 2
		}).finish()
		const eventPayload = encrypt(
			eventPlain,
			eventContext.eventEncKey,
			[eventContext.eventMsgId, eventContext.eventCreatorJid, eventContext.responderJid, 'Event Response'],
			`${eventContext.eventMsgId}\0${eventContext.responderJid}`
		)
		const localEvent = decryptEventResponse({ encPayload: eventPayload, encIv: iv }, eventContext)
		const remoteEvent = upstream.decryptEventResponse({ encPayload: eventPayload, encIv: iv }, eventContext)
		assert.deepEqual(
			{
				response: localEvent.response,
				timestampMs: Number(localEvent.timestampMs),
				extraGuestCount: localEvent.extraGuestCount
			},
			{
				response: remoteEvent.response,
				timestampMs: Number(remoteEvent.timestampMs),
				extraGuestCount: remoteEvent.extraGuestCount
			}
		)
	})
})
