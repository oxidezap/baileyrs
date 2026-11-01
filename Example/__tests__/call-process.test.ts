import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
		const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'pipe'] })
		const controller = new AbortController(),
			failures: Error[] = []
		const sink = processSink(child, controller.signal, error => failures.push(error))
		await sink.write(new Uint8Array(1920))
		controller.abort()
		await sink.stop()
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
