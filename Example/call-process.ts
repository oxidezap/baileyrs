import type { ChildProcess } from 'node:child_process'
import { Readable } from 'node:stream'

const watch = (child: ChildProcess, signal: AbortSignal) => {
	let stopping = false
	let finished = false
	let failure: Error | undefined
	const closed = new Promise<number | null>(resolve => {
		child.once('error', error => {
			failure = error
		})
		child.once('close', code => {
			finished = true
			signal.removeEventListener('abort', onAbort)
			resolve(code)
		})
	})
	const stop = async () => {
		stopping = true
		if (!finished) child.kill('SIGKILL')
		await closed
	}
	const onAbort = () => {
		void stop()
	}
	signal.addEventListener('abort', onAbort, { once: true })
	if (signal.aborted) void stop()
	return {
		closed,
		stop,
		get stopping() {
			return stopping
		},
		get failure() {
			return failure
		}
	}
}

export const processInput = <T>(
	child: ChildProcess,
	signal: AbortSignal,
	splitter: { push(bytes: Uint8Array): T[]; flush(): T[] }
): { input: ReadableStream<T>; dispose(): Promise<void> } => {
	const lifetime = watch(child, signal)
	if (!child.stdout) {
		void lifetime.stop()
		throw new Error('Encoder has no stdout')
	}
	const reader = Readable.toWeb(child.stdout).getReader()
	let pending: T[] = []
	let ended = false
	let unlocked = false
	const unlock = () => {
		if (!unlocked) {
			unlocked = true
			reader.releaseLock()
		}
	}
	const input = new ReadableStream<T>(
		{
			async pull(controller) {
				try {
					while (!pending.length && !ended) {
						const chunk = await reader.read()
						if (chunk.done) {
							ended = true
							const code = await lifetime.closed
							if (!lifetime.stopping && (lifetime.failure || code !== 0))
								throw lifetime.failure ?? new Error(`Encoder exited with ${code}`)
							pending = lifetime.stopping ? [] : splitter.flush()
							unlock()
						} else {
							if (!(chunk.value instanceof Uint8Array)) throw new TypeError('Encoder stdout must contain bytes')
							pending.push(...splitter.push(chunk.value))
						}
					}
					if (pending.length) controller.enqueue(pending.shift()!)
					else controller.close()
				} catch (error) {
					controller.error(error)
					void lifetime.stop()
					if (!unlocked) unlock()
				}
			},
			async cancel(reason) {
				try {
					await Promise.all([unlocked ? Promise.resolve() : reader.cancel(reason), lifetime.stop()])
				} finally {
					pending = []
					if (!unlocked) unlock()
				}
			}
		},
		{ highWaterMark: 1 }
	)
	return { input, dispose: lifetime.stop }
}

export const processSink = (child: ChildProcess, signal: AbortSignal, failed: (error: Error) => void) => {
	const lifetime = watch(child, signal)
	let reported = false
	const report = (error: Error) => {
		if (reported || lifetime.stopping) return
		reported = true
		failed(error)
	}
	child.on('error', error => {
		report(error)
	})
	child.stdin?.on('error', error => {
		report(error)
	})
	void lifetime.closed.then(code => {
		report(lifetime.failure ?? new Error(`Playback exited with ${code}`))
	})
	return {
		write(bytes: Uint8Array): Promise<void> {
			return new Promise((resolve, reject) => {
				if (!child.stdin || child.stdin.destroyed || lifetime.stopping) {
					reject(new Error('Playback is closed'))
					return
				}
				child.stdin.write(bytes, error => (error ? reject(error) : resolve()))
			})
		},
		stop: lifetime.stop
	}
}

/** Restarting ffmpeg starts a fresh H.264 stream with SPS/PPS and an IDR. */
export const restartableProcessInput = <T>(open: () => ReturnType<typeof processInput<T>>, signal: AbortSignal) => {
	const acquire = () => {
		const source = open()
		const reader = source.input.getReader()
		let releasing: Promise<void> | undefined
		return {
			reader,
			release: () => (releasing ??= Promise.all([reader.cancel(), source.dispose()]).then(() => reader.releaseLock()))
		}
	}
	let current = acquire()
	let restart = false
	let stopped = false
	let lastRequest = -Infinity
	const input = new ReadableStream<T>({
		async pull(controller) {
			try {
				for (;;) {
					if (stopped || signal.aborted) {
						controller.close()
						return
					}
					if (restart) {
						await current.release()
						if (stopped || signal.aborted) {
							controller.close()
							return
						}
						current = acquire()
						restart = false
					}
					const frame = await current.reader.read()
					if (restart) continue
					if (frame.done) {
						controller.close()
						return
					}
					controller.enqueue(frame.value)
					return
				}
			} catch (error) {
				controller.error(error)
			}
		},
		async cancel() {
			stopped = true
			await current.release()
		}
	})
	return {
		input,
		requestKeyframe() {
			if (stopped || signal.aborted || performance.now() - lastRequest < 500) return
			lastRequest = performance.now()
			restart = true
			return current.reader.cancel()
		},
		async dispose() {
			stopped = true
			await current.release()
		}
	}
}
