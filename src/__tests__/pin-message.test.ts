import { describe, it } from 'node:test'
import { decodeProto, encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { WAMessageContent } from '../Types/index.ts'
import { generateWAMessageContent } from '../Utils/messages.ts'
import { expect } from './expect.ts'

/**
 * Pin (`pinInChatMessage`) carries a single load-bearing field in
 * `messageContextInfo.messageAddOnDurationInSecs`:
 *
 *   - 86400  → 24h
 *   - 604800 → 7d
 *   - 2592000 → 30d
 *   - 0       → unpin
 *
 * The Rust bridge fills its own `messageSecret` / `reportingTokenVersion`
 * inside `messageContextInfo` by merging them over what it receives, so the JS
 * side hands the field over untouched and the duration reaches the server.
 *
 * The codec block below encodes/decodes via the bridge so a regression in the
 * proto encoder fails the test; the send path itself is covered in
 * `relay-message-context-info.test.ts`.
 */

const stubKey = {
	remoteJid: '559984726662@s.whatsapp.net',
	fromMe: false,
	id: 'AABBCCDD11223344'
}
const noopOptions = { logger: undefined, waClient: undefined as never }

interface DecodedMessage {
	pinInChatMessage?: {
		key?: { id?: string; remoteJid?: string }
		type?: number
		senderTimestampMs?: number
	}
	messageContextInfo?: { messageAddOnDurationInSecs?: number }
}

type PinTime = 86400 | 604800 | 2592000
function buildPin(extra: { type: proto.PinInChat.Type; time?: PinTime }): Promise<WAMessageContent> {
	return generateWAMessageContent({ pin: stubKey, ...extra }, noopOptions)
}

function bridgeRoundtrip(msg: WAMessageContent): DecodedMessage {
	const bytes = encodeProto('Message', msg as unknown as Record<string, unknown>)
	return decodeProto('Message', bytes) as DecodedMessage
}

describe('generateWAMessageContent — pin message', () => {
	it('produces pinInChatMessage with PIN_FOR_ALL type', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL })
		expect(m.pinInChatMessage).toBeDefined()
		expect(m.pinInChatMessage?.type).toBe(proto.PinInChat.Type.PIN_FOR_ALL)
	})

	it('attaches the original message key to pinInChatMessage.key', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL })
		expect(m.pinInChatMessage?.key?.id).toBe(stubKey.id)
		expect(m.pinInChatMessage?.key?.remoteJid).toBe(stubKey.remoteJid)
	})

	it('senderTimestampMs is set to a current unix-ms value', async () => {
		const before = Date.now()
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL })
		const after = Date.now()
		const ts = m.pinInChatMessage?.senderTimestampMs as number
		expect(ts).toBeGreaterThanOrEqual(before)
		expect(ts).toBeLessThanOrEqual(after)
	})

	it('defaults messageAddOnDurationInSecs to 86400 (24h) for PIN_FOR_ALL with no time', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL })
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(86400)
	})

	it('respects explicit 7-day duration', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL, time: 604800 })
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(604800)
	})

	it('respects explicit 30-day duration', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL, time: 2592000 })
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(2592000)
	})

	it('forces 0 (no pin window) for UNPIN_FOR_ALL', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.UNPIN_FOR_ALL })
		expect(m.messageContextInfo?.messageAddOnDurationInSecs).toBe(0)
	})
})

describe('pin duration survives the proto codec', () => {
	it('preserves pin duration through encodeProto roundtrip (PIN_FOR_ALL, 7d)', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL, time: 604800 })
		const decoded = bridgeRoundtrip(m)
		expect(decoded.messageContextInfo?.messageAddOnDurationInSecs).toBe(604800)
		expect(decoded.pinInChatMessage?.key?.id).toBe(stubKey.id)
		expect(decoded.pinInChatMessage?.type).toBe(proto.PinInChat.Type.PIN_FOR_ALL)
	})

	it('preserves the 24h default through encodeProto roundtrip', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL })
		const decoded = bridgeRoundtrip(m)
		expect(decoded.messageContextInfo?.messageAddOnDurationInSecs).toBe(86400)
	})

	// Regression: 0 is the UNPIN sentinel and must not be dropped as falsy.
	it('preserves 0 (UNPIN) through encodeProto roundtrip — not treated as falsy', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.UNPIN_FOR_ALL })
		const decoded = bridgeRoundtrip(m)
		expect(decoded.messageContextInfo?.messageAddOnDurationInSecs).toBe(0)
	})
})
