import { describe, it } from 'node:test'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import { toNumber } from '../Utils/generics.ts'
import { expect } from './expect.ts'

describe('proto serialization', () => {
	it('handles string values in long fields gracefully', () => {
		const message = proto.WebMessageInfo.fromObject({
			key: {
				remoteJid: '123@s.whatsapp.net',
				id: 'ABC123',
				fromMe: false
			},
			messageTimestamp: 1,
			message: {
				imageMessage: {
					fileLength: 42
				}
			}
		})

		const imageMessage = message.message?.imageMessage
		if (!imageMessage) {
			throw new Error('imageMessage missing in test setup')
		}

		;(imageMessage as unknown as { fileLength: unknown }).fileLength = '1234567890123456789'

		expect(() => JSON.stringify(message)).not.toThrow()
		const json = message.toJSON()
		expect(json.message?.imageMessage?.fileLength).toBe('1234567890123456789')
	})
})

// The bridge `message` event now emits proto int64/uint64 fields (fileLength,
// timestampMs, …) as protobufjs-style `Long` objects `{ low, high, unsigned }`
// instead of `BigInt`. Consumers that need a JS number MUST go through
// `toNumber` — a plain `Number(longObj)` yields `NaN`. This pins the two
// production sites fixed for that regression (media download fileLength in
// Utils/messages.ts, edit timestampMs in Socket/events.ts).
const long = (low: number, high: number, unsigned = false) => ({ low, high, unsigned })

describe('toNumber on Long objects (bridge int64 representation)', () => {
	it('plain Number() on a Long object is NaN — the bug toNumber guards against', () => {
		expect(Number.isNaN(Number(long(42, 0)))).toBe(true)
	})

	it('coerces a small fileLength Long to the exact number', () => {
		expect(toNumber(long(42, 0, true))).toBe(42)
	})

	it('coerces a millisecond timestamp Long (high half set) correctly', () => {
		// 1_780_000_000_000 ms = high*2^32 + (low>>>0)
		const ms = 1_780_000_000_000
		const high = Math.floor(ms / 0x100000000)
		const low = ms >>> 0
		expect(toNumber(long(low, high))).toBe(ms)
	})

	it('treats null/undefined as 0 (matches `fileLength ?? 0` call sites)', () => {
		expect(toNumber(null)).toBe(0)
		expect(toNumber(undefined)).toBe(0)
	})

	it('passes plain numbers through unchanged', () => {
		expect(toNumber(123)).toBe(123)
	})
})
