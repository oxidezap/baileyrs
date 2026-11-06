import { memoryMode, options as benchmarkOptions, opsPerSample, repeat } from '../benchmarks/options.ts'
import { createHash } from 'node:crypto'
import { test, describe } from 'vitest'
import type { WAMessage, WAMessageContent } from '../src/Types/index.ts'
import {
	extractMessageContent,
	generateWAMessageFromContent,
	getAggregateVotesInPollMessage,
	getContentType,
	normalizeMessageContent
} from '../src/Utils/index.ts'

const optionHash = (name: string) => new Uint8Array(createHash('sha256').update(name).digest())

const contents: WAMessageContent[] = [
	{ conversation: 'hi' },
	{ extendedTextMessage: { text: 'hello', contextInfo: { stanzaId: 'ABC' } } },
	{ messageContextInfo: {}, imageMessage: { caption: 'img' } },
	{ ephemeralMessage: { message: { viewOnceMessageV2: { message: { videoMessage: { caption: 'v' } } } } } },
	{ senderKeyDistributionMessage: {}, reactionMessage: { text: '+1' } },
	{ buttonsMessage: { contentText: 'pick one', imageMessage: { caption: 'b' } } },
	{ templateMessage: { hydratedTemplate: { hydratedContentText: 'template' } } },
	{ documentWithCaptionMessage: { message: { documentMessage: { caption: 'doc' } } } }
]
const batch = Array.from({ length: 1000 }, (_, i) => contents[i % contents.length]!)

const options = Array.from({ length: 12 }, (_, i) => ({ optionName: `Option ${i}` }))
const pollMessage: Pick<WAMessage, 'pollUpdates' | 'message'> = {
	message: { pollCreationMessage: { name: 'Poll', options, selectableOptionsCount: 0 } },
	pollUpdates: Array.from({ length: 200 }, (_, i) => ({
		pollUpdateMessageKey: { remoteJid: '120@g.us', fromMe: false, id: `V${i}`, participant: `${1000 + i}@lid` },
		vote: { selectedOptions: [optionHash(`Option ${i % 12}`), optionHash(`Option ${(i + 5) % 12}`)] }
	}))
}

describe('message content helpers (1000 messages)', () => {
	test('getContentType', async ({ bench }) => {
		await bench('getContentType', () => {
			for (const content of batch) getContentType(content)
		}).run(benchmarkOptions)
	})

	test('normalizeMessageContent', async ({ bench }) => {
		await bench('normalizeMessageContent', () => {
			for (const content of batch) normalizeMessageContent(content)
		}).run(benchmarkOptions)
	})

	test('extractMessageContent', async ({ bench }) => {
		await bench('extractMessageContent', () => {
			for (const content of batch) extractMessageContent(content)
		}).run(benchmarkOptions)
	})
})

describe('message generation', () => {
	test.skipIf(memoryMode)(`generateWAMessageFromContent x${opsPerSample}`, async ({ bench }) => {
		await bench(`generateWAMessageFromContent x${opsPerSample}`, () => {
			repeat(() => {
				generateWAMessageFromContent(
					'5511999990000@s.whatsapp.net',
					{ extendedTextMessage: { text: 'hello world', contextInfo: { stanzaId: 'ABC' } } },
					{ userJid: '5511888880000@s.whatsapp.net', timestamp: new Date(1_734_000_000_000) }
				)
			})
		}).run(benchmarkOptions)
	})

	test('getAggregateVotesInPollMessage (12 options, 200 votes)', async ({ bench }) => {
		await bench('getAggregateVotesInPollMessage (12 options, 200 votes)', () => {
			getAggregateVotesInPollMessage(pollMessage, '5511888880000@s.whatsapp.net')
		}).run(benchmarkOptions)
	})
})
