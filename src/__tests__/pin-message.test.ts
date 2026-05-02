import { describe, it } from 'node:test'
import { decodeProto, encodeProto } from 'whatsapp-rust-bridge'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import { stripContextInfoForBridge } from '../Socket/messages.ts'
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
 * inside `messageContextInfo`, so the JS side strips the field before sending
 * — but for pins we have to keep `messageAddOnDurationInSecs` or the server
 * silently ignores the pin. The bridge merges fields it does not own
 * (verified in `wacore/src/reporting_token.rs::prepare_message_with_context`),
 * so passing the field through is safe.
 *
 * The `stripContextInfoForBridge` block exercises the actual send path: it
 * runs the helper and then encodes/decodes via the bridge so a regression
 * in either the strip logic OR the proto encoder fails the test.
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
	conversation?: string
	extendedTextMessage?: { text?: string }
}

type PinTime = 86400 | 604800 | 2592000
function buildPin(extra: { type: proto.PinInChat.Type; time?: PinTime }): Promise<WAMessageContent> {
	return generateWAMessageContent({ pin: stubKey, ...extra }, noopOptions)
}

function bridgeRoundtrip(msg: WAMessageContent): DecodedMessage {
	stripContextInfoForBridge(msg)
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

describe('stripContextInfoForBridge — actual send-path behaviour', () => {
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

	it('strips messageContextInfo entirely from non-pin messages (field absent on the wire)', async () => {
		const m = await generateWAMessageContent({ text: 'hello' }, noopOptions)
		// Plant a stale field to prove it gets stripped.
		;(m as { messageContextInfo?: unknown }).messageContextInfo = {
			messageSecret: new Uint8Array(32),
			messageAddOnDurationInSecs: 999
		}
		stripContextInfoForBridge(m)
		// After strip the JS object has no contextInfo at all → encoder will not emit the field.
		expect((m as { messageContextInfo?: unknown }).messageContextInfo).toBeUndefined()

		// Sanity: the rest of the message still encodes/decodes.
		const decoded = decodeProto(
			'Message',
			encodeProto('Message', m as unknown as Record<string, unknown>)
		) as DecodedMessage
		expect(decoded.extendedTextMessage?.text).toBe('hello')
	})

	it('strips bridge-owned fields on pins, keeping ONLY messageAddOnDurationInSecs', async () => {
		const m = await buildPin({ type: proto.PinInChat.Type.PIN_FOR_ALL, time: 604800 })
		// Plant fields the bridge owns; they must not survive the strip.
		;(m as { messageContextInfo?: Record<string, unknown> }).messageContextInfo = {
			messageAddOnDurationInSecs: 604800,
			messageSecret: new Uint8Array(32).fill(0xab),
			reportingTokenVersion: 7
		}
		stripContextInfoForBridge(m)
		// Inspect the live JS object: the strip must have replaced the contextInfo
		// with a fresh one that contains only the duration. The proto3 wire format
		// can't tell "absent bytes" from "empty bytes" on decode, so we assert
		// against the in-memory object that the encoder will see.
		const ctx = m.messageContextInfo as Record<string, unknown> | undefined
		expect(ctx).toBeDefined()
		expect(Object.keys(ctx as object).toSorted()).toEqual(['messageAddOnDurationInSecs'])
		expect(ctx?.messageAddOnDurationInSecs).toBe(604800)
	})
})
