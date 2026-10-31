import { describe, it } from 'node:test'
import { expect } from '../../src/__tests__/expect.ts'
import { auHasKeyframe, orientationFilter, splitVideoAccessUnits, splitPcm16Frames } from '../call-media.ts'
import { makeCallTerminalTracker, parseArgs } from '../call.ts'

describe('splitPcm16Frames', () => {
	it('keeps arbitrary byte chunks until 960-sample frames are complete', () => {
		const splitter = splitPcm16Frames()
		const bytes = new Uint8Array(1920)
		for (let index = 0; index < bytes.length; index++) bytes[index] = index & 0xff
		expect(splitter.push(bytes.subarray(0, 1))).toEqual([])
		expect(splitter.push(bytes.subarray(1, 1001))).toHaveLength(0)
		const frames = splitter.push(bytes.subarray(1001))
		expect(frames).toHaveLength(1)
		expect(frames[0]!.length).toBe(960)
		expect(frames[0]![0]).toBe(0x0100)
		const aligned = new Uint8Array(3840)
		const direct = splitter.push(aligned)
		expect(direct[0]!.buffer).toBe(aligned.buffer)
		expect(direct[1]!.buffer).toBe(aligned.buffer)
		expect(splitter.flush()).toEqual([])
	})

	it('does not overwrite a completed partial frame when the chunk also starts the next one', () => {
		const splitter = splitPcm16Frames(2)
		expect(splitter.push(new Uint8Array([1, 2]))).toEqual([])
		const first = splitter.push(new Uint8Array([3, 4, 5]))
		expect(Array.from(first[0]!)).toEqual([0x0201, 0x0403])
		const second = splitter.push(new Uint8Array([6, 7, 8]))
		expect(Array.from(second[0]!)).toEqual([0x0605, 0x0807])
		expect(Array.from(first[0]!)).toEqual([0x0201, 0x0403])
		expect(splitter.flush()).toEqual([])
	})
})

describe('call terminal updates', () => {
	it('fences an in-flight accept on signaling-only timeout/reject/terminate, without media ended', async () => {
		for (const status of ['timeout', 'reject', 'terminate'] as const) {
			const calls = makeCallTerminalTracker()
			let resolveAccept!: (callId: string) => void
			const accepting = new Promise<string>(resolve => {
				resolveAccept = resolve
			})
			const canStartCapture = accepting.then(id => !calls.isDead(id))
			expect(calls.recordUpdate({ id: 'CALL-1', status: 'offer' })).toBe(false)
			expect(calls.recordUpdate({ id: 'CALL-1', status })).toBe(true)
			resolveAccept('CALL-1')
			expect(await canStartCapture).toBe(false)
			expect(calls.isDead('CALL-2')).toBe(false)
		}
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

	it('flushes the trailing access unit when the source ends', () => {
		const splitter = splitVideoAccessUnits()
		const au1 = new Uint8Array([0, 0, 0, 1, 9, 0x10, 0, 0, 0, 1, 0x67, 0x42])
		const tail = new Uint8Array([0, 0, 0, 1, 9, 0x20, 0, 0, 0, 1, 0x41, 0x9a])
		// One AUD so far: nothing complete to emit yet.
		expect(splitter.push(au1).length).toBe(0)
		expect(splitter.push(tail).length).toBe(1)
		// au1 came out on the second push; only the tail remains buffered.
		expect(splitter.flush()).toEqual([tail])
		expect(splitter.flush()).toEqual([])
	})

	it('flushes nothing classifiable when no AUD arrived', () => {
		const splitter = splitVideoAccessUnits()
		expect(splitter.push(new Uint8Array([0, 0, 0, 1, 0x67, 0x42])).length).toBe(0)
		expect(splitter.flush()).toEqual([])
	})

	it('keeps the AUD boundary when a chunk ends right after the start code', () => {
		const splitter = splitVideoAccessUnits()
		const au1 = new Uint8Array([0, 0, 0, 1, 9, 0x10, 0, 0, 0, 1, 0x67, 0x42])
		const au2 = new Uint8Array([0, 0, 0, 1, 9, 0x20, 0, 0, 0, 1, 0x41, 0x9a])
		const stream = new Uint8Array(au1.length + au2.length)
		stream.set(au1)
		stream.set(au2, au1.length)
		// Split inside au2's 4-byte start code: first chunk ends exactly
		// after `00 00 00 01`, the AUD header arrives with the next chunk.
		const cut = au1.length + 4
		expect(splitter.push(stream.subarray(0, cut)).length).toBe(0)
		const units = splitter.push(stream.subarray(cut))
		expect(units.length).toBe(1)
		expect(units[0]).toEqual(au1)
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

describe('explicit mock relay selection', () => {
	it('does not enable cleartext relay for a custom socket or TLS opt-out', () => {
		expect(parseArgs(['listen', '--socket', 'wss://example.com', '--danger-skip-cert-verify']).mockUdp).toBe(false)
	})
	it('permits cleartext only with explicit loopback mock selection', () => {
		expect(parseArgs(['listen', '--mock-udp', '--socket', 'wss://127.0.0.1:8080']).mockUdp).toBe(true)
		expect(() => parseArgs(['listen', '--mock-udp', '--socket', 'wss://example.com'])).toThrow()
	})
})
