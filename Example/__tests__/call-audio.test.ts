import { describe, it } from 'node:test'
import { expect } from '../../src/__tests__/expect.ts'
import { getOpusSamples48k, muxOggOpus, splitVideoAccessUnits } from '../call.ts'

describe('getOpusSamples48k', () => {
	it('calculates SILK WB 60ms frames (2880 samples at 48kHz)', () => {
		// Config 11 (SILK WB 60ms) -> (11 << 3) = 0x58. Frame count code 0 = 1 frame.
		const packet = new Uint8Array([0x58, 0x00, 0x01, 0x02])
		expect(getOpusSamples48k(packet)).toBe(2880)
	})

	it('calculates SILK WB 20ms frames (960 samples at 48kHz)', () => {
		// Config 9 (SILK WB 20ms) -> (9 << 3) = 0x48. Frame count code 0 = 1 frame.
		const packet = new Uint8Array([0x48, 0x00, 0x01, 0x02])
		expect(getOpusSamples48k(packet)).toBe(960)
	})

	it('calculates CELT 20ms frames (960 samples at 48kHz)', () => {
		// Config 19 (CELT 20ms) -> (19 << 3) = 0x98. Frame count code 0 = 1 frame.
		const packet = new Uint8Array([0x98, 0x00, 0x01, 0x02])
		expect(getOpusSamples48k(packet)).toBe(960)
	})

	it('handles multi-frame Opus packets (code 1: 2 equal frames)', () => {
		// Config 9 (SILK WB 20ms = 960 samples) with frame count code 1 (2 frames) -> (9 << 3) | 1 = 0x49.
		const packet = new Uint8Array([0x49, 0x00, 0x01, 0x02])
		expect(getOpusSamples48k(packet)).toBe(1920)
	})

	it('falls back safely on empty packet', () => {
		expect(getOpusSamples48k(new Uint8Array(0))).toBe(960)
	})
})

describe('muxOggOpus', () => {
	it('generates valid Ogg Opus header pages', () => {
		const muxer = muxOggOpus()
		const headers = muxer.headerPages()
		expect(headers.length).toBe(2)

		// Page 1: OpusHead
		const head = headers[0]!
		expect(head[0]).toBe(0x4f) // 'O'
		expect(head[1]).toBe(0x67) // 'g'
		expect(head[2]).toBe(0x67) // 'g'
		expect(head[3]).toBe(0x53) // 'S'
		expect(head[5]).toBe(0x02) // BOS flag

		// Page 2: OpusTags
		const tags = headers[1]!
		expect(tags[0]).toBe(0x4f)
		expect(tags[5]).toBe(0x00)
	})

	it('advances granulepos according to Opus frame duration', () => {
		const muxer = muxOggOpus()
		muxer.headerPages()

		// Feed a 60ms Opus frame (config 11 = 0x58, 2880 samples)
		const frame60ms = new Uint8Array([0x58, 0x11, 0x22])
		const page1 = muxer.page(frame60ms)
		const view1 = new DataView(page1.buffer, page1.byteOffset)
		const granule1 = view1.getBigUint64(6, true)
		expect(granule1).toBe(2880n)

		// Feed a 20ms Opus frame (config 9 = 0x48, 960 samples)
		const frame20ms = new Uint8Array([0x48, 0x33, 0x44])
		const page2 = muxer.page(frame20ms)
		const view2 = new DataView(page2.buffer, page2.byteOffset)
		const granule2 = view2.getBigUint64(6, true)
		expect(granule2).toBe(3840n) // 2880 + 960
	})
})

describe('splitVideoAccessUnits', () => {
	it('splits Annex-B stream on AUD boundaries', () => {
		const splitter = splitVideoAccessUnits()
		const au1 = new Uint8Array([
			0, 0, 0, 1, 9, 0x10, 0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x68, 0xce, 0, 0, 0, 1, 0x65, 0x88
		])
		const au2 = new Uint8Array([0, 0, 0, 1, 9, 0x20, 0, 0, 0, 1, 0x41, 0x9a])
		const au3 = new Uint8Array([0, 0, 0, 1, 9, 0x30])
		const merged = new Uint8Array(au1.length + au2.length + au3.length)
		merged.set(au1)
		merged.set(au2, au1.length)
		merged.set(au3, au1.length + au2.length)

		const units = splitter.push(merged)
		expect(units.length).toBe(2)
		expect(units[0]).toEqual(au1)
		expect(units[1]).toEqual(au2)
	})
})
