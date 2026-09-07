import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { decodeProto, type WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import { makeMessageMethods } from '../Socket/messages.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { WAProto } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

/**
 * `messageContextInfo` is where a caller puts everything the protocol keeps
 * beside the content: the album association that binds each image to its album
 * parent, device list metadata, bot metadata, padding, add-on expiry, and the
 * poll secret. These tests pin the JS side of that: what the send path hands
 * to the bridge client must be what the caller built. The core decides on its
 * own `messageSecret` / `reportingTokenVersion` from there, which is why
 * nothing has to be removed here.
 */

const logger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as ILogger

interface DecodedContextInfo {
	messageAssociation?: {
		associationType?: number
		parentMessageKey?: { id?: string; remoteJid?: string; fromMe?: boolean }
	}
	deviceListMetadata?: { senderKeyHash?: Uint8Array; senderTimestamp?: number }
	deviceListMetadataVersion?: number
	botMetadata?: { personaId?: string }
	paddingBytes?: Uint8Array
	messageAddOnExpiryType?: number
	messageAddOnDurationInSecs?: number
	messageSecret?: Uint8Array
	reportingTokenVersion?: number
}

interface DecodedMessage {
	conversation?: string
	albumMessage?: { expectedImageCount?: number; expectedVideoCount?: number }
	imageMessage?: { url?: string }
	pinInChatMessage?: { key?: { id?: string } }
	messageContextInfo?: DecodedContextInfo
}

const makeCapturingContext = () => {
	// `sendMessage` and `relayMessage` both hand their bytes to the same
	// with-options send, so one capture covers the two describes below.
	const relayed: Uint8Array[] = []
	const client = {
		relayMessageBytesWithOptions: async (_jid: string, bytes: Uint8Array, messageId: string) => {
			relayed.push(bytes)
			return messageId
		}
	} as unknown as WasmWhatsAppClient
	const ctx = {
		ev: Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		}),
		logger,
		fullConfig: { options: {}, emitOwnEvents: false },
		getUser: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		getMe: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) => operation((await client) as MockClient)
	} as unknown as SocketContext
	return { ctx, relayed }
}

const groupJid = '120363000000000000@g.us'

const albumParentKey = {
	remoteJid: groupJid,
	fromMe: true,
	id: 'ACCB5994EBDE5FE23D1ECFDC0E0E7131'
}

const relayDecoded = async (message: WAProto.IMessage): Promise<DecodedMessage> => {
	const { ctx, relayed } = makeCapturingContext()
	await makeMessageMethods(ctx).relayMessage(groupJid, message, { messageId: albumParentKey.id })
	expect(relayed).toHaveLength(1)
	return decodeProto('Message', relayed[0]!) as DecodedMessage
}

const albumChild = (): WAProto.IMessage =>
	({
		imageMessage: { url: 'https://example.invalid/media', mimetype: 'image/jpeg' },
		messageContextInfo: {
			messageAssociation: {
				associationType: proto.MessageAssociation.AssociationType.MEDIA_ALBUM,
				parentMessageKey: albumParentKey
			}
		}
	}) as unknown as WAProto.IMessage

const withContextInfo = (messageContextInfo: Record<string, unknown>): WAProto.IMessage =>
	({ conversation: 'album member', messageContextInfo }) as unknown as WAProto.IMessage

describe('relayMessage: messageContextInfo in the bytes handed to the bridge', () => {
	it('keeps the album association that binds an image to its album parent', async () => {
		const decoded = await relayDecoded(albumChild())
		const association = decoded.messageContextInfo?.messageAssociation
		expect(association?.associationType).toBe(proto.MessageAssociation.AssociationType.MEDIA_ALBUM)
		expect(association?.parentMessageKey?.id).toBe(albumParentKey.id)
		expect(association?.parentMessageKey?.remoteJid).toBe(groupJid)
		expect(association?.parentMessageKey?.fromMe).toBe(true)
	})

	it('keeps deviceListMetadata and its version', async () => {
		const decoded = await relayDecoded(
			withContextInfo({
				deviceListMetadata: { senderKeyHash: new Uint8Array(8).fill(0x0a), senderTimestamp: 1_750_000_000 },
				deviceListMetadataVersion: 2
			})
		)
		expect(decoded.messageContextInfo?.deviceListMetadata?.senderTimestamp).toBe(1_750_000_000)
		expect([...(decoded.messageContextInfo?.deviceListMetadata?.senderKeyHash ?? [])]).toEqual([
			...new Uint8Array(8).fill(0x0a)
		])
		expect(decoded.messageContextInfo?.deviceListMetadataVersion).toBe(2)
	})

	it('keeps botMetadata', async () => {
		const decoded = await relayDecoded(withContextInfo({ botMetadata: { personaId: 'persona-42' } }))
		expect(decoded.messageContextInfo?.botMetadata?.personaId).toBe('persona-42')
	})

	it('keeps paddingBytes', async () => {
		const decoded = await relayDecoded(withContextInfo({ paddingBytes: new Uint8Array([1, 2, 3, 4]) }))
		expect([...(decoded.messageContextInfo?.paddingBytes ?? [])]).toEqual([1, 2, 3, 4])
	})

	it('keeps messageAddOnExpiryType', async () => {
		const decoded = await relayDecoded(
			withContextInfo({ messageAddOnExpiryType: proto.MessageContextInfo.MessageAddonExpiryType.STATIC })
		)
		expect(decoded.messageContextInfo?.messageAddOnExpiryType).toBe(
			proto.MessageContextInfo.MessageAddonExpiryType.STATIC
		)
	})

	it('keeps messageAddOnDurationInSecs on a relayed pin', async () => {
		const decoded = await relayDecoded({
			pinInChatMessage: { key: { id: 'PIN0000000000000000' }, type: proto.PinInChat.Type.PIN_FOR_ALL },
			messageContextInfo: { messageAddOnDurationInSecs: 604800 }
		} as unknown as WAProto.IMessage)
		expect(decoded.messageContextInfo?.messageAddOnDurationInSecs).toBe(604800)
		expect(decoded.pinInChatMessage?.key?.id).toBe('PIN0000000000000000')
	})

	// The core reuses a caller-set secret rather than minting a fresh one, so
	// deleting it here would cost a raw poll the secret it decrypts votes with.
	it('keeps a caller-set messageSecret', async () => {
		const secret = new Uint8Array(32).fill(0xab)
		const decoded = await relayDecoded(withContextInfo({ messageSecret: secret }))
		expect([...(decoded.messageContextInfo?.messageSecret ?? [])]).toEqual([...secret])
	})

	it('leaves a message without messageContextInfo alone', async () => {
		const decoded = await relayDecoded({ conversation: 'no context here' })
		expect(decoded.conversation).toBe('no context here')
		expect(decoded.messageContextInfo).toBeFalsy()
	})

	it('passes an empty messageContextInfo along without inventing fields', async () => {
		const decoded = await relayDecoded(withContextInfo({}))
		expect(decoded.conversation).toBe('album member')
		expect(Object.hasOwn(decoded, 'messageContextInfo')).toBe(true)
		expect(Object.keys(decoded.messageContextInfo ?? {})).toHaveLength(0)
	})

	it('passes a context that holds only bridge-owned fields through untouched', async () => {
		const decoded = await relayDecoded(
			withContextInfo({ messageSecret: new Uint8Array(32).fill(0x11), reportingTokenVersion: 2 })
		)
		expect(decoded.messageContextInfo?.reportingTokenVersion).toBe(2)
		expect([...(decoded.messageContextInfo?.messageSecret ?? [])]).toEqual([...new Uint8Array(32).fill(0x11)])
	})
})

describe('relayMessage: album parent', () => {
	// The album parent carries its counters as content, not context, so it was
	// never at risk. Asserted here to keep the two halves of the album apart:
	// an empty `albumMessage` seen in someone else's quote is not this path.
	it('relays the album counters as sent', async () => {
		const decoded = await relayDecoded({
			albumMessage: { expectedImageCount: 5, expectedVideoCount: 0 }
		} as unknown as WAProto.IMessage)
		expect(decoded.albumMessage?.expectedImageCount).toBe(5)
	})
})

describe('sendMessage: messageContextInfo in the bytes handed to the bridge', () => {
	it('keeps the pin duration generated for a pin', async () => {
		const { ctx, relayed } = makeCapturingContext()
		await makeMessageMethods(ctx).sendMessage(groupJid, {
			pin: { remoteJid: groupJid, fromMe: false, id: 'AABBCCDD11223344' },
			type: proto.PinInChat.Type.PIN_FOR_ALL,
			time: 604800
		})
		expect(relayed).toHaveLength(1)
		const decoded = decodeProto('Message', relayed[0]!) as DecodedMessage
		expect(decoded.messageContextInfo?.messageAddOnDurationInSecs).toBe(604800)
		expect(decoded.pinInChatMessage?.key?.id).toBe('AABBCCDD11223344')
	})
})
