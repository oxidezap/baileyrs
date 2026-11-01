import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { splitPcm16Frames } from '../call-media.ts'
import { processInput, processSink, restartableProcessInput } from '../call-process.ts'

const bytes = {
	push(chunk: Uint8Array) {
		return [chunk.slice()]
	},
	flush() {
		return [] as Uint8Array[]
	}
}

describe('call media child processes', () => {
	it('finishes a finite PCM recording with a padded tail instead of a stream failure', async () => {
		const child = spawn(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(32000, 1))'], {
			stdio: ['ignore', 'pipe', 'pipe']
		})
		const source = processInput(child, new AbortController().signal, splitPcm16Frames())
		const reader = source.input.getReader()
		const frames: Int16Array[] = []
		for (;;) {
			const result = await reader.read()
			if (result.done) break
			frames.push(result.value)
		}
		reader.releaseLock()
		await source.dispose()
		assert.equal(frames.length, 17)
		assert.ok(frames.every(frame => frame.length === 960))
		assert.deepEqual(Array.from(frames.at(-1)!.subarray(640)), Array(320).fill(0))
	})
	it('drains encoder stdout and flushes its tail after process exit', async () => {
		const child = spawn(process.execPath, ['-e', "process.stdout.write('last frame')"], {
			stdio: ['ignore', 'pipe', 'pipe']
		})
		const source = processInput(child, new AbortController().signal, {
			...bytes,
			flush: () => [new TextEncoder().encode('!')]
		})
		const reader = source.input.getReader()
		let text = ''
		for (;;) {
			const chunk = await reader.read()
			if (chunk.done) break
			text += new TextDecoder().decode(chunk.value)
		}
		reader.releaseLock()
		await source.dispose()
		assert.equal(text, 'last frame!')
	})
	it('cancels a parked encoder and waits for its process to close', async () => {
		const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] })
		const source = processInput(child, new AbortController().signal, bytes)
		const reader = source.input.getReader()
		const reading = reader.read()
		await reader.cancel('hangup')
		assert.equal((await reading).done, true)
		assert.equal(child.signalCode, 'SIGKILL')
		reader.releaseLock()
		await source.dispose()
	})
	it('reports failed encoders rather than treating missing media as clean EOF', async () => {
		const child = spawn(process.execPath, ['-e', 'process.exitCode = 3'], { stdio: ['ignore', 'pipe', 'pipe'] })
		const source = processInput(child, new AbortController().signal, bytes)
		const reader = source.input.getReader()
		await assert.rejects(reader.read(), /Encoder exited with 3/)
		reader.releaseLock()
		await source.dispose()
	})
	it('backpressures playback and closes its owned process on abort', async () => {
		const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['pipe', 'ignore', 'pipe'] })
		const controller = new AbortController(),
			failures: Error[] = []
		const sink = processSink(child, controller.signal, error => failures.push(error))
		let settled = false
		const writing = sink.write(new Uint8Array(4 * 1024 * 1024)).then(
			() => {
				settled = true
			},
			() => {
				settled = true
			}
		)
		await new Promise(resolve => setTimeout(resolve, 50))
		assert.equal(settled, false)
		controller.abort()
		await sink.stop()
		await writing
		assert.equal(child.signalCode, 'SIGKILL')
		assert.deepEqual(failures, [])
	})
	it('reports a playback process that exits without a requested stop', async () => {
		const child = spawn(process.execPath, ['-e', 'process.exitCode = 4'], { stdio: ['pipe', 'ignore', 'pipe'] })
		const failure = await new Promise<Error>(resolve => {
			processSink(child, new AbortController().signal, resolve)
		})
		assert.match(failure.message, /Playback exited with 4/)
	})
})

describe('video encoder keyframe restart', () => {
	it('replaces the encoder on request, coalesces bursts and cancels the replacement', async () => {
		const controller = new AbortController()
		let opened = 0,
			disposed = 0
		const source = restartableProcessInput(() => {
			const generation = ++opened
			return {
				input: new ReadableStream<number>({
					pull(output) {
						output.enqueue(generation)
					}
				}),
				async dispose() {
					disposed++
				}
			}
		}, controller.signal)
		const reader = source.input.getReader()
		assert.equal((await reader.read()).value, 1)
		await source.requestKeyframe()
		await source.requestKeyframe()
		let next = await reader.read()
		if (next.value === 1) next = await reader.read()
		assert.equal(next.value, 2)
		assert.equal(opened, 2)
		await reader.cancel()
		await source.dispose()
		reader.releaseLock()
		assert.equal(disposed, 2)
	})
})

describe('playback failure notification', () => {
	it('reports a failed spawn once across error and close events', async () => {
		const child = spawn('__baileyrs_missing_ffplay__', [], { stdio: ['pipe', 'ignore', 'pipe'] })
		const errors: Error[] = []
		const sink = processSink(child, new AbortController().signal, error => errors.push(error))
		await new Promise<void>(resolve => child.once('close', () => resolve()))
		await sink.stop()
		assert.equal(errors.length, 1)
	})
})

describe('encoder byte backpressure', () => {
	it('does not drain an entire Node byte source into an object-counted Web queue', async () => {
		let produced = 0
		const stdout = new Readable({
			highWaterMark: 16384,
			read() {
				if (produced < 32) {
					produced++
					this.push(Buffer.alloc(8192))
				} else this.push(null)
			}
		})
		const child = Object.assign(new EventEmitter(), {
			stdout,
			kill() {
				stdout.destroy()
				child.emit('close', null)
				return true
			}
		}) as unknown as ChildProcess
		const source = processInput(child, new AbortController().signal, bytes)
		for (let index = 0; index < 3; index++) await new Promise<void>(resolve => setImmediate(resolve))
		assert.ok(produced <= 12, `drained ${produced} chunks without a consumer`)
		const reader = source.input.getReader()
		await reader.cancel()
		reader.releaseLock()
		await source.dispose()
	})
})
