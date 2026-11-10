import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WAMessageKey } from '../../Types/index.ts'
import { receiptMessageKeys } from '../message-keys.ts'

describe('receipt message-key projection', () => {
	it('keeps only complete incoming keys and preserves the participant', () => {
		const keys: WAMessageKey[] = [
			{ remoteJid: 'chat-a@g.us', id: 'message-a', participant: 'member@lid', fromMe: false },
			{ remoteJid: 'chat-b@s.whatsapp.net', id: 'message-b' },
			{ remoteJid: 'chat-c@s.whatsapp.net', id: 'outgoing', fromMe: true },
			{ remoteJid: null, id: 'missing-chat' },
			{ remoteJid: 'chat-d@s.whatsapp.net', id: null }
		]

		assert.deepEqual(receiptMessageKeys(keys), [
			{ remoteJid: 'chat-a@g.us', id: 'message-a', participant: 'member@lid' },
			{ remoteJid: 'chat-b@s.whatsapp.net', id: 'message-b' }
		])
	})
})
