/**
 * Names the STUN packets crossing a relay channel, for the example's relay
 * log. A log line per handshake step is what separates "the core never sent
 * the allocate" from "the relay dropped it" on a real call.
 */

import { describe, it } from 'node:test'

import { classifyStunPacket } from '../Utils/stun.ts'
import { expect } from './expect.ts'

const stun = (type: number, txn: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]): Uint8Array => {
	const packet = new Uint8Array(20)
	packet[0] = type >> 8
	packet[1] = type & 0xff
	packet[4] = 0x21
	packet[5] = 0x12
	packet[6] = 0xa4
	packet[7] = 0x42
	packet.set(txn, 8)
	return packet
}

describe('classifyStunPacket', () => {
	it('names the relay handshake', () => {
		expect(classifyStunPacket(stun(0x0001))).toBe('binding request')
		expect(classifyStunPacket(stun(0x0101))).toBe('binding success')
		expect(classifyStunPacket(stun(0x0003))).toBe('allocate request')
		expect(classifyStunPacket(stun(0x0103))).toBe('allocate success')
		expect(classifyStunPacket(stun(0x0113))).toBe('allocate error')
		expect(classifyStunPacket(stun(0x0009))).toBe('stun 0x9')
	})

	it('refuses non-STUN bytes', () => {
		expect(classifyStunPacket(new Uint8Array(0))).toBe(undefined)
		expect(classifyStunPacket(new Uint8Array(19))).toBe(undefined)
		const badCookie = stun(0x0001)
		badCookie[4] = 0x00
		expect(classifyStunPacket(badCookie)).toBe(undefined)
		const rtp = new Uint8Array(20)
		rtp[0] = 0x80
		expect(classifyStunPacket(rtp)).toBe(undefined)
	})
})
