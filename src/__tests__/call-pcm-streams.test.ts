import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCallMediaScope, type CallMediaClock } from '../Socket/call-media-streams.ts'
import { createCallPcmFramer } from '../Socket/call-pcm.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const fakeClock = () => {
	let now = 0
	const alarms = new Set<{ at: number; run(): void }>()
	const clock: CallMediaClock = {
		now: () => now,
		alarm(run, ms) {
			const alarm = { at: now + ms, run }
			alarms.add(alarm)
			return () => {
				alarms.delete(alarm)
			}
		}
	}
	return {
		clock,
		alarms,
		advance(ms: number) {
			now += ms
			for (const alarm of alarms)
				if (alarm.at <= now) {
					alarms.delete(alarm)
					alarm.run()
				}
		}
	}
}

describe('PCM stream pacing and limits', () => {
	it('does not burst overdue PCM frames after the clock stalls', async () => {
		const time = fakeClock(),
			failures: unknown[] = [],
			written: number[] = []
		const scope = createCallMediaScope(
			new AbortController().signal,
			error => failures.push(error),
			() => {},
			time.clock
		)
		const source = new ReadableStream<Int16Array>({
			start(output) {
				output.enqueue(new Int16Array(2880))
				output.close()
			}
		})
		const lease = await scope.input(
			source,
			Promise.resolve({
				tryWrite() {
					written.push(time.clock.now())
					return true
				},
				close() {}
			}),
			() => {},
			() => {},
			60,
			createCallPcmFramer()
		)
		await tick()
		assert.deepEqual(written, [0])
		time.advance(1000)
		await tick()
		assert.deepEqual(written, [0, 1000])
		time.advance(59)
		await tick()
		assert.equal(written.length, 2)
		time.advance(1)
		await lease.done
		assert.deepEqual(written, [0, 1000, 1060])
		assert.deepEqual(failures, [])
		await scope.close()
	})
	it('yields during an empty-source loop so cancellation can finish', async () => {
		const time = fakeClock(),
			parent = new AbortController()
		let cancelled = 0
		const scope = createCallMediaScope(
			parent.signal,
			() => {},
			() => {},
			time.clock
		)
		const lease = await scope.input(
			new ReadableStream<Int16Array>({
				pull(output) {
					output.enqueue(new Int16Array())
				},
				cancel() {
					cancelled++
				}
			}),
			Promise.resolve({
				tryWrite() {
					throw new Error('empty input must not reach native')
				},
				close() {}
			}),
			() => {},
			() => {},
			60,
			createCallPcmFramer()
		)
		await tick()
		assert.equal(time.alarms.size, 1)
		parent.abort()
		await assert.rejects(lease.done, { name: 'AbortError' })
		await scope.close()
		assert.equal(time.alarms.size, 0)
		assert.equal(cancelled, 1)
	})
	it('keeps at most one pending write even when the sink requests an infinite queue', async () => {
		let send!: (frame: Int16Array) => void, release!: () => void
		let dropped = 0,
			writes = 0
		const blocked = new Promise<void>(resolve => {
			release = resolve
		})
		const scope = createCallMediaScope(
			new AbortController().signal,
			() => {},
			() => {}
		)
		scope.output(
			new WritableStream<Int16Array>(
				{
					write() {
						writes++
						return blocked
					}
				},
				{ highWaterMark: Infinity }
			),
			sink => {
				send = sink
				return () => {}
			},
			(frame: Int16Array) => frame.slice(),
			() => {
				dropped++
			}
		)
		for (let index = 0; index < 10000; index++) send(new Int16Array(320))
		await tick()
		assert.equal(writes, 1)
		assert.equal(dropped, 9999)
		release()
		await tick()
		send(new Int16Array(320))
		await tick()
		assert.equal(writes, 2)
		await scope.close()
	})
})
