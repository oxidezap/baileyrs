import { options as benchmarkOptions } from '../benchmarks/options.ts'
import { test, describe } from 'vitest'
import { adaptBridgeEvent } from '../src/Bridge/adapt.ts'
import type { WAMessage } from '../src/Types/index.ts'
import { makeEventBuffer } from '../src/Utils/index.ts'
import { silentLogger } from './fixtures.ts'

const bridgeMessages = Array.from({ length: 500 }, (_, i) => ({
	type: 'message',
	data: {
		message: { extendedTextMessage: { text: `message ${i}`, contextInfo: { stanzaId: `Q${i}` } } },
		info: {
			id: `3EB0${String(i).padStart(16, '0')}`,
			timestamp: 1_734_000_000 + i,
			push_name: 'alice',
			source: {
				chat:
					i % 2 === 0
						? { user: '120363040237990503', server: 'g.us' }
						: { user: '5511999990000', server: 's.whatsapp.net' },
				sender: { user: String(5_511_900_000_000 + i), server: 's.whatsapp.net' },
				sender_alt: { user: String(100_000_000_000_000 + i), server: 'lid' },
				is_from_me: false,
				is_group: i % 2 === 0
			}
		}
	}
}))

const upserts: WAMessage[] = Array.from({ length: 500 }, (_, i) => ({
	key: { remoteJid: `${5_511_900_000_000 + (i % 25)}@s.whatsapp.net`, fromMe: i % 3 === 0, id: `ID${i}` },
	message: { conversation: `message ${i}` },
	messageTimestamp: 1_734_000_000 + i,
	pushName: 'alice'
}))

const updates = upserts.map(({ key }) => ({ key, update: { status: 3 } }))

describe('event pipeline (500 messages)', () => {
	test('adaptBridgeEvent (message)', async ({ bench }) => {
		await bench('adaptBridgeEvent (message)', () => {
			for (const event of bridgeMessages) {
				if (adaptBridgeEvent(event as never, silentLogger)?.type !== 'message') throw new Error('message was dropped')
			}
		}).run(benchmarkOptions)
	})

	test('event buffer: buffer + flush upserts and updates', async ({ bench }) => {
		await bench('event buffer: buffer + flush upserts and updates', () => {
			const ev = makeEventBuffer(silentLogger)
			let delivered = 0
			ev.process(events => {
				delivered += events['messages.upsert']?.messages.length ?? 0
			})
			ev.buffer()
			for (const message of upserts) ev.emit('messages.upsert', { messages: [message], type: 'notify' })
			ev.emit('messages.update', updates)
			ev.flush()
			if (delivered !== upserts.length) throw new Error('incomplete event buffer delivery')
		}).run(benchmarkOptions)
	})
})
