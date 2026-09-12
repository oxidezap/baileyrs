import { describe, it } from 'node:test'
import type { CallAudioFrame } from '../../src/Types/Call.ts'
import { expect } from '../../src/__tests__/expect.ts'
import {
	auHasKeyframe,
	AudioJitterBuffer,
	getOpusConfig,
	getOpusSamples48k,
	type InboundAudioRouterState,
	isOpusCeltOnly,
	muxOggOpus,
	orientationFilter,
	processInboundCallAudioFrame,
	createMlowAudioDecoder,
	decodeMlowAudioFrame,
	splitVideoAccessUnits
} from '../call.ts'

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

describe('AudioJitterBuffer', () => {
	it('clears queued frames without playing them', () => {
		const played: number[] = []
		const buffer = new AudioJitterBuffer({
			preRoll: 3,
			maxDelay: 8,
			onPacket: frame => played.push(frame.sequenceNumber)
		})
		const frame = (sequenceNumber: number): CallAudioFrame => ({
			callId: 'call-1',
			codec: 'mlow',
			format: 'mlow',
			data: new Uint8Array([0x90]),
			payloadType: 120,
			sequenceNumber,
			timestamp: sequenceNumber * 2880,
			marker: false
		})

		buffer.push(frame(1))
		buffer.push(frame(2))
		buffer.clear()
		buffer.push(frame(10))
		buffer.push(frame(11))
		buffer.push(frame(12))

		expect(played).toEqual([10, 11, 12])
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

	it('splits Annex-B stream incrementally across multiple chunk pushes', () => {
		const splitter = splitVideoAccessUnits()
		const au1 = new Uint8Array([0, 0, 0, 1, 9, 0x10, 0, 0, 0, 1, 0x67, 0x42])
		const au2 = new Uint8Array([0, 0, 0, 1, 9, 0x20, 0, 0, 0, 1, 0x41, 0x9a])
		const au3 = new Uint8Array([0, 0, 0, 1, 9, 0x30])

		const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
			const res = new Uint8Array(a.length + b.length)
			res.set(a)
			res.set(b, a.length)
			return res
		}

		expect(splitter.push(au1.subarray(0, 6)).length).toBe(0)
		const r2 = splitter.push(concat(au1.subarray(6), au2.subarray(0, 5)))
		expect(r2.length).toBe(1)
		expect(r2[0]).toEqual(au1)

		const r3 = splitter.push(concat(au2.subarray(5), au3))
		expect(r3.length).toBe(1)
		expect(r3[0]).toEqual(au2)
	})
})

describe('orientationFilter', () => {
	it('maps WhatsApp orientation 0..3 to ffplay video filters', () => {
		expect(orientationFilter(0)).toBe(null)
		expect(orientationFilter(1)).toBe('transpose=cclock')
		expect(orientationFilter(2)).toBe('hflip,vflip')
		expect(orientationFilter(3)).toBe('transpose=clock')
		expect(orientationFilter(5)).toBe('transpose=cclock')
	})
})

describe('auHasKeyframe', () => {
	it('detects IDR, SPS, and non-keyframe NALs', () => {
		// IDR slice (type 5): 0x65 & 0x1f = 5
		const idrAu = new Uint8Array([0, 0, 0, 1, 0x65, 0x88, 0x10])
		expect(auHasKeyframe(idrAu)).toBe(true)

		// SPS (type 7): 0x67 & 0x1f = 7
		const spsAu = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0x00])
		expect(auHasKeyframe(spsAu)).toBe(true)

		// Non-IDR slice (type 1): 0x41 & 0x1f = 1
		const nonKeyAu = new Uint8Array([0, 0, 0, 1, 0x41, 0x9a])
		expect(auHasKeyframe(nonKeyAu)).toBe(false)
	})
})

describe('isOpusCeltOnly and getOpusConfig', () => {
	it('rejects SILK configs 0..11 including config 11', () => {
		// Config 11 (SILK WB 60ms) -> (11 << 3) = 0x58
		const silk11 = new Uint8Array([0x58, 0x10, 0x20, 0x30])
		expect(getOpusConfig(silk11)).toBe(11)
		expect(isOpusCeltOnly(silk11)).toBe(false)

		// Config 9 (SILK WB 20ms) -> (9 << 3) = 0x48
		const silk9 = new Uint8Array([0x48, 0x10, 0x20, 0x30])
		expect(getOpusConfig(silk9)).toBe(9)
		expect(isOpusCeltOnly(silk9)).toBe(false)

		// Config 0 (SILK NB 10ms) -> (0 << 3) = 0x00
		const silk0 = new Uint8Array([0x00, 0x10, 0x20, 0x30])
		expect(getOpusConfig(silk0)).toBe(0)
		expect(isOpusCeltOnly(silk0)).toBe(false)
	})

	it('rejects Hybrid configs 12..15', () => {
		// Config 12 -> (12 << 3) = 0x60
		const hybrid12 = new Uint8Array([0x60, 0x10, 0x20, 0x30])
		expect(getOpusConfig(hybrid12)).toBe(12)
		expect(isOpusCeltOnly(hybrid12)).toBe(false)

		// Config 15 -> (15 << 3) = 0x78
		const hybrid15 = new Uint8Array([0x78, 0x10, 0x20, 0x30])
		expect(getOpusConfig(hybrid15)).toBe(15)
		expect(isOpusCeltOnly(hybrid15)).toBe(false)
	})

	it('accepts CELT configs 16..31', () => {
		// Config 16 -> (16 << 3) = 0x80
		const celt16 = new Uint8Array([0x80, 0x10, 0x20, 0x30])
		expect(getOpusConfig(celt16)).toBe(16)
		expect(isOpusCeltOnly(celt16)).toBe(true)

		// Config 23 (CELT FB 20ms) -> (23 << 3) = 0xb8
		const celt23 = new Uint8Array([0xb8, 0x10, 0x20, 0x30])
		expect(getOpusConfig(celt23)).toBe(23)
		expect(isOpusCeltOnly(celt23)).toBe(true)

		// Config 31 -> (31 << 3) = 0xf8
		const celt31 = new Uint8Array([0xf8, 0x10, 0x20, 0x30])
		expect(getOpusConfig(celt31)).toBe(31)
		expect(isOpusCeltOnly(celt31)).toBe(true)
	})

	it('accepts DTX comfort noise packets (length <= 2)', () => {
		expect(isOpusCeltOnly(new Uint8Array([0x58]))).toBe(true)
		expect(isOpusCeltOnly(new Uint8Array([0x58, 0x01]))).toBe(true)
	})

	it('rejects empty packets', () => {
		expect(getOpusConfig(new Uint8Array(0))).toBe(-1)
		expect(isOpusCeltOnly(new Uint8Array(0))).toBe(false)
	})
})

describe('processInboundCallAudioFrame', () => {
	it('decodes a real MLOW silence frame and frees the stateful decoder', () => {
		const decoder = createMlowAudioDecoder()
		const pcm = decodeMlowAudioFrame(decoder, {
			callId: 'call-1',
			codec: 'mlow',
			format: 'mlow',
			data: new Uint8Array([0x90]),
			payloadType: 120,
			sequenceNumber: 1,
			timestamp: 0,
			marker: false
		})
		expect(pcm instanceof Float32Array).toBe(true)
		expect(pcm.length > 0).toBe(true)
		decoder.reset()
		decoder.free()
	})

	it('dispatches inbound opus frames with their actual format', () => {
		const state: InboundAudioRouterState = {}
		const dispatched: CallAudioFrame[] = []
		const frame: CallAudioFrame = {
			callId: 'call-1',
			codec: 'opus',
			format: 'opus',
			data: new Uint8Array([0xb8, 0x01, 0x02]),
			payloadType: 111,
			sequenceNumber: 1,
			timestamp: 1234,
			marker: false
		}

		const result = processInboundCallAudioFrame(frame, state, f => dispatched.push(f))
		expect(result).toBe('opus')
		expect(state.peerCodec).toBe('opus')
		expect(dispatched[0]).toBe(frame)
	})

	it('passes inbound MLOW even when the local source is opus-mlow', () => {
		const state: InboundAudioRouterState = {}
		const dispatched: CallAudioFrame[] = []
		const frame: CallAudioFrame = {
			callId: 'call-1',
			codec: 'mlow',
			format: 'mlow',
			data: new Uint8Array([0x01, 0x02, 0x03]),
			payloadType: 121,
			sequenceNumber: 2,
			timestamp: 1235,
			marker: false
		}

		const result = processInboundCallAudioFrame(frame, state, f => dispatched.push(f))
		expect(result).toBe('mlow')
		expect(state.peerCodec).toBe('mlow')
		expect(dispatched[0]).toBe(frame)
	})

	it('preserves a runtime format switch without comparing it to the source', () => {
		const state: InboundAudioRouterState = {}
		const dispatched: CallAudioFrame[] = []
		const opusFrame: CallAudioFrame = {
			callId: 'call-1',
			codec: 'opus',
			format: 'opus-mlow',
			data: new Uint8Array([0xb8, 0x01]),
			payloadType: 111,
			sequenceNumber: 3,
			timestamp: 100,
			marker: false
		}
		const mlowFrame: CallAudioFrame = {
			callId: 'call-1',
			codec: 'mlow',
			format: 'mlow',
			data: new Uint8Array([0x10, 0x20]),
			payloadType: 120,
			sequenceNumber: 4,
			timestamp: 120,
			marker: false
		}

		processInboundCallAudioFrame(opusFrame, state, f => dispatched.push(f))
		expect(state.peerCodec).toBe('opus')
		expect(dispatched.length).toBe(1)

		processInboundCallAudioFrame(mlowFrame, state, f => dispatched.push(f))
		expect(state.peerCodec).toBe('mlow')
		expect(dispatched.length).toBe(2)

		processInboundCallAudioFrame(opusFrame, state, f => dispatched.push(f))
		expect(state.peerCodec).toBe('opus')
		expect(dispatched.length).toBe(3)
	})
})
