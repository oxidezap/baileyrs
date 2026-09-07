import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { proto as upstreamProto } from 'baileys'
import { decodeProto, encodeProto, type WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeContactMethods } from '../Socket/contacts.ts'
import { makeGroupMethods } from '../Socket/groups.ts'
import { makeMessageMethods } from '../Socket/messages.ts'
import { makeProfileMethods } from '../Socket/profile.ts'
import type { WithClientSocketContext as SocketContext } from '../Socket/types.ts'
import type { WAProto } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'

const logger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as ILogger

const makeContext = (client: Partial<WasmWhatsAppClient>): SocketContext =>
	({
		ev: Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		}),
		logger,
		getUser: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		getMe: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) =>
			operation((await (client as WasmWhatsAppClient)) as MockClient)
	}) as unknown as SocketContext

/**
 * Runtime-faithful raw group-payment payload from an untyped caller.
 *
 * The strings used for uint64 fields intentionally mirror untyped callers:
 * protobufjs accepts them and preserves the full integer range at runtime.
 */
const rawGroupPaymentRequest = {
	requestPaymentMessage: {
		currencyCodeIso4217: 'BRL',
		amount1000: '1000',
		noteMessage: {
			extendedTextMessage: {
				text: 'teste',
				contextInfo: {
					mentionedJid: ['5511999999999@s.whatsapp.net', '123456789012345@lid'],
					forwardingScore: 999,
					isForwarded: true
				}
			}
		},
		expiryTimestamp: '0',
		amount: {
			value: '1000',
			offset: 1000,
			currencyCode: 'BRL'
		}
	}
} as const

type GroupPaymentReceiver = Exclude<
	NonNullable<WAProto.IMessage['requestPaymentMessage']>['requestFrom'],
	null | undefined
>

const groupPaymentReceiver = '15550000001@s.whatsapp.net' as const satisfies GroupPaymentReceiver

const groupPaymentRequestWithReceiver = {
	requestPaymentMessage: {
		...rawGroupPaymentRequest.requestPaymentMessage,
		requestFrom: groupPaymentReceiver
	}
} as const

const upstreamMessageObject = (bytes: Uint8Array): Record<string, unknown> =>
	upstreamProto.Message.toObject(upstreamProto.Message.decode(bytes), {
		longs: Number,
		enums: Number,
		bytes: Uint8Array,
		defaults: false,
		arrays: false,
		objects: false,
		oneofs: false
	}) as Record<string, unknown>

describe('high-value socket boundary compatibility', () => {
	it('cross-decodes a raw group-payment payload exactly like upstream', () => {
		const localBytes = encodeProto('Message', rawGroupPaymentRequest)
		const upstreamBytes = upstreamProto.Message.encode(
			upstreamProto.Message.fromObject(rawGroupPaymentRequest)
		).finish()
		const expected = upstreamMessageObject(upstreamBytes)

		// Protobuf field order is not semantic. Both encoders may emit a different
		// order, so the durable contract is cross-decoding to the same message.
		assert.deepEqual(upstreamMessageObject(localBytes), expected)
		assert.deepEqual(decodeProto('Message', localBytes), decodeProto('Message', upstreamBytes))
	})

	it('distinguishes wire-valid input from the contextual group-payment receiver contract', () => {
		assert.equal('requestFrom' in rawGroupPaymentRequest.requestPaymentMessage, false)

		const localBytes = encodeProto('Message', groupPaymentRequestWithReceiver)
		const upstreamBytes = upstreamProto.Message.encode(
			upstreamProto.Message.fromObject(groupPaymentRequestWithReceiver)
		).finish()
		const localDecoded = upstreamMessageObject(localBytes)
		const upstreamDecoded = upstreamMessageObject(upstreamBytes)

		assert.deepEqual(localDecoded, upstreamDecoded)
		assert.equal(
			(localDecoded.requestPaymentMessage as { requestFrom?: string }).requestFrom,
			groupPaymentRequestWithReceiver.requestPaymentMessage.requestFrom
		)
	})

	it('relays receiver-omitted and receiver-present payloads without changing their fields', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			relayMessageBytesWithOptions: async (...args) => {
				calls.push(args)
				return args[2] as string
			}
		})
		const cases = [
			{ payload: rawGroupPaymentRequest, expectedReceiver: undefined },
			{
				payload: groupPaymentRequestWithReceiver,
				expectedReceiver: groupPaymentRequestWithReceiver.requestPaymentMessage.requestFrom
			}
		] as const

		for (const [index, relayCase] of cases.entries()) {
			const input = structuredClone(relayCase.payload) as unknown as WAProto.IMessage
			const result = await makeMessageMethods(ctx).relayMessage('120363000000000000@g.us', input, {})
			const call = calls[index]

			assert.match(result, /^3EB0[0-9A-F]{18}$/)
			assert.equal(call?.[0], '120363000000000000@g.us')
			assert.equal(call?.[2], result)
			assert.deepEqual(call?.slice(3), [[], false, false])

			const relayedBytes = call?.[1]
			assert.ok(relayedBytes instanceof Uint8Array)
			const encodedInput = encodeProto('Message', relayCase.payload)
			assert.deepEqual(relayedBytes, encodedInput)
			assert.deepEqual(upstreamMessageObject(relayedBytes), upstreamMessageObject(encodedInput))
			assert.deepEqual(decodeProto('Message', relayedBytes), decodeProto('Message', encodedInput))

			// relayMessage is a raw-proto API in both implementations: it must
			// preserve a receiver supplied by the caller and must not invent one.
			assert.equal(input.requestPaymentMessage?.requestFrom, relayCase.expectedReceiver)
			assert.equal(
				(upstreamMessageObject(relayedBytes).requestPaymentMessage as { requestFrom?: string }).requestFrom,
				relayCase.expectedReceiver
			)
		}
		assert.equal(calls.length, cases.length)
	})

	it('returns the actual low-level relay message id', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			relayMessageBytesWithOptions: async (...args) => {
				calls.push(args)
				return 'wire-message-id'
			}
		})

		const result = await makeMessageMethods(ctx).relayMessage(
			'member@s.whatsapp.net',
			{ conversation: 'hello' },
			{ messageId: 'wire-message-id' }
		)

		assert.equal(result, 'wire-message-id')
		assert.equal(calls.length, 1)
		assert.equal(calls[0]?.[0], 'member@s.whatsapp.net')
		assert.ok(calls[0]?.[1] instanceof Uint8Array)
		assert.equal(calls[0]?.[2], 'wire-message-id')
		assert.deepEqual(calls[0]?.slice(3), [[], false, false])
	})

	it('translates relay nodes and cache policies into typed bridge controls', async () => {
		const calls: unknown[][] = []
		const extraNode = { tag: 'meta', attrs: { source: 'test' } }
		const ctx = makeContext({
			relayMessageBytesWithOptions: async (...args) => {
				calls.push(args)
				return 'custom-id'
			}
		})

		const result = await makeMessageMethods(ctx).relayMessage(
			'group@g.us',
			{ conversation: 'hello' },
			{
				messageId: 'custom-id',
				additionalNodes: [extraNode],
				useCachedGroupMetadata: false,
				useUserDevicesCache: false
			}
		)

		assert.equal(result, 'custom-id')
		assert.equal(calls.length, 1)
		assert.deepEqual(calls[0]?.slice(2), ['custom-id', [extraNode], true, true])
	})

	it('preserves status relay controls and the caller-provided message id', async () => {
		const calls: unknown[][] = []
		const extraNode = { tag: 'meta', attrs: {} }
		const ctx = makeContext({
			sendStatusMessageBytesWithOptions: async (...args) => {
				calls.push(args)
				return 'status-id'
			}
		})

		const result = await makeMessageMethods(ctx).relayMessage(
			'status@broadcast',
			{ conversation: 'hello' },
			{
				messageId: 'status-id',
				statusJidList: ['member@s.whatsapp.net'],
				additionalNodes: [extraNode],
				useUserDevicesCache: false
			}
		)

		assert.equal(result, 'status-id')
		assert.ok(calls[0]?.[0] instanceof Uint8Array)
		assert.deepEqual(calls[0]?.slice(1), [['member@s.whatsapp.net'], 'status-id', [extraNode], true])
	})

	it('uses the typed retransmission operation and preserves self-device routing', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			retransmitMessageBytes: async (...args) => {
				calls.push(args)
			}
		})
		const methods = makeMessageMethods(ctx)

		const groupId = await methods.relayMessage(
			'group@g.us',
			{ conversation: 'group retry' },
			{ participant: { jid: 'member:2@lid', count: 3 }, useCachedGroupMetadata: false }
		)
		const directId = await methods.relayMessage(
			'member@s.whatsapp.net',
			{ conversation: 'self retry' },
			{ messageId: 'direct-id', participant: { jid: '15550000000:1@s.whatsapp.net', count: 1 } }
		)
		const statusId = await methods.relayMessage(
			'status@broadcast',
			{ conversation: 'status retry' },
			{ messageId: 'status-retry-id', participant: { jid: 'viewer:3@lid', count: 2 } }
		)

		assert.match(groupId, /^3EB0[0-9A-F]{18}$/)
		assert.equal(calls[0]?.[0], 'group@g.us')
		assert.ok(calls[0]?.[1] instanceof Uint8Array)
		assert.deepEqual(calls[0]?.[2], {
			requesterJid: 'member:2@lid',
			messageId: groupId,
			retryCount: 3,
			refreshGroupMetadata: true
		})
		assert.equal(directId, 'direct-id')
		assert.deepEqual(calls[1]?.[2], {
			requesterJid: '15550000000:1@s.whatsapp.net',
			messageId: 'direct-id',
			retryCount: 1,
			recipientJid: 'member@s.whatsapp.net',
			refreshGroupMetadata: false
		})
		assert.equal(statusId, 'status-retry-id')
		assert.deepEqual(calls[2]?.[2], {
			requesterJid: 'viewer:3@lid',
			messageId: 'status-retry-id',
			retryCount: 2,
			refreshGroupMetadata: false
		})
	})

	it('rejects relay controls that lack an equivalent typed operation', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			retransmitMessageBytes: async (...args) => {
				calls.push(args)
			}
		})
		const methods = makeMessageMethods(ctx)

		await assert.rejects(
			methods.relayMessage(
				'group@g.us',
				{ conversation: 'hello' },
				{
					participant: { jid: 'member@lid', count: 1 },
					additionalNodes: [{ tag: 'meta', attrs: {} }]
				}
			),
			/targeted retransmission/
		)
		await assert.rejects(
			methods.relayMessage(
				'member@s.whatsapp.net',
				{ conversation: 'hello' },
				{
					additionalAttributes: { category: 'peer' }
				}
			),
			/additional attribute 'category'/
		)
		assert.equal(calls.length, 0)
	})

	it('forwards the profile-picture timeout and projects an absent result', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			profilePictureUrl: async (...args) => {
				calls.push(args)
				return undefined
			}
		})

		assert.equal(await makeContactMethods(ctx).profilePictureUrl('member@lid', 'image', 1_234), undefined)
		assert.deepEqual(calls, [['member@lid', 'image', 1_234]])
	})

	it('returns the member-label message id and applies the public 30-character limit', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			updateMemberLabel: async (...args) => {
				calls.push(args)
				return 'message-id'
			}
		})

		const result = await makeGroupMethods(ctx).updateMemberLabel('group@g.us', 'x'.repeat(35))
		assert.equal(result, 'message-id')
		assert.deepEqual(calls, [['group@g.us', 'x'.repeat(30)]])
	})

	it('routes profile-picture removals to group or self and returns void', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			removeGroupProfilePicture: async (...args) => {
				calls.push(['group', ...args])
				return { id: 'group-picture' }
			},
			removeProfilePicture: async (...args) => {
				calls.push(['self', ...args])
				return { id: 'self-picture' }
			}
		})
		const methods = makeProfileMethods(ctx)

		assert.equal(await methods.removeProfilePicture('group@g.us'), undefined)
		assert.equal(await methods.removeProfilePicture('15550000000@s.whatsapp.net'), undefined)
		assert.equal(await methods.removeProfilePicture('member@lid'), undefined)
		assert.deepEqual(calls, [['group', 'group@g.us'], ['self'], ['self']])
		await assert.rejects(methods.removeProfilePicture(''), /Illegal no-jid profile update/)
	})

	it('processes profile-picture media and targets groups only', async () => {
		const calls: unknown[][] = []
		const ctx = makeContext({
			setGroupProfilePicture: async (...args) => {
				calls.push(['group', ...args])
				return { id: 'group-picture' }
			},
			updateProfilePicture: async (...args) => {
				calls.push(['self', ...args])
				return { id: 'self-picture' }
			}
		})
		const methods = makeProfileMethods(ctx)
		const onePixelPng = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			'base64'
		)

		assert.equal(await methods.updateProfilePicture('group@g.us', onePixelPng, { width: 2, height: 2 }), undefined)
		assert.equal(await methods.updateProfilePicture('member@lid', onePixelPng, { width: 2, height: 2 }), undefined)
		const groupCall = calls[0]
		const selfCall = calls[1]
		assert.ok(groupCall)
		assert.ok(selfCall)
		assert.equal(groupCall[0], 'group')
		assert.equal(groupCall[1], 'group@g.us')
		assert.ok((groupCall[2] as Uint8Array).byteLength)
		assert.equal(selfCall[0], 'self')
		assert.ok((selfCall[1] as Uint8Array).byteLength)
	})
})
