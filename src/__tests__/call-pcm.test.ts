import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCallPcmFramer, MAX_CALL_PCM_CHUNK_SAMPLES, validateCallPcmFormat } from '../Socket/call-pcm.ts'

describe('managed PCM framing', () => {
	for (const size of [1, 128, 959, 960, 961, 1024, 4096, 65536]) {
		it(`preserves sample order for ${size}-sample chunks and pads EOF once`, () => {
			const source = Int16Array.from({ length: 16001 }, (_, index) => index % 32768)
			const framer = createCallPcmFramer()
			const received: number[] = []
			const drain = () => {
				for (;;) {
					const frame = framer.read()
					if (!frame) break
					assert.equal(frame.length, 960)
					received.push(...frame)
				}
			}
			for (let offset = 0; offset < source.length; offset += size) {
				framer.write(source.subarray(offset, offset + size))
				drain()
				assert.ok(framer.bufferedSamples < 960)
			}
			framer.end()
			drain()
			assert.ok(framer.done)
			assert.deepEqual(received.slice(0, source.length), Array.from(source))
			assert.ok(received.slice(source.length).every(sample => sample === 0))
			assert.equal(received.length, Math.ceil(source.length / 960) * 960)
			assert.equal(framer.read(), undefined)
		})
	}
	it('passes an aligned bounded frame without copying its payload', () => {
		const framer = createCallPcmFramer(),
			frame = new Int16Array(960)
		framer.write(frame)
		assert.equal(framer.read(), frame)
	})
	it('bounds chunks and does not retain a huge backing buffer through a small view', () => {
		const framer = createCallPcmFramer()
		assert.throws(() => framer.write(new Int16Array(MAX_CALL_PCM_CHUNK_SAMPLES + 1)), /at most/)
		const backing = new Int16Array(MAX_CALL_PCM_CHUNK_SAMPLES + 1)
		framer.write(backing.subarray(0, 960))
		const frame = framer.read()!
		assert.notEqual(frame.buffer, backing.buffer)
		assert.equal(frame.buffer.byteLength, 1920)
	})
	it('accepts empty chunks, rejects byte/float data and never pads an empty input', () => {
		const framer = createCallPcmFramer()
		framer.write(new Int16Array())
		assert.throws(() => framer.write(new Float32Array(960) as never), /Int16Array/)
		assert.throws(() => framer.write(new Uint8Array(1920) as never), /Int16Array/)
		framer.end()
		assert.equal(framer.read(), undefined)
		assert.ok(framer.done)
	})
	it('refuses unsupported formats instead of silently resampling', () => {
		validateCallPcmFormat({ sampleRate: 16000, channels: 1 })
		assert.throws(
			() => validateCallPcmFormat({ sampleRate: 48000, channels: 2 } as never),
			/resampling is not implicit/
		)
	})
})
