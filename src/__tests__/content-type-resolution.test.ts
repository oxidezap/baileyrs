import { describe, it } from 'node:test'
import { PROTO_MESSAGE_SCHEMAS } from '../WAProto/compatibility-schema.ts'
import type { WAMessage, WAMessageContent } from '../Types/index.ts'
import { WAProto } from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'
import { generateWAMessageFromContent, getContentType } from '../Utils/messages.ts'
import { expect } from './expect.ts'

/**
 * `getContentType` is public API and its answer is positional: it returns the
 * FIRST key in `Object.keys` order that names message content. Anything that
 * makes the lookup cheaper has to keep that choice, so the ambiguous cases are
 * pinned here rather than left to the shape of whatever the decoder happened
 * to produce.
 */

/** Every field of `proto.Message` the helper must NOT report as content. */
const NON_CONTENT_FIELDS = [
	'senderKeyDistributionMessage',
	'call',
	'chat',
	'messageContextInfo',
	'callLogMesssage',
	'messageHistoryBundle',
	'eventCoverImage',
	'statusAddYours',
	'messageHistoryNotice'
]

const MESSAGE_FIELDS = PROTO_MESSAGE_SCHEMAS.find(([path]) => path === 'Message')![1].map(field => field[0])

const asContent = (value: object) => value as WAMessageContent

describe('getContentType — every field of the Message schema', () => {
	it('covers the whole schema, not a sample', () => {
		expect(MESSAGE_FIELDS.length).toBeGreaterThan(90)
		for (const excluded of NON_CONTENT_FIELDS) expect(MESSAGE_FIELDS).toContain(excluded)
	})

	it('reports every content field under its own name', () => {
		const contentFields = MESSAGE_FIELDS.filter(name => !NON_CONTENT_FIELDS.includes(name))
		for (const name of contentFields) {
			expect(getContentType(asContent({ [name]: {} }))).toBe(name as keyof proto.IMessage)
		}
	})

	it('reports nothing for fields that are not user content', () => {
		for (const name of NON_CONTENT_FIELDS) {
			expect(getContentType(asContent({ [name]: {} }))).toBeUndefined()
		}
	})

	it('resolves the same key on messages that came back through the codec', () => {
		const shapes: WAMessageContent[] = [
			{ conversation: 'ping' },
			{ extendedTextMessage: { text: 'pong' } },
			{ reactionMessage: { text: '\u{1F44D}', senderTimestampMs: 1700000000000 } },
			{ protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE } },
			{ imageMessage: { mimetype: 'image/jpeg', caption: 'look' } },
			{ viewOnceMessageV2: { message: { conversation: 'peek' } } }
		]
		for (const shape of shapes) {
			const decoded = WAProto.Message.decode(WAProto.Message.encode(shape).finish()) as WAMessageContent
			expect(getContentType(decoded)).toBe(getContentType(shape))
		}
	})
})

describe('getContentType — more than one candidate field', () => {
	// The predicate matches several fields at once, so the answer depends on key
	// order. Both directions are asserted so a schema-ordered rewrite cannot pass.
	it('returns conversation when conversation was inserted first', () => {
		expect(getContentType(asContent({ conversation: 'hi', imageMessage: {} }))).toBe('conversation')
	})

	it('returns imageMessage when imageMessage was inserted first', () => {
		expect(getContentType(asContent({ imageMessage: {}, conversation: 'hi' }))).toBe('imageMessage')
	})

	it('skips senderKeyDistributionMessage even when it comes first', () => {
		expect(getContentType(asContent({ senderKeyDistributionMessage: {}, conversation: 'hi' }))).toBe('conversation')
	})

	it('keeps insertion order across three candidates', () => {
		expect(getContentType(asContent({ pollUpdateMessage: {}, extendedTextMessage: {}, conversation: 'hi' }))).toBe(
			'pollUpdateMessage'
		)
	})
})

describe('getContentType — nothing to report', () => {
	it('returns undefined for undefined content', () => {
		expect(getContentType(undefined)).toBeUndefined()
	})

	it('returns undefined for an empty object', () => {
		expect(getContentType(asContent({}))).toBeUndefined()
	})

	it('returns undefined when only senderKeyDistributionMessage is present', () => {
		expect(getContentType(asContent({ senderKeyDistributionMessage: {}, messageContextInfo: {} }))).toBeUndefined()
	})

	// A decoded message inherits a default for every field of the schema, so a
	// lookup that walked the prototype chain would report one of those instead of
	// nothing. Only the fields actually set on the instance count.
	it('ignores the schema defaults a decoded message inherits', () => {
		const decoded = WAProto.Message.decode(
			WAProto.Message.encode({ messageContextInfo: {} }).finish()
		) as WAMessageContent
		expect(Object.keys(decoded)).toEqual(['messageContextInfo'])
		expect(getContentType(decoded)).toBeUndefined()
	})
})

/**
 * `generateWAMessageFromContent` resolves the content key only where it is
 * read. These pin the branches that read it, so the deferral cannot quietly
 * drop a quote or an expiration.
 */
describe('generateWAMessageFromContent — content key branches', () => {
	const jid = '5511988888888@s.whatsapp.net'
	const userJid = '5511977777777:1@s.whatsapp.net'
	const quoted = {
		key: { remoteJid: jid, id: 'AABBCCDD11223344', fromMe: false },
		message: { conversation: 'ping' }
	} as unknown as WAMessage

	const textContent = () => WAProto.Message.create({ extendedTextMessage: { text: 'pong' } }) as WAMessageContent

	it('leaves a plain send untouched', () => {
		const wm = generateWAMessageFromContent(jid, textContent(), { userJid })
		expect(wm.message?.extendedTextMessage?.text).toBe('pong')
		expect(wm.message?.extendedTextMessage?.contextInfo).toBeFalsy()
	})

	it('stamps the quote onto the resolved content key', () => {
		const wm = generateWAMessageFromContent(jid, textContent(), { userJid, quoted })
		const ctx = wm.message?.extendedTextMessage?.contextInfo
		expect(ctx?.stanzaId).toBe('AABBCCDD11223344')
		expect(ctx?.quotedMessage?.conversation).toBe('ping')
	})

	it('stamps the expiration onto the resolved content key', () => {
		const wm = generateWAMessageFromContent(jid, textContent(), { userJid, ephemeralExpiration: 86400 })
		expect(wm.message?.extendedTextMessage?.contextInfo?.expiration).toBe(86400)
	})

	// Quote and expiration together share one resolution; both must still land.
	it('stamps quote and expiration together', () => {
		const wm = generateWAMessageFromContent(jid, textContent(), { userJid, quoted, ephemeralExpiration: 604800 })
		const ctx = wm.message?.extendedTextMessage?.contextInfo
		expect(ctx?.stanzaId).toBe('AABBCCDD11223344')
		expect(ctx?.expiration).toBe(604800)
	})

	it('does not make a protocol message disappear', () => {
		const content = WAProto.Message.create({
			protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE }
		}) as WAMessageContent
		const wm = generateWAMessageFromContent(jid, content, { userJid, ephemeralExpiration: 86400 })
		expect((wm.message?.protocolMessage as Record<string, unknown> | undefined)?.contextInfo).toBeFalsy()
	})

	it('does not apply an expiration on newsletters', () => {
		const wm = generateWAMessageFromContent('123456@newsletter', textContent(), {
			userJid,
			ephemeralExpiration: 86400
		})
		expect(wm.message?.extendedTextMessage?.contextInfo).toBeFalsy()
	})
})
