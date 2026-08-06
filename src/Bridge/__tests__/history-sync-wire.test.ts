import { describe, it } from 'node:test'
import type { HistorySyncWireBatch } from '@oxidezap/whatsapp-rust-bridge'
import { proto as WAProto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { ILogger } from '../../Utils/logger.ts'
import { expect } from '../../__tests__/expect.ts'
import { decodeHistorySyncWireBatch } from '../history-sync-wire.ts'

const conversationBytes = (id: string, text: string): Uint8Array =>
	WAProto.Conversation.encode({
		id,
		messages: [
			{
				message: {
					key: { remoteJid: id, fromMe: false, id: `message-${id}` },
					message: { conversation: text },
					messageTimestamp: 1_700_000_000
				}
			}
		]
	}).finish()

const batch = (encodedConversations: readonly Uint8Array[]): HistorySyncWireBatch => {
	const byteLength = encodedConversations.reduce((total, bytes) => total + bytes.length, 0)
	const conversationData = new Uint8Array(byteLength)
	const conversationOffsets = new Uint32Array(encodedConversations.length + 1)
	let offset = 0
	for (let index = 0; index < encodedConversations.length; index++) {
		conversationData.set(encodedConversations[index]!, offset)
		offset += encodedConversations[index]!.length
		conversationOffsets[index + 1] = offset
	}

	return {
		conversationData,
		conversationOffsets,
		syncType: WAProto.HistorySync.HistorySyncType.RECENT,
		chunkOrder: 3,
		progress: 75,
		peerDataRequestSessionId: 'history-session',
		batchIndex: 2,
		isFinalBatch: false
	}
}

const logger = (): { instance: ILogger; warnings: Array<[unknown, string | undefined]> } => {
	const warnings: Array<[unknown, string | undefined]> = []
	const instance: ILogger = {
		level: 'silent',
		child: () => instance,
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: (obj, message) => warnings.push([obj, message]),
		error: () => {}
	}
	return { instance, warnings }
}

describe('decodeHistorySyncWireBatch', () => {
	it('decodes conversations in wire order and preserves batch metadata', () => {
		const { instance } = logger()
		const result = decodeHistorySyncWireBatch(
			batch([conversationBytes('first@s.whatsapp.net', 'one'), conversationBytes('second@s.whatsapp.net', 'two')]),
			instance
		)

		expect(result.skippedConversations).toBe(0)
		expect(result.event.data.conversations?.map(conversation => conversation.id)).toEqual([
			'first@s.whatsapp.net',
			'second@s.whatsapp.net'
		])
		expect(result.event.data).toMatchObject({
			syncType: WAProto.HistorySync.HistorySyncType.RECENT,
			chunkOrder: 3,
			progress: 75,
			peerDataRequestSessionId: 'history-session',
			batchIndex: 2,
			isFinalBatch: false
		})
		expect('conversationData' in result.event.data).toBe(false)
		expect('conversationOffsets' in result.event.data).toBe(false)
	})

	it('skips only a malformed entry and reports its deterministic index', () => {
		const { instance, warnings } = logger()
		const malformedLengthDelimitedField = Uint8Array.of(0x0a, 0x80)
		const result = decodeHistorySyncWireBatch(
			batch([
				conversationBytes('first@s.whatsapp.net', 'one'),
				malformedLengthDelimitedField,
				conversationBytes('third@s.whatsapp.net', 'three')
			]),
			instance
		)

		expect(result.skippedConversations).toBe(1)
		expect(result.event.data.conversations?.map(conversation => conversation.id)).toEqual([
			'first@s.whatsapp.net',
			'third@s.whatsapp.net'
		])
		expect(warnings).toHaveLength(1)
		expect(warnings[0]?.[0]).toMatchObject({ index: 1 })
	})

	it('keeps decoded protobuf objects sparse', () => {
		const { instance } = logger()
		const result = decodeHistorySyncWireBatch(
			batch([conversationBytes('sparse@s.whatsapp.net', 'only-present-fields')]),
			instance
		)
		const message = result.event.data.conversations?.[0]?.messages?.[0]?.message

		expect(message).toBeDefined()
		expect(Object.prototype.hasOwnProperty.call(message, 'labels')).toBe(false)
		expect(Object.prototype.hasOwnProperty.call(message?.message, 'imageMessage')).toBe(false)
	})

	it('does not decode conversation records for sync types that ignore them', () => {
		const { instance, warnings } = logger()
		const result = decodeHistorySyncWireBatch(
			{
				...batch([Uint8Array.of(0x0a, 0x80)]),
				syncType: WAProto.HistorySync.HistorySyncType.NON_BLOCKING_DATA,
				isFinalBatch: true
			},
			instance
		)

		expect(result.skippedConversations).toBe(0)
		expect(result.event.data.conversations).toEqual([])
		expect(result.event.data.syncType).toBe(WAProto.HistorySync.HistorySyncType.NON_BLOCKING_DATA)
		expect(warnings).toHaveLength(0)
	})
})
