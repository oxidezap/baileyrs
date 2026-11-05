import assert from 'node:assert/strict'
import { test, describe } from 'vitest'
import { proto } from '../../src/index.ts'
import { adaptBridgeMessageWire } from '../../src/Bridge/adapt.ts'
import { generateWAMessageFromContent } from '../../src/Utils/messages.ts'
import { options } from '../options.ts'

const jid = '5511900000001@s.whatsapp.net'
const metadata = {
	chat: jid,
	id: 'BENCH0001',
	timestamp: 1_700_000_000,
	isFromMe: false,
	isGroup: false,
	sender: jid,
	pushName: 'Benchmark',
	isViewOnce: false,
	isOffline: false
}
const timestamp = new Date(1_700_000_000_000)

for (const size of [64, 4096]) {
	describe(`message/${size}B`, () => {
		const message = { conversation: 'x'.repeat(size) }
		const wire = proto.Message.encode(message).finish()
		assert.equal(proto.Message.decode(wire).conversation, message.conversation)
		assert.equal(adaptBridgeMessageWire(message, metadata)?.id, metadata.id)

		test('outgoing envelope and encode', async ({ bench }) => {
			await bench('outgoing envelope and encode', () => {
				const generated = generateWAMessageFromContent(
					jid,
					{ ...message },
					{
						userJid: '5511900000002@s.whatsapp.net',
						messageId: 'BENCH0002',
						timestamp
					}
				)
				proto.WebMessageInfo.encode(generated).finish()
			}).run(options)
		})
		test('incoming decode and adapt', async ({ bench }) => {
			await bench('incoming decode and adapt', () => {
				const decoded = proto.Message.decode(wire)
				if (!adaptBridgeMessageWire(decoded, metadata)) throw new Error('message was dropped')
			}).run(options)
		})
		test('protobuf encode', async ({ bench }) => {
			await bench('protobuf encode', () => {
				proto.Message.encode(message).finish()
			}).run(options)
		})
		test('protobuf decode', async ({ bench }) => {
			await bench('protobuf decode', () => {
				proto.Message.decode(wire)
			}).run(options)
		})
	})
}
