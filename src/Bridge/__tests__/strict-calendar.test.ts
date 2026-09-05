import { describe, it } from 'node:test'
import type { WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge'
import { adaptBridgeEvent } from '../adapt.ts'
import { toUnixSeconds } from '../index.ts'
import { asUnixSeconds } from '../primitives.ts'
import { expect } from '../../__tests__/expect.ts'

const jid = (user: string, server = 's.whatsapp.net') => ({ user, server, agent: 0, device: 0, integrator: 0 })

const receiptWith = (timestamp: unknown) => ({
	type: 'receipt',
	data: {
		source: { chat: jid('5511'), sender: jid('5511'), is_group: false, is_from_me: false },
		message_ids: ['M1'],
		type: 'Read',
		timestamp
	}
})

const messageWith = (timestamp: unknown) => ({
	type: 'message',
	data: {
		message: { conversation: 'hi' },
		info: {
			id: 'MSG1',
			timestamp,
			source: { chat: jid('5511'), sender: jid('5511'), is_from_me: false, is_group: false }
		}
	}
})

describe('strict calendar — impossible civil times never become an instant', () => {
	it('rejects day overflow without rolling into the next month', () => {
		for (const raw of [
			'2026-02-30T00:00:00Z',
			'2026-02-30T00:00:00+02:00',
			'2026-02-30T00:00:00.123Z',
			'2026-02-30 00:00:00Z',
			'2023-02-29T00:00:00Z',
			'1900-02-29T00:00:00Z',
			'2026-04-31T00:00:00Z',
			'2026-01-32T00:00:00Z'
		]) {
			expect(asUnixSeconds(raw)).toBeUndefined()
		}
	})

	it('rejects zero and out-of-range months and days', () => {
		for (const raw of [
			'2026-00-10T00:00:00Z',
			'2026-13-10T00:00:00Z',
			'2026-01-00T00:00:00Z',
			'2026-02-00T00:00:00Z',
			'2026-01-00 00:00:00z'
		]) {
			expect(asUnixSeconds(raw)).toBeUndefined()
		}
	})

	it('rejects out-of-range clock components without rolling forward', () => {
		for (const raw of [
			'2026-01-15T24:00:00Z',
			'2026-01-15T00:60:00Z',
			'2026-01-15T00:00:60Z',
			'2026-01-15 24:00:00+00:00',
			'2026-01-15t00:00:60z'
		]) {
			expect(asUnixSeconds(raw)).toBeUndefined()
		}
	})

	it('keeps valid leap days, fractions, offsets, and accepted spellings', () => {
		expect(asUnixSeconds('2024-02-29T00:00:00Z')).toBe(Date.parse('2024-02-29T00:00:00Z') / 1000)
		expect(asUnixSeconds('2000-02-29T00:00:00Z')).toBe(Date.parse('2000-02-29T00:00:00Z') / 1000)
		expect(asUnixSeconds('2026-04-18T05:00:00.987Z')).toBe(Math.floor(Date.parse('2026-04-18T05:00:00.987Z') / 1000))
		expect(asUnixSeconds('2026-04-18T05:00:00+02:00')).toBe(Date.parse('2026-04-18T05:00:00+02:00') / 1000)
		expect(asUnixSeconds('2026-04-18T05:00:00-0530')).toBe(Date.parse('2026-04-18T05:00:00-0530') / 1000)
		expect(asUnixSeconds('2026-04-18t05:00:00z')).toBe(Date.parse('2026-04-18T05:00:00Z') / 1000)
		expect(asUnixSeconds('2026-04-18 05:00:00Z')).toBe(Date.parse('2026-04-18T05:00:00Z') / 1000)
		expect(asUnixSeconds('2026-01-31T23:59:59Z')).toBe(Date.parse('2026-01-31T23:59:59Z') / 1000)
	})

	it('keeps the existing numeric policy: finite passes, the rest is absent', () => {
		expect(asUnixSeconds(1_734_000_000)).toBe(1_734_000_000)
		expect(asUnixSeconds(0)).toBe(0)
		expect(asUnixSeconds(-1)).toBe(-1)
		expect(asUnixSeconds(Number.NaN)).toBeUndefined()
		expect(asUnixSeconds(Number.POSITIVE_INFINITY)).toBeUndefined()
		expect(asUnixSeconds(undefined)).toBeUndefined()
		expect(asUnixSeconds(null)).toBeUndefined()
		expect(asUnixSeconds({})).toBeUndefined()
	})

	it('drops required-timestamp events carrying an impossible date', () => {
		expect(adaptBridgeEvent(receiptWith('2026-02-30T00:00:00Z') as unknown as WhatsAppEvent)).toBe(null)
		expect(adaptBridgeEvent(messageWith('2026-02-30T00:00:00Z') as unknown as WhatsAppEvent)).toBe(null)
		expect(adaptBridgeEvent(messageWith('2026-01-15T24:00:00Z') as unknown as WhatsAppEvent)).toBe(null)
	})

	it('omits optional timestamps carrying an impossible date instead of dropping the event', () => {
		const presence = adaptBridgeEvent({
			type: 'presence',
			data: { from: jid('5511'), unavailable: false, last_seen: '2026-02-30T00:00:00Z' }
		} as unknown as WhatsAppEvent)
		if (presence?.type !== 'presence') throw new Error('expected canonical presence')
		expect(presence.lastSeen).toBeUndefined()

		const ack = adaptBridgeEvent({
			type: 'server_ack',
			data: { id: 'ACK-1', timestamp: '2026-02-30T00:00:00Z' }
		} as unknown as WhatsAppEvent)
		if (ack?.type !== 'serverAck') throw new Error('expected canonical serverAck')
		expect(ack.timestamp).toBeUndefined()
	})

	it('still throws from the validating export on an impossible date', () => {
		expect(() => toUnixSeconds('2026-02-30T00:00:00Z')).toThrow(RangeError)
	})
})
