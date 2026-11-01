import type { CallSession, CallSessionMedia, CallSessionVideoMedia } from '../Types/CallSession.ts'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { createVoipApi, type CallSessionOperations, type CallSessionRuntime } from '../Socket/call-sessions.ts'
import type { CallPcmWriter, CallMediaStats, CallPcmSink, CallVideoSink, WACallEvent } from '../Types/Call.ts'

const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const offer = { id: 'INCOMING', chatId: 'peer@s.whatsapp.net', status: 'offer', isVideo: false } as WACallEvent

const harness = () => {
	const events = new EventEmitter()
	const pcm = new Map<string, CallPcmSink>()
	const video = new Map<string, CallVideoSink>()
	const sent: Int16Array[] = []
	const counts = { starts: 0, ends: 0, terminates: 0, writersClosed: 0 }
	const errors: unknown[] = []
	let onEnd!: () => Promise<void>
	let closing = false
	const terminal = new Set<string>()
	const operations: CallSessionOperations = {
		async endCall() {
			counts.ends++
			return { outcome: 'peer-notified' }
		},
		async terminateCall() {
			counts.terminates++
		},
		async setCallMuted() {},
		async getCallMediaStats() {
			return { rtpReceived: 7 } as CallMediaStats
		},
		async openCallPcmWriter() {
			return {
				tryWrite(samples) {
					sent.push(samples.slice())
					return true
				},
				close() {
					counts.writersClosed++
				}
			}
		},
		async openCallVideoWriter() {
			return {
				tryWrite() {
					return true
				},
				close() {}
			}
		},
		onCallPcm(id, sink) {
			pcm.set(id, sink)
			return () => pcm.delete(id)
		},
		onCallVideo(id, sink) {
			video.set(id, sink)
			return () => video.delete(id)
		},
		async startCallVideo() {},
		async acceptCallVideo() {},
		async stopCallVideo() {},
		async resumeCallVideo() {},
		async retryCallVideoUpgrade() {},
		async requestCallKeyframe() {},
		async getCallVideoDiagnostics() {
			return { selfState: 0, peerState: 0, upgradeTimeoutMs: 0 }
		}
	}
	const runtime: CallSessionRuntime = {
		events,
		async start(id, incoming, _video, signal) {
			signal.throwIfAborted()
			counts.starts++
			return incoming ? id : `OUT-${counts.starts}`
		},
		isClosing: () => closing,
		isTerminal: id => terminal.has(id),
		onSocketEnd(handler) {
			onEnd = handler
		},
		reportError(error) {
			errors.push(error)
		}
	}
	const api = createVoipApi(operations, runtime)
	return {
		api,
		runtime,
		operations,
		events,
		pcm,
		video,
		sent,
		counts,
		errors,
		terminal,
		async close() {
			closing = true
			await onEnd()
		}
	}
}

describe('managed call sessions', () => {
	it('owns PCM streams, call binding and idempotent end', async () => {
		const h = harness()
		let cancelled = 0,
			aborted = 0
		const input = new ReadableStream<Int16Array>({
			start(controller) {
				controller.enqueue(new Int16Array(960).fill(12))
			},
			cancel() {
				cancelled++
			}
		})
		const output = new WritableStream<Int16Array>({
			abort() {
				aborted++
			}
		})
		const call = await h.api.call('peer', { media: () => ({ audio: { input, output } }) })
		await tick()
		assert.equal(h.sent[0]?.[0], 12)
		assert.equal((await call.stats()).io.audioInputAccepted, 1)
		const a = call.end(),
			b = call.end()
		assert.equal(a, b)
		await a
		assert.equal((await call.closed).reason, 'local')
		assert.equal(cancelled, 1)
		assert.equal(aborted, 1)
		assert.equal(h.counts.writersClosed, 1)
		assert.equal(h.counts.ends, 1)
		assert.equal(h.api.active.length, 0)
		assert.equal(input.locked, false)
		assert.equal(output.locked, false)
		assert.equal(h.events.listenerCount('call.media'), 0)
		assert.deepEqual(h.errors, [])
	})
	it('cleans up on remote termination without issuing another hangup', async () => {
		const h = harness()
		const call = await h.api.call('peer')
		h.events.emit('call.media', { callId: call.id, kind: 'ended' })
		assert.equal((await call.closed).reason, 'remote')
		assert.equal(h.counts.ends, 0)
		assert.equal(h.api.active.length, 0)
		await assert.rejects(call.setMuted(true), /closed/)
	})
	it('does not start an already-aborted operation', async () => {
		const h = harness(),
			controller = new AbortController()
		controller.abort()
		await assert.rejects(h.api.call('peer', { signal: controller.signal }), { name: 'AbortError' })
		assert.equal(h.counts.starts, 0)
		assert.equal(h.events.listenerCount('call'), 0)
	})
	it('cancels promptly during native admission and owns the eventual call ID', async () => {
		const h = harness(),
			native = deferred<string>(),
			controller = new AbortController()
		h.runtime.start = async () => {
			h.counts.starts++
			return native.promise
		}
		const starting = h.api.call('peer', { signal: controller.signal })
		await tick()
		controller.abort()
		await assert.rejects(starting, { name: 'AbortError' })
		native.resolve('LATE')
		await tick()
		assert.equal(h.counts.terminates, 1)
		assert.equal(h.api.active.length, 0)
		assert.equal(h.events.listenerCount('call'), 0)
	})
	it('cancels a pending media factory and disposes its late resources', async () => {
		const h = harness(),
			factory = deferred<CallSessionMedia>(),
			controller = new AbortController()
		let cancelled = 0,
			aborted = 0
		const starting = h.api.call('peer', { signal: controller.signal, media: () => factory.promise })
		await tick()
		controller.abort()
		await assert.rejects(starting)
		factory.resolve({
			audio: {
				input: new ReadableStream({
					cancel() {
						cancelled++
					}
				}),
				output: new WritableStream({
					abort() {
						aborted++
					}
				})
			}
		})
		await tick()
		assert.equal(cancelled, 1)
		assert.equal(aborted, 1)
		assert.equal(h.counts.ends, 1)
		assert.equal(h.api.active.length, 0)
	})
	it('deduplicates repeated acceptance of an offer while admission is pending', async () => {
		const h = harness(),
			native = deferred<string>()
		h.runtime.start = async () => {
			h.counts.starts++
			return native.promise
		}
		const a = h.api.accept(offer),
			b = h.api.accept(offer)
		assert.equal(a, b)
		await tick()
		native.resolve(offer.id)
		const call = await a
		assert.equal(await h.api.accept(offer), call)
		assert.equal(h.counts.starts, 1)
		await call.end()
	})
	it('terminates the session on a media sink failure', async () => {
		const h = harness(),
			failure = new Error('playback failed')
		const call = await h.api.call('peer', {
			media: () => ({
				audio: {
					output: new WritableStream({
						write() {
							throw failure
						}
					})
				}
			})
		})
		h.pcm.get(call.id)!({ callId: call.id, data: new Int16Array(960) })
		const reason = await call.closed
		await tick()
		assert.equal(reason.reason, 'media-error')
		assert.equal(reason.error, failure)
		assert.equal(h.counts.ends, 1)
		assert.equal(h.pcm.size, 0)
	})
	it('bounds a slow output queue and reports dropped frames', async () => {
		const h = harness(),
			writing = deferred<void>()
		let delivered = 0
		const call = await h.api.call('peer', {
			media: () => ({
				audio: {
					output: new WritableStream({
						write() {
							delivered++
							return writing.promise
						}
					})
				}
			})
		})
		for (let index = 0; index < 100; index++) h.pcm.get(call.id)!({ callId: call.id, data: new Int16Array(960) })
		await tick()
		assert.equal(delivered, 1)
		assert.equal((await call.stats()).io.audioOutputDropped, 99)
		writing.resolve()
		await call.end()
	})
	it('retains retryable peer notification after an unsuccessful end', async () => {
		const h = harness()
		h.operations.endCall = async () => {
			h.counts.ends++
			return { outcome: 'local-only', failure: 'offline' }
		}
		h.operations.terminateCall = async () => {
			if (++h.counts.terminates === 1) throw new Error('signal failed')
		}
		const call = await h.api.call('peer')
		await assert.rejects(call.end(), /signal failed/)
		assert.equal((await call.closed).reason, 'local')
		assert.deepEqual(await call.end(), { outcome: 'peer-notified' })
		await call.end()
		assert.equal(h.counts.terminates, 2)
		assert.equal(h.counts.ends, 2)
	})
	it('disposes live sessions on socket teardown and refuses new calls', async () => {
		const h = harness()
		const call = await h.api.call('peer')
		await h.close()
		assert.equal((await call.closed).reason, 'socket-closed')
		assert.equal(h.counts.ends, 0)
		await assert.rejects(h.api.call('another'), /Connection Closed/)
	})
})

describe('managed call cancellation and media replacement', () => {
	it('retires an admitted call that ended before the start result arrived', async () => {
		const h = harness(),
			native = deferred<string>()
		h.runtime.start = async () => native.promise
		const starting = h.api.call('peer')
		await tick()
		h.terminal.add('LATE')
		native.resolve('LATE')
		await assert.rejects(starting, /ended during startup/)
		await tick()
		assert.equal(h.counts.terminates, 1)
		assert.equal(h.events.listenerCount('call'), 0)
	})
	it('cancels while a PCM writer is being acquired and closes its late lease', async () => {
		const h = harness(),
			opening = deferred<CallPcmWriter>(),
			controller = new AbortController()
		let cancelled = 0,
			closed = 0
		h.operations.openCallPcmWriter = () => opening.promise
		const starting = h.api.call('peer', {
			signal: controller.signal,
			media: () => ({
				audio: {
					input: new ReadableStream({
						cancel() {
							cancelled++
						}
					})
				}
			})
		})
		await tick()
		controller.abort()
		await assert.rejects(starting)
		opening.resolve({
			tryWrite() {
				throw new Error('late writer must not push')
			},
			close() {
				closed++
			}
		})
		await tick()
		assert.equal(cancelled, 1)
		assert.equal(closed, 1)
		assert.equal(h.counts.ends, 1)
	})
	it('does not steal an output stream already owned by another writer', async () => {
		const h = harness()
		let cancelled = 0,
			aborted = 0
		const input = new ReadableStream<Int16Array>({
			cancel() {
				cancelled++
			}
		})
		const output = new WritableStream<Int16Array>({
			abort() {
				aborted++
			}
		})
		const owner = output.getWriter()
		await assert.rejects(h.api.call('peer', { media: () => ({ audio: { input, output } }) }), /unlocked/)
		await tick()
		assert.equal(cancelled, 1)
		assert.equal(aborted, 0)
		assert.equal(output.locked, true)
		owner.releaseLock()
	})
	it('releases the session even if the source refuses to finish cancellation', { timeout: 3000 }, async () => {
		const h = harness()
		const input = new ReadableStream<Int16Array>({
			cancel() {
				return new Promise(() => {})
			}
		})
		const call = await h.api.call('peer', { media: () => ({ audio: { input } }) })
		await call.end()
		assert.equal(call.lifecycle, 'closed')
		assert.equal(input.locked, false)
		assert.ok(h.errors.some(error => error instanceof Error && /cleanup exceeded/.test(error.message)))
	})
	it('supports reentrant end from a media abort listener without duplicate native calls', async () => {
		const h = harness()
		let repeated: Promise<unknown> | undefined
		const call = await h.api.call('peer', {
			media: (session, signal) => {
				signal.addEventListener(
					'abort',
					() => {
						repeated = session.end()
					},
					{ once: true }
				)
				return {}
			}
		})
		const ending = call.end()
		assert.equal(ending, repeated)
		await ending
		assert.equal(h.counts.ends, 1)
	})
	it('does not hang up again when a remotely closed session is disposed', async () => {
		const h = harness(),
			call = await h.api.call('peer')
		h.events.emit('call.media', { callId: call.id, kind: 'ended' })
		await call.closed
		await call[Symbol.asyncDispose]()
		assert.deepEqual(await call.end(), { outcome: 'already-ended' })
		assert.equal(h.counts.ends, 0)
	})
	it('opens video sources only after negotiation and recreates them after stop/resume', async () => {
		const h = harness()
		let opened = 0,
			cancelled = 0,
			stopped = 0
		h.operations.startCallVideo = async () => {
			opened++
		}
		const call = await h.api.call('peer', {
			media: () => ({
				video: (_session, signal) => {
					assert.ok(opened > 0)
					stopped += signal.aborted ? 1 : 0
					return {
						input: new ReadableStream<Uint8Array>({
							cancel() {
								cancelled++
							}
						})
					}
				}
			})
		})
		assert.equal(opened, 0)
		await call.video.start()
		assert.equal(h.video.size, 0)
		await call.video.stop()
		assert.equal(cancelled, 1)
		await call.video.resume()
		await call.end()
		assert.equal(cancelled, 2)
		assert.equal(stopped, 0)
	})
	it('a stop supersedes a video start waiting on native admission', async () => {
		const h = harness(),
			native = deferred<void>()
		let created = 0
		h.operations.startCallVideo = () => native.promise
		const call = await h.api.call('peer', {
			media: () => ({
				video: () => {
					created++
					return {}
				}
			})
		})
		const starting = call.video.start()
		await tick()
		const stopping = call.video.stop()
		const cancelled = assert.rejects(starting, { name: 'AbortError' })
		native.resolve()
		await Promise.all([stopping, cancelled])
		assert.equal(created, 0)
		await call.end()
	})
	it('disposes a video factory resolving after stop without touching the next generation', async () => {
		const h = harness(),
			factory = deferred<CallSessionVideoMedia>()
		let created = 0,
			cancelled = 0
		const call = await h.api.call('peer', { media: () => ({ video: () => (++created === 1 ? factory.promise : {}) }) })
		const starting = call.video.start()
		await tick()
		await call.video.stop()
		await assert.rejects(starting)
		await call.video.resume()
		factory.resolve({
			input: new ReadableStream({
				cancel() {
					cancelled++
				}
			})
		})
		await tick()
		assert.equal(cancelled, 1)
		assert.equal(call.lifecycle, 'open')
		await call.end()
	})
})

describe('managed encoder feedback', () => {
	it('routes keyframe requests only to the current video source', async () => {
		const h = harness()
		let requests = 0
		const call = await h.api.call('peer@s.whatsapp.net', {
			video: true,
			media: () => ({
				video: () => ({
					requestKeyframe() {
						requests++
					}
				})
			})
		})
		h.events.emit('call.media', { kind: 'video-keyframe-needed', callId: call.id })
		await tick()
		assert.equal(requests, 1)
		h.events.emit('call.media', { kind: 'video-keyframe-needed', callId: call.id })
		await call.video.stop()
		h.events.emit('call.media', { kind: 'video-keyframe-needed', callId: call.id })
		await tick()
		assert.equal(requests, 1)
		await call.end()
	})
	it('ends an idle call when its output stream errors before the first frame', async () => {
		const h = harness()
		let output!: WritableStreamDefaultController
		const call = await h.api.call('peer@s.whatsapp.net', {
			media: () => ({
				audio: {
					output: new WritableStream({
						start(controller) {
							output = controller
						}
					})
				}
			})
		})
		output.error(new Error('speaker disconnected'))
		assert.equal((await call.closed).reason, 'media-error')
		await tick()
		assert.equal(h.counts.ends, 1)
	})
})

describe('video cancellation and native ordering', () => {
	it('keeps audio alive when an initial video factory is cancelled remotely', async () => {
		const h = harness(),
			factory = deferred<CallSessionVideoMedia>(),
			entered = deferred<CallSession>()
		const opening = h.api.call('peer', {
			video: true,
			media: () => ({
				video: session => {
					entered.resolve(session)
					return factory.promise
				}
			})
		})
		const pending = await entered.promise
		h.events.emit('call.media', { kind: 'video-state-changed', state: 0, callId: pending.id })
		const call = await opening
		assert.equal(call.lifecycle, 'open')
		assert.equal(h.counts.ends, 0)
		assert.equal(h.api.active.length, 1)
		factory.resolve({})
		await tick()
		await call.end()
	})
	it('does not let an old stop reach the engine after a new resume', async () => {
		const h = harness(),
			disposing = deferred<void>(),
			entered = deferred<void>()
		const native: string[] = []
		h.operations.stopCallVideo = async () => {
			native.push('stop')
		}
		h.operations.resumeCallVideo = async () => {
			native.push('resume')
		}
		let created = 0
		const call = await h.api.call('peer', {
			video: true,
			media: () => ({
				video: () =>
					++created === 1
						? {
								dispose() {
									entered.resolve()
									return disposing.promise
								}
							}
						: {}
			})
		})
		const stopping = call.video.stop()
		await entered.promise
		await call.video.resume()
		disposing.resolve()
		await stopping
		assert.deepEqual(native, ['stop', 'resume'])
		assert.equal(created, 2)
		assert.equal(call.lifecycle, 'open')
		await call.end()
	})
})

describe('managed acceptance completion', () => {
	it('closes a pending media factory when another device accepted the call', async () => {
		const h = harness(),
			entered = deferred<CallSession>(),
			factory = deferred<CallSessionMedia>()
		const opening = h.api.accept(offer, {
			media: session => {
				entered.resolve(session)
				return factory.promise
			}
		})
		const call = await entered.promise
		h.terminal.add(call.id)
		h.events.emit('call', [{ ...offer, status: 'accept' }])
		factory.resolve({})
		await assert.rejects(opening)
		assert.equal((await call.closed).reason, 'remote')
		assert.equal(h.api.active.length, 0)
		assert.equal(h.counts.ends, 0)
	})
	it('shares pending media setup and its failure with repeated acceptance', async () => {
		const h = harness(),
			entered = deferred<void>(),
			factory = deferred<CallSessionMedia>()
		const first = h.api.accept(offer, {
			media: () => {
				entered.resolve()
				return factory.promise
			}
		})
		await entered.promise
		const second = h.api.accept(offer)
		const results = Promise.allSettled([first, second])
		factory.reject(new Error('microphone unavailable'))
		const settled = await results
		assert.deepEqual(
			settled.map(result => result.status),
			['rejected', 'rejected']
		)
		assert.equal(first, second)
	})
})

describe('media disposer receivers', () => {
	it('keeps audio and video disposer receivers during normal teardown', async () => {
		const h = harness()
		let released = 0
		const channel = () => ({
			device: {
				close() {
					released++
				}
			},
			dispose() {
				this.device.close()
			}
		})
		const audio = channel(),
			video = channel()
		const call = await h.api.call('peer', { video: true, media: () => ({ audio, video: () => video }) })
		await call.end()
		assert.equal(released, 2)
		assert.deepEqual(h.errors, [])
	})
	it('keeps the audio disposer receiver when a factory resolves after cancellation', async () => {
		const h = harness(),
			factory = deferred<CallSessionMedia>(),
			entered = deferred<void>(),
			abort = new AbortController()
		let released = 0
		const opening = h.api.call('peer', {
			signal: abort.signal,
			media: () => {
				entered.resolve()
				return factory.promise
			}
		})
		await entered.promise
		abort.abort()
		await assert.rejects(opening)
		const audio = {
			device: {
				close() {
					released++
				}
			},
			dispose() {
				this.device.close()
			}
		}
		factory.resolve({ audio })
		await tick()
		assert.equal(released, 1)
		assert.deepEqual(h.errors, [])
	})
})
