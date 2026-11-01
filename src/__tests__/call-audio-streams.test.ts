import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { createCallAudio } from '../Socket/call-audio.ts'
import type { CallMediaClock } from '../Socket/call-media-streams.ts'
import type { CallPcmSink } from '../Types/Call.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const stream = (...chunks: Int16Array[]) =>
	new ReadableStream<Int16Array>({
		start(output) {
			for (const chunk of chunks) output.enqueue(chunk)
			output.close()
		}
	})
const harness = (manualReady = false) => {
	const parent = new AbortController(),
		sinks = new Set<CallPcmSink>()
	let resolveReady!: () => void,
		now = 0,
		closedWriters = 0
	const ready = new Promise<void>(resolve => {
		resolveReady = resolve
	})
	if (!manualReady) resolveReady()
	const alarms = new Set<{ at: number; run(): void }>()
	const clock: CallMediaClock = {
		now: () => now,
		alarm(run, ms) {
			const task = { at: now + ms, run }
			alarms.add(task)
			return () => {
				alarms.delete(task)
			}
		}
	}
	const frames: Int16Array[] = [],
		times: number[] = [],
		errors: unknown[] = []
	const io = {
		audioInputAccepted: 0,
		audioInputShed: 0,
		videoInputAccepted: 0,
		videoInputShed: 0,
		audioOutputDropped: 0,
		videoOutputDropped: 0
	}
	const audio = createCallAudio({
		id: 'A',
		signal: parent.signal,
		ready,
		io,
		clock,
		reportError: error => errors.push(error),
		operations: {
			async openCallPcmWriter() {
				return {
					tryWrite(samples) {
						frames.push(samples.slice())
						times.push(now)
						return true
					},
					close() {
						closedWriters++
					}
				}
			},
			onCallPcm(_id, sink) {
				sinks.add(sink)
				return () => {
					sinks.delete(sink)
				}
			}
		}
	})
	return {
		audio,
		io,
		parent,
		sinks,
		frames,
		times,
		errors,
		resolveReady,
		alarms,
		get closedWriters() {
			return closedWriters
		},
		emit(data: Int16Array) {
			for (const sink of sinks) sink({ callId: 'A', data })
		},
		async advance(ms: number) {
			now += ms
			for (const task of alarms)
				if (task.at <= now) {
					alarms.delete(task)
					task.run()
				}
			await tick()
		}
	}
}

describe('Web Streams audio sources', () => {
	it('cancels an unfinished source after rejecting an oversized chunk', async () => {
		const h = harness()
		let cancelled = 0
		const source = new ReadableStream<Int16Array>({
			start(controller) {
				controller.enqueue(new Int16Array(65537))
			},
			cancel() {
				cancelled++
			}
		})
		await assert.rejects(h.audio.api.play(source), /at most/)
		assert.equal(cancelled, 1)
		assert.equal(source.locked, false)
		assert.equal(h.parent.signal.aborted, false)
		await h.audio.close()
	})
	it('does not consume a source until media is ready', async () => {
		const h = harness(true)
		let pulls = 0
		const playing = h.audio.api.play(
			new ReadableStream<Int16Array>(
				{
					pull(output) {
						pulls++
						output.enqueue(new Int16Array(320))
						output.close()
					}
				},
				{ highWaterMark: 0 }
			)
		)
		await tick()
		assert.equal(pulls, 0)
		h.resolveReady()
		await playing
		assert.equal(pulls, 1)
		assert.equal(h.frames.length, 1)
		assert.equal(h.frames[0]!.length, 960)
		await h.audio.close()
	})
	it('finishes EOF without closing the call and paces a subsequent source', async () => {
		const h = harness()
		await h.audio.api.play(stream(new Int16Array(960).fill(1)))
		assert.equal(h.parent.signal.aborted, false)
		const second = h.audio.api.play(stream(new Int16Array(128).fill(2)))
		await tick()
		assert.equal(h.frames.length, 1)
		await h.advance(60)
		await second
		assert.deepEqual(h.times, [0, 60])
		assert.equal(h.frames[1]![0], 2)
		assert.ok(h.frames[1]!.subarray(128).every(sample => sample === 0))
		assert.equal(h.closedWriters, 2)
		await h.audio.close()
	})
	it('lets input errors reject playback while the call can use another source', async () => {
		const h = harness()
		await assert.rejects(
			h.audio.api.play(
				new ReadableStream({
					pull() {
						throw new Error('source failed')
					}
				})
			),
			/source failed/
		)
		assert.equal(h.parent.signal.aborted, false)
		await h.audio.api.play(stream(new Int16Array(960)))
		assert.equal(h.frames.length, 1)
		await h.audio.close()
	})
	it('aborts a parked input and permits a fresh source without affecting receivers', async () => {
		const h = harness(),
			cancel = new AbortController()
		let cancelled = 0
		const output = h.audio.api.receive(),
			reader = output.getReader()
		const playing = h.audio.api.play(
			new ReadableStream({
				pull() {
					return new Promise(() => {})
				},
				cancel() {
					cancelled++
				}
			}),
			{ signal: cancel.signal }
		)
		await tick()
		cancel.abort()
		await assert.rejects(playing, { name: 'AbortError' })
		assert.equal(cancelled, 1)
		h.emit(new Int16Array([7]))
		assert.equal((await reader.read()).value![0], 7)
		await h.audio.api.play(stream(new Int16Array(960)))
		await reader.cancel()
		reader.releaseLock()
		await h.audio.close()
	})
	it('rejects format and chunk limits without ending the call', async () => {
		const h = harness()
		await assert.rejects(
			h.audio.api.play(stream(new Int16Array(960)), { format: { sampleRate: 48000, channels: 2 } as never }),
			/resampling/
		)
		await assert.rejects(h.audio.api.play(stream(new Int16Array(65537))), /at most/)
		assert.equal(h.parent.signal.aborted, false)
		assert.equal(h.frames.length, 0)
		await h.audio.close()
	})
})

describe('bounded PCM receivers', () => {
	it('keeps slow and fast consumers independent with observable per-receiver drops', async () => {
		const h = harness(),
			dropped: number[] = []
		const fast = h.audio.api.receive().getReader()
		const slow = h.audio.api.receive({ onDrop: count => dropped.push(count) }).getReader()
		for (let index = 0; index < 10; index++) {
			h.emit(new Int16Array(320).fill(index))
			assert.equal((await fast.read()).value![0], index)
		}
		assert.equal(dropped.at(-1), 7)
		assert.equal(h.io.audioOutputDropped, 7)
		for (let index = 0; index < 3; index++) assert.equal((await slow.read()).value![0], index)
		await fast.cancel()
		await slow.cancel()
		fast.releaseLock()
		slow.releaseLock()
		assert.equal(h.sinks.size, 0)
		assert.equal(h.parent.signal.aborted, false)
		await h.audio.close()
	})
	it('gives each receiver its own samples and cancellation does not end the call', async () => {
		const h = harness(),
			a = h.audio.api.receive().getReader(),
			b = h.audio.api.receive().getReader()
		const payload = new Int16Array([1, 2])
		h.emit(payload)
		const first = (await a.read()).value!,
			second = (await b.read()).value!
		first[0] = 99
		payload[1] = 88
		assert.deepEqual(Array.from(second), [1, 2])
		await a.cancel()
		a.releaseLock()
		assert.equal(h.sinks.size, 1)
		h.emit(new Int16Array([3]))
		assert.equal((await b.read()).value![0], 3)
		await b.cancel()
		b.releaseLock()
		await h.audio.close()
	})
	it('bounds receiver count and releases slots on cancellation', async () => {
		const h = harness(),
			receivers = Array.from({ length: 8 }, () => h.audio.api.receive())
		assert.throws(() => h.audio.api.receive(), /at most 8/)
		await receivers[0]!.cancel()
		receivers.push(h.audio.api.receive())
		await h.audio.close()
		assert.equal(h.sinks.size, 0)
		await Promise.all(receivers.slice(1).map(receiver => receiver.cancel()))
	})
	it('closes bounded output on call shutdown and rejects later subscriptions', async () => {
		const h = harness(),
			reader = h.audio.api.receive().getReader()
		h.emit(new Int16Array([4]))
		h.parent.abort()
		assert.equal((await reader.read()).value![0], 4)
		assert.equal((await reader.read()).done, true)
		reader.releaseLock()
		assert.throws(() => h.audio.api.receive(), /closed/)
		await h.audio.close()
	})
	it('aborting a receiver signal detaches only that receiver', async () => {
		const h = harness(),
			signal = new AbortController(),
			reader = h.audio.api.receive({ signal: signal.signal }).getReader()
		const reading = reader.read()
		signal.abort()
		await assert.rejects(reading, { name: 'AbortError' })
		reader.releaseLock()
		assert.equal(h.sinks.size, 0)
		assert.equal(h.parent.signal.aborted, false)
		await h.audio.close()
	})
})

describe('pending readiness ownership', () => {
	it('observes readiness rejection while native writer acquisition is pending', () => {
		const moduleUrl = new URL('../Socket/call-audio.ts', import.meta.url).href
		const child = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`
			import { createCallAudio } from ${JSON.stringify(moduleUrl)};
			let resolveWriter; let rejectReady; let cancelled=0; let released=0;
			const opening=new Promise(resolve=>{resolveWriter=resolve});
			const audio=createCallAudio({id:'A',signal:new AbortController().signal,ready:new Promise((_,reject)=>{rejectReady=reject}),io:{audioInputAccepted:0,audioInputShed:0,videoInputAccepted:0,videoInputShed:0,audioOutputDropped:0,videoOutputDropped:0},reportError(){},operations:{openCallPcmWriter(){return opening},onCallPcm(){return ()=>{}}}});
			const playing=audio.api.play(new ReadableStream({cancel(){cancelled++}}));
			const stopped=playing.catch(()=>{});
			await new Promise(resolve=>setImmediate(resolve));
			rejectReady(new Error('media admission failed'));
			await new Promise(resolve=>setImmediate(resolve));
			await audio.api.stop(); await stopped;
			await new Promise(resolve=>setImmediate(resolve));
			resolveWriter({tryWrite(){return true},close(){released++}});
			await new Promise(resolve=>setImmediate(resolve));
			await audio.close();
			if(cancelled!==1||released!==1) throw new Error(JSON.stringify({cancelled,released}));
		`
			],
			{ encoding: 'utf8', timeout: 15000 }
		)
		assert.equal(child.status, 0, child.stderr)
	})
	it('does not retain cancelled source scopes while the peer has not answered', () => {
		const moduleUrl = new URL('../Socket/call-audio.ts', import.meta.url).href
		const child = spawnSync(
			process.execPath,
			[
				'--expose-gc',
				'--input-type=module',
				'-e',
				`
			import { createCallAudio } from ${JSON.stringify(moduleUrl)};
			const NativeAbortController = AbortController;
			const parent = new NativeAbortController();
			const refs = [];
			globalThis.AbortController = class extends NativeAbortController { constructor() { super(); refs.push(new WeakRef(this.signal)); } };
			const ready = new Promise(() => {});
			const io = {audioInputAccepted:0,audioInputShed:0,videoInputAccepted:0,videoInputShed:0,audioOutputDropped:0,videoOutputDropped:0};
			const audio = createCallAudio({id:'A',signal:parent.signal,ready,io,reportError(){},operations:{async openCallPcmWriter(){return {tryWrite(){return true},close(){}}},onCallPcm(){return ()=>{}}}});
			globalThis.audio = audio; globalThis.ready = ready;
			for (let index=0; index<300; index++) {
				const source = new ReadableStream({start(c){c.close()}});
				const operation = audio.start(source);
				await operation.opened;
				await audio.api.stop();
				await operation.done.catch(()=>{});
			}
			globalThis.AbortController = NativeAbortController;
			for(let index=0;index<5;index++){await new Promise(resolve=>setImmediate(resolve));global.gc()}
			const retained=refs.filter(ref=>ref.deref()).length;
			await audio.close();
			console.log(JSON.stringify({retained}));
		`
			],
			{ encoding: 'utf8', timeout: 15000 }
		)
		assert.equal(child.status, 0, child.stderr)
		assert.ok(JSON.parse(child.stdout).retained < 20, child.stdout)
	})
})
