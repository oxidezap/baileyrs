import { describe, it } from 'node:test'
import { decodeReceiptWireBatch, encodeReceiptWireBatch } from '@oxidezap/whatsapp-rust-bridge'
import type { WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge'
import { adaptBridgeEvent } from '../adapt.ts'
import type { CanonicalReceipt } from '../types.ts'
import { expect } from '../../__tests__/expect.ts'

const jid = (user: string, server = 's.whatsapp.net') => ({ user, server, agent: 0, device: 0, integrator: 0 })

const ABSENT = Symbol('absent timestamp')

const receiptData = (type: unknown, timestamp: unknown = 1_734_000_000) => ({
	source: { chat: jid('5511'), sender: jid('5511'), is_group: false, is_from_me: false },
	message_ids: ['M1'],
	type,
	...(timestamp === ABSENT ? {} : { timestamp })
})

const adaptReceipt = (type: unknown, timestamp: unknown = 1_734_000_000): CanonicalReceipt | null => {
	const result = adaptBridgeEvent({ type: 'receipt', data: receiptData(type, timestamp) } as unknown as WhatsAppEvent)
	if (result === null) return null
	if (result.type !== 'receipt') throw new Error(`expected canonical receipt, got ${result.type}`)
	return result
}

describe('wire-event fidelity — receipt type across object and packed routes', () => {
	it('keeps known bare-string variants without a raw residue', () => {
		const receipt = adaptReceipt('Read')
		expect(receipt?.receiptType).toBe('read')
		expect(receipt?.receiptTypeRaw).toBeUndefined()
	})

	it('keeps known snake_case variants without a raw residue', () => {
		const receipt = adaptReceipt('enc_rekey_retry')
		expect(receipt?.receiptType).toBe('enc-rekey-retry')
		expect(receipt?.receiptTypeRaw).toBeUndefined()
	})

	it('keeps the tagged { type } serde form', () => {
		const receipt = adaptReceipt({ type: 'Read' })
		expect(receipt?.receiptType).toBe('read')
		expect(receipt?.receiptTypeRaw).toBeUndefined()
	})

	it('maps { Other: value } to other and preserves the original value', () => {
		const receipt = adaptReceipt({ Other: 'FutureType' })
		expect(receipt?.receiptType).toBe('other')
		expect(receipt?.receiptTypeRaw).toBe('FutureType')
	})

	it('normalizes a known value wrapped in { Other } without a raw residue', () => {
		const receipt = adaptReceipt({ Other: 'Read' })
		expect(receipt?.receiptType).toBe('read')
		expect(receipt?.receiptTypeRaw).toBeUndefined()
	})

	it('maps an unknown bare string to other and preserves the original value', () => {
		const receipt = adaptReceipt('FutureType')
		expect(receipt?.receiptType).toBe('other')
		expect(receipt?.receiptTypeRaw).toBe('FutureType')
	})

	it('leaves an absent receipt type absent', () => {
		expect(adaptReceipt(undefined)?.receiptType).toBeUndefined()
		expect(adaptReceipt(null)?.receiptType).toBeUndefined()
	})

	it('leaves a malformed receipt type absent instead of miscategorizing it', () => {
		for (const malformed of [42, true, {}, { Other: 42 }, { type: 42 }, []]) {
			const receipt = adaptReceipt(malformed)
			expect(receipt?.receiptType).toBeUndefined()
			expect(receipt?.receiptTypeRaw).toBeUndefined()
		}
	})

	it('decodes an { Other } receipt through the packed batch without losing the value', () => {
		const decoded = decodeReceiptWireBatch(
			encodeReceiptWireBatch([
				{
					source: { chat: jid('5511'), sender: jid('5511'), is_group: false, is_from_me: false },
					message_ids: ['M1'],
					timestamp: 1_734_000_000,
					type: { Other: 'FutureType' },
					offline: false
				}
			])
		)
		expect(decoded.length).toBe(1)
		const first = decoded[0]
		if (!first) throw new Error('expected one decoded receipt')
		expect(first.type).toEqual({ Other: 'FutureType' })
	})

	it('adapts the same logical receipt identically on the object and packed routes', () => {
		for (const type of ['Read', { Other: 'FutureType' }, 'FutureType'] as const) {
			const viaObject = adaptReceipt(type)
			const [packed] = decodeReceiptWireBatch(
				encodeReceiptWireBatch([
					{
						source: { chat: jid('5511'), sender: jid('5511'), is_group: false, is_from_me: false },
						message_ids: ['M1'],
						timestamp: 1_734_000_000,
						type,
						offline: false
					}
				])
			)
			const viaPacked = adaptBridgeEvent({ type: 'receipt', data: packed } as unknown as WhatsAppEvent)
			if (viaPacked?.type !== 'receipt') throw new Error('expected canonical receipt on the packed route')
			if (!viaObject) throw new Error('expected canonical receipt on the object route')
			expect(viaPacked.receiptType).toBe(viaObject.receiptType)
			expect(viaPacked.receiptTypeRaw).toBe(viaObject.receiptTypeRaw ?? undefined)
			expect(viaPacked.timestamp).toBe(viaObject.timestamp)
			expect(viaPacked.messageIds).toEqual(viaObject.messageIds)
		}
	})
})

describe('wire-event fidelity — required timestamps never silently become the epoch', () => {
	it('accepts a valid RFC3339 timestamp on a receipt', () => {
		const receipt = adaptReceipt('read', '2026-04-18T05:00:00Z')
		expect(receipt?.timestamp).toBe(Math.floor(Date.parse('2026-04-18T05:00:00Z') / 1000))
	})

	it('preserves a valid zero timestamp instead of treating it as missing', () => {
		expect(adaptReceipt('read', 0)?.timestamp).toBe(0)
	})

	it('drops a receipt with an absent timestamp instead of dating it at the epoch', () => {
		expect(adaptReceipt('read', ABSENT)).toBe(null)
	})

	it('drops a receipt with an invalid timestamp string instead of dating it at the epoch', () => {
		expect(adaptReceipt('read', 'not-a-date')).toBe(null)
	})

	it('drops a receipt with a non-finite numeric timestamp', () => {
		expect(adaptReceipt('read', Number.NaN)).toBe(null)
		expect(adaptReceipt('read', Number.POSITIVE_INFINITY)).toBe(null)
	})

	it('drops a message with an invalid timestamp string instead of dating it at the epoch', () => {
		const result = adaptBridgeEvent({
			type: 'message',
			data: {
				message: { conversation: 'hi' },
				info: {
					id: 'MSG1',
					timestamp: 'not-a-date',
					source: { chat: jid('5511'), sender: jid('5511'), is_from_me: false, is_group: false }
				}
			}
		} as unknown as WhatsAppEvent)
		expect(result).toBe(null)
	})

	it('drops a message with an absent timestamp', () => {
		const result = adaptBridgeEvent({
			type: 'message',
			data: {
				message: { conversation: 'hi' },
				info: {
					id: 'MSG1',
					source: { chat: jid('5511'), sender: jid('5511'), is_from_me: false, is_group: false }
				}
			}
		} as unknown as WhatsAppEvent)
		expect(result).toBe(null)
	})
})

describe('wire-event fidelity — optional timestamps stay absent when invalid', () => {
	it('omits presence last_seen on invalid input instead of reporting the epoch', () => {
		const invalid = adaptBridgeEvent({
			type: 'presence',
			data: { from: jid('5511'), unavailable: false, last_seen: 'not-a-date' }
		} as unknown as WhatsAppEvent)
		if (invalid?.type !== 'presence') throw new Error('expected canonical presence')
		expect(invalid.lastSeen).toBeUndefined()

		const valid = adaptBridgeEvent({
			type: 'presence',
			data: { from: jid('5511'), unavailable: false, last_seen: '2026-04-18T05:00:00Z' }
		} as unknown as WhatsAppEvent)
		if (valid?.type !== 'presence') throw new Error('expected canonical presence')
		expect(valid.lastSeen).toBe(Math.floor(Date.parse('2026-04-18T05:00:00Z') / 1000))
	})

	it('omits a server-ack timestamp on invalid input instead of reporting the epoch', () => {
		const result = adaptBridgeEvent({
			type: 'server_ack',
			data: { id: 'ACK-1', timestamp: 'not-a-date' }
		} as unknown as WhatsAppEvent)
		if (result?.type !== 'serverAck') throw new Error('expected canonical serverAck')
		expect(result.timestamp).toBeUndefined()
	})
})
