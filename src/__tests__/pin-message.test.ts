import { describe, it } from 'node:test'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import { generateWAMessageContent } from '../Utils/messages.ts'
import { expect } from './expect.ts'

/**
 * Pin message (pinning a message inside a chat) support.
 *
 * The server needs `messageContextInfo.messageAddOnDurationInSecs` to know
 * how long to show the pin banner. Without it the pin either defaults to 24 h
 * on the server side or gets silently ignored depending on the WA build.
 *
 * Regression: `Socket/messages.ts` used to delete ALL of `messageContextInfo`
 * before sending (so the Rust bridge can fill in its own reporting tokens).
 * That also wiped `messageAddOnDurationInSecs` for pin messages — the fix
 * preserves that field while still letting the bridge own the rest.
 */
describe('generateWAMessageContent — pin message', () => {
	const noopOptions = { logger: undefined, waClient: undefined as never }

	const stubKey = {
		remoteJid: '559984726662@s.whatsapp.net',
		fromMe: false,
		id: 'AABBCCDD11223344'
	}

	it('produces pinInChatMessage with PIN_FOR_ALL type', async () => {
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.PIN_FOR_ALL },
			noopOptions
		)
		expect(m.pinInChatMessage).toBeDefined()
		expect(m.pinInChatMessage?.type).toBe(proto.PinInChat.Type.PIN_FOR_ALL)
	})

	it('sets messageAddOnDurationInSecs to 86400 by default (PIN_FOR_ALL, no time)', async () => {
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.PIN_FOR_ALL },
			noopOptions
		)
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(86400)
	})

	it('respects explicit 7-day duration', async () => {
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.PIN_FOR_ALL, time: 604800 },
			noopOptions
		)
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(604800)
	})

	it('respects explicit 30-day duration', async () => {
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.PIN_FOR_ALL, time: 2592000 },
			noopOptions
		)
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(2592000)
	})

	it('sets messageAddOnDurationInSecs to 0 for UNPIN_FOR_ALL', async () => {
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.UNPIN_FOR_ALL },
			noopOptions
		)
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(0)
	})

	it('attaches the original message key to pinInChatMessage.key', async () => {
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.PIN_FOR_ALL },
			noopOptions
		)
		expect(m.pinInChatMessage?.key?.id).toBe(stubKey.id)
		expect(m.pinInChatMessage?.key?.remoteJid).toBe(stubKey.remoteJid)
	})

	it('sets senderTimestampMs to a recent unix-ms value', async () => {
		const before = Date.now()
		const m = await generateWAMessageContent(
			{ pin: stubKey, type: proto.PinInChat.Type.PIN_FOR_ALL },
			noopOptions
		)
		const after = Date.now()
		const ts = m.pinInChatMessage?.senderTimestampMs as number
		expect(ts).toBeGreaterThanOrEqual(before)
		expect(ts).toBeGreaterThanOrEqual(0)
		// sanity: within the window (allow 1 s slack for slow CI)
		expect(ts).toBe(ts <= after + 1000 ? ts : -1)
	})
})
