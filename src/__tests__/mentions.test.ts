import { describe, it } from 'node:test'
import { generateWAMessageContent } from '../Utils/messages.ts'
import { expect } from './expect.ts'

/**
 * Regression: mentions weren't reaching `contextInfo.mentionedJid` for plain
 * text messages because the legacy guard `'contextInfo' in key` is `false` on
 * the freshly-created `{ text: '...' }` object the generator produces — its
 * `contextInfo` slot exists in the proto schema but isn't an own property
 * yet. WhatsApp clients receiving the message saw `@123` as plain text
 * instead of a clickable mention. Match upstream Baileys' behavior: always
 * create `contextInfo` if absent, then merge the mention payload.
 */
describe('generateWAMessageContent — mentions', () => {
	const noopOptions = { logger: undefined, waClient: undefined as never }

	it('attaches mentionedJid to extendedTextMessage.contextInfo for plain text', async () => {
		const m = await generateWAMessageContent(
			{ text: 'Boa madrugada @271060335329480', mentions: ['271060335329480@lid'] },
			noopOptions
		)
		expect(m.extendedTextMessage).toBeDefined()
		expect(m.extendedTextMessage?.contextInfo).toBeDefined()
		expect(m.extendedTextMessage?.contextInfo?.mentionedJid).toEqual(['271060335329480@lid'])
	})

	it('preserves both PN and LID JID forms verbatim', async () => {
		const m = await generateWAMessageContent(
			{
				text: '@559984726662 @271060335329480',
				mentions: ['559984726662@s.whatsapp.net', '271060335329480@lid']
			},
			noopOptions
		)
		expect(m.extendedTextMessage?.contextInfo?.mentionedJid).toEqual([
			'559984726662@s.whatsapp.net',
			'271060335329480@lid'
		])
	})

	it('sets nonJidMentions=1 when mentionAll is requested', async () => {
		const m = await generateWAMessageContent({ text: '@everyone — heads up', mentionAll: true }, noopOptions)
		expect(m.extendedTextMessage?.contextInfo?.nonJidMentions).toBe(1)
	})

	it('combines mentions + mentionAll on the same message', async () => {
		const m = await generateWAMessageContent(
			{
				text: 'cc @123 — and @everyone',
				mentions: ['123@s.whatsapp.net'],
				mentionAll: true
			},
			noopOptions
		)
		const ci = m.extendedTextMessage?.contextInfo
		expect(ci?.mentionedJid).toEqual(['123@s.whatsapp.net'])
		expect(ci?.nonJidMentions).toBe(1)
	})

	it('leaves contextInfo untouched when no mention is supplied', async () => {
		const m = await generateWAMessageContent({ text: 'hello' }, noopOptions)
		// Without mentions, the generator should not invent a contextInfo.
		expect(m.extendedTextMessage?.contextInfo?.mentionedJid).toBeUndefined()
		expect(m.extendedTextMessage?.contextInfo?.nonJidMentions).toBeUndefined()
	})

	it('survives mentions: [] (treated as no mentions)', async () => {
		const m = await generateWAMessageContent({ text: 'hi', mentions: [] }, noopOptions)
		expect(m.extendedTextMessage?.contextInfo?.mentionedJid).toBeUndefined()
	})
})
