import assert from 'node:assert/strict'
import { createCallPcmFramer } from '../src/Socket/call-pcm.ts'
import type * as MediaScope from '../src/Socket/call-media-streams.ts'
const { createCallMediaScope } = (await import(
	process.env.CALL_MEDIA_SCOPE_MODULE ?? '../src/Socket/call-media-streams.ts'
)) as typeof MediaScope

// Local glue microbenchmark, not codec/WASM/network or real-time call latency.
// Run: node --expose-gc scripts/benchmark-call-streams.ts
const samples = 9_600_000
for (const chunkSize of [128, 960, 1024, 65536]) {
	global.gc?.()
	const framer = createCallPcmFramer()
	const chunk = new Int16Array(chunkSize)
	const buffers = new WeakSet<ArrayBufferLike>()
	let frames = 0,
		ownedBuffers = 0
	const drain = () => {
		for (let frame = framer.read(); frame; frame = framer.read()) {
			frames++
			if (frame.buffer !== chunk.buffer && !buffers.has(frame.buffer)) {
				buffers.add(frame.buffer)
				ownedBuffers++
			}
		}
	}
	const before = performance.now()
	let submitted = 0
	while (submitted < samples) {
		const size = Math.min(chunkSize, samples - submitted)
		framer.write(size === chunkSize ? chunk : chunk.subarray(0, size))
		submitted += size
		drain()
	}
	framer.end()
	drain()
	assert.equal(frames, samples / 960)
	console.log(
		JSON.stringify({
			scenario: 'framing',
			chunkSize,
			samples,
			frames,
			ownedBuffers,
			milliseconds: performance.now() - before
		})
	)
}

const parent = new AbortController()
const scope = createCallMediaScope(
	parent.signal,
	() => {},
	() => {}
)
let sink!: (frame: Int16Array) => void
let release!: () => void
let copies = 0,
	dropped = 0
const blocked = new Promise<void>(resolve => {
	release = resolve
})
scope.output(
	new WritableStream<Int16Array>({ write: () => blocked }, { highWaterMark: Infinity }),
	callback => {
		sink = callback
		return () => {}
	},
	frame => {
		copies++
		return frame.slice()
	},
	() => {
		dropped++
	}
)
const frame = new Int16Array(960)
const before = performance.now()
for (let index = 0; index < 100_000; index++) sink(frame)
assert.equal(copies + dropped, 100_000)
if (!process.env.CALL_MEDIA_SCOPE_MODULE) {
	assert.equal(copies, 1)
	assert.equal(dropped, 99_999)
}
console.log(
	JSON.stringify({
		scenario: 'blocked-output',
		frames: 100_000,
		copies,
		dropped,
		retainedPayloadBytes: copies * frame.byteLength,
		milliseconds: performance.now() - before
	})
)
release()
await scope.close()
