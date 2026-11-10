/**
 * `generateForwardMessageContent` must not write into its argument.
 *
 * Found by the pure-helper differential: baileyrs shallow-cloned the outer
 * message map with `{ ...content }` and then assigned `contextInfo` onto the
 * *nested* message object, which the clone still shares with the caller. And it
 * replaced rather than merged, so forwarding a quoted message stripped
 * `stanzaId` and `participant` from the caller's own object. Upstream leaves the
 * argument untouched, because it copies through
 * `proto.Message.decode(proto.Message.encode(content))`.
 *
 * The fix rebuilds only the one nested object being written, rather than paying
 * for that round trip on a hot send path — so these tests pin both halves: the
 * argument survives, and the copy stays shallow everywhere else.
 */

import { describe, it } from 'node:test'
import { generateForwardMessageContent } from '../Utils/messages.ts'
import type { WAMessage } from '../Types/index.ts'
import { expect } from './expect.ts'

const incoming = (message: unknown): WAMessage =>
	({ key: { fromMe: false, remoteJid: 'a@s.whatsapp.net', id: '1' }, message }) as WAMessage

describe('generateForwardMessageContent — the caller keeps their message', () => {
	it('leaves a quoted message intact rather than replacing its contextInfo', () => {
		const original = incoming({
			extendedTextMessage: {
				text: 'x',
				contextInfo: { stanzaId: 'abc', participant: 'a@s.whatsapp.net' }
			}
		})

		const forwarded = generateForwardMessageContent(original)

		// The reproducer from the finding: these two used to be gone afterwards.
		expect(original.message?.extendedTextMessage?.contextInfo?.stanzaId).toBe('abc')
		expect(original.message?.extendedTextMessage?.contextInfo?.participant).toBe('a@s.whatsapp.net')
		// And the forwarding metadata went somewhere else entirely.
		expect(forwarded.extendedTextMessage?.contextInfo).toEqual({ forwardingScore: 1, isForwarded: true })
	})

	it('does not hand back the caller’s nested object', () => {
		const inner = { text: 'x', contextInfo: { stanzaId: 'abc' } }
		const original = incoming({ extendedTextMessage: inner })

		const forwarded = generateForwardMessageContent(original)

		// Not identity-equal: writing through either one must not reach the other.
		expect(forwarded.extendedTextMessage === inner).toBe(false)
		expect(inner.contextInfo).toEqual({ stanzaId: 'abc' })
	})

	it('carries the rest of the nested fields across unchanged', () => {
		const original = incoming({
			imageMessage: { url: 'https://x', mimetype: 'image/jpeg', fileLength: 12, caption: 'hi' }
		})

		const forwarded = generateForwardMessageContent(original)

		expect(forwarded.imageMessage?.url).toBe('https://x')
		expect(forwarded.imageMessage?.mimetype).toBe('image/jpeg')
		expect(forwarded.imageMessage?.caption).toBe('hi')
		expect(forwarded.imageMessage?.contextInfo).toEqual({ forwardingScore: 1, isForwarded: true })
	})

	it('accumulates the forwarding score without touching the source', () => {
		const original = incoming({
			extendedTextMessage: { text: 'x', contextInfo: { forwardingScore: 4, isForwarded: true } }
		})

		const forwarded = generateForwardMessageContent(original)

		expect(forwarded.extendedTextMessage?.contextInfo?.forwardingScore).toBe(5)
		expect(original.message?.extendedTextMessage?.contextInfo?.forwardingScore).toBe(4)
	})

	it('rewrites a conversation into an extendedTextMessage, leaving the original', () => {
		const original = incoming({ conversation: 'hello' })

		const forwarded = generateForwardMessageContent(original)

		expect(forwarded.extendedTextMessage?.text).toBe('hello')
		expect(forwarded.extendedTextMessage?.contextInfo).toEqual({ forwardingScore: 1, isForwarded: true })
		expect(forwarded.conversation).toBe(undefined)
		// The caller still has the conversation they passed in.
		expect(original.message?.conversation).toBe('hello')
	})

	it('scores an outgoing message at zero unless forwarding is forced', () => {
		const own = { key: { fromMe: true, remoteJid: 'a@s.whatsapp.net', id: '1' }, message: { conversation: 'x' } }

		expect(generateForwardMessageContent(own as WAMessage).extendedTextMessage?.contextInfo).toEqual({})
		expect(generateForwardMessageContent(own as WAMessage, true).extendedTextMessage?.contextInfo).toEqual({
			forwardingScore: 1,
			isForwarded: true
		})
		expect(own.message.conversation).toBe('x')
	})

	/**
	 * A message with no content key at all reaches the nested assignment with
	 * nothing to assign to. Upstream raises a TypeError here and so does this —
	 * an earlier version of the fix spread the absent slot instead and invented a
	 * property literally named `"undefined"`, which the differential caught.
	 */
	it('throws on an empty message rather than inventing a key', () => {
		expect(() => generateForwardMessageContent(incoming({}))).toThrow()
	})
})
