import { createCallMediaScope, type CallMediaClock } from './call-media-streams.ts'
import { createCallPcmFramer, validateCallPcmFormat } from './call-pcm.ts'
import type {
	CallAudioInputOptions,
	CallAudioOutputOptions,
	CallSessionAudio,
	CallSessionIoStats,
	CallSessionOperations
} from '../Types/CallSession.ts'

const MAX_RECEIVERS = 8
const OUTPUT_SAMPLE_BUDGET = 960
const abortError = () => new DOMException('Audio source stopped', 'AbortError')

export const createCallAudio = (config: {
	id: string
	signal: AbortSignal
	ready: Promise<void>
	operations: Pick<CallSessionOperations, 'openCallPcmWriter' | 'onCallPcm'>
	io: CallSessionIoStats
	reportError(error: unknown, message: string): void
	clock?: CallMediaClock
}) => {
	let readiness: { state: 'pending' } | { state: 'ready' } | { state: 'failed'; error: unknown } = { state: 'pending' }
	const readyWaiters = new Set<{ resolve(): void; reject(error: unknown): void }>()
	void config.ready.then(
		() => {
			readiness = { state: 'ready' }
			for (const waiter of readyWaiters) waiter.resolve()
		},
		error => {
			readiness = { state: 'failed', error }
			for (const waiter of readyWaiters) waiter.reject(error)
		}
	)
	const waitReady = (signal: AbortSignal): Promise<void> => {
		if (signal.aborted) return Promise.reject(signal.reason)
		if (readiness.state === 'ready') return Promise.resolve()
		if (readiness.state === 'failed') return Promise.reject(readiness.error)
		return new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				readyWaiters.delete(waiter)
				signal.removeEventListener('abort', abort)
			}
			const abort = () => {
				cleanup()
				reject(signal.reason)
			}
			const waiter = {
				resolve() {
					cleanup()
					resolve()
				},
				reject(error: unknown) {
					cleanup()
					reject(error)
				}
			}
			readyWaiters.add(waiter)
			signal.addEventListener('abort', abort, { once: true })
		})
	}
	let closed = config.signal.aborted
	const pacing = { nextAt: 0 }
	let active: { scope: ReturnType<typeof createCallMediaScope> } | undefined
	const receivers = new Set<() => void>()
	const stop = async () => {
		const previous = active
		active = undefined
		await previous?.scope.close()
	}
	let closing: Promise<void> | undefined
	const close = (): Promise<void> => {
		if (closing) return closing
		closed = true
		closing = Promise.resolve().then(stop)
		config.signal.removeEventListener('abort', onAbort)
		for (const finish of receivers) finish()
		return closing
	}
	const onAbort = () => {
		void close()
	}
	config.signal.addEventListener('abort', onAbort, { once: true })

	const start = (
		input: ReadableStream<Int16Array>,
		options: CallAudioInputOptions = {},
		failed?: (error: unknown) => void
	) => {
		if (closed || config.signal.aborted) throw new Error('Call session is closed')
		validateCallPcmFormat(options.format)
		if (!input || typeof input.getReader !== 'function' || input.locked)
			throw new TypeError('audio input must be an unlocked ReadableStream')
		const signal = options.signal
		signal?.throwIfAborted()
		const scope = createCallMediaScope(
			config.signal,
			() => {},
			(error, message) => config.reportError(error, message),
			config.clock
		)
		const previous = active
		const current = { scope }
		active = current
		const stopping = previous?.scope.close()
		let adopted = false
		scope.own({ dispose: () => (!adopted && !input.locked ? input.cancel(scope.signal.reason) : undefined) })
		const abort = () => {
			void scope.close()
		}
		signal?.addEventListener('abort', abort, { once: true })
		let resolveOpened!: () => void, rejectOpened!: (error: unknown) => void
		const opened = new Promise<void>((resolve, reject) => {
			resolveOpened = resolve
			rejectOpened = reject
		})
		void opened.catch(() => undefined)
		let setupComplete = false
		const done = (async () => {
			try {
				await stopping
				if (active !== current || scope.signal.aborted) throw abortError()
				const lease = await scope.input(
					input,
					config.operations.openCallPcmWriter(config.id),
					() => {
						config.io.audioInputAccepted++
					},
					() => {
						config.io.audioInputShed++
					},
					60,
					createCallPcmFramer(),
					waitReady(scope.signal),
					pacing
				)
				adopted = true
				setupComplete = true
				resolveOpened()
				await scope.wait(lease.done)
				if (scope.signal.aborted) throw signal?.aborted ? signal.reason : abortError()
			} catch (error) {
				// Detaching a source must not fail the enclosing media factory startup.
				if (scope.signal.aborted && !config.signal.aborted) resolveOpened()
				else rejectOpened(error)
				if (setupComplete && !scope.signal.aborted) failed?.(error)
				throw signal?.aborted ? signal.reason : error
			} finally {
				signal?.removeEventListener('abort', abort)
				await scope.close()
				if (active === current) active = undefined
			}
		})()
		void done.catch(() => undefined)
		return { opened, done }
	}
	const receive = (options: CallAudioOutputOptions = {}): ReadableStream<Int16Array> => {
		if (closed || config.signal.aborted) throw new Error('Call session is closed')
		const signal = options.signal
		signal?.throwIfAborted()
		if (options.onDrop !== undefined && typeof options.onDrop !== 'function')
			throw new TypeError('onDrop must be a function')
		if (receivers.size >= MAX_RECEIVERS) throw new RangeError(`A call supports at most ${MAX_RECEIVERS} PCM receivers`)
		let finish!: () => void, cancelReceiver!: () => void
		return new ReadableStream<Int16Array>(
			{
				start(controller) {
					let stopped = false,
						dropped = 0
					const cleanup = () => {
						if (stopped) return false
						stopped = true
						unsubscribe()
						signal?.removeEventListener('abort', abort)
						receivers.delete(finish)
						return true
					}
					let unsubscribe = () => {}
					const abort = () => {
						if (cleanup()) controller.error(signal!.reason)
					}
					finish = () => {
						if (cleanup()) controller.close()
					}
					cancelReceiver = () => {
						cleanup()
					}
					receivers.add(finish)
					signal?.addEventListener('abort', abort, { once: true })
					try {
						unsubscribe = config.operations.onCallPcm(config.id, frame => {
							if (stopped || closed) return
							const weight = Math.max(320, frame.data.length)
							if ((controller.desiredSize ?? 0) < weight || frame.data.length > OUTPUT_SAMPLE_BUDGET) {
								config.io.audioOutputDropped++
								dropped++
								try {
									options.onDrop?.(dropped)
								} catch (error) {
									config.reportError(error, 'reporting audio output drop')
								}
							} else controller.enqueue(frame.data.slice())
						})
					} catch (error) {
						cleanup()
						throw error
					}
					if (stopped || closed) unsubscribe()
				},
				cancel() {
					cancelReceiver()
				}
			},
			{ highWaterMark: OUTPUT_SAMPLE_BUDGET, size: samples => Math.max(320, samples.length) }
		)
	}
	const api: CallSessionAudio = {
		format: Object.freeze({ sampleRate: 16000, channels: 1 }),
		async play(input, options) {
			await start(input, options).done
		},
		stop,
		receive
	}
	return { api, start, close }
}
