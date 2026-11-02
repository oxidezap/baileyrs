export interface MediaInputWriter<T> {
	tryWrite(value: T): boolean
	close(): void
}

export const closeCallMedia = async (
	tasks: Promise<unknown>[],
	report: (error: unknown, message: string) => void
): Promise<void> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	const observed = Promise.all(tasks.map(task => task.catch(error => report(error, 'closing call media'))))
	try {
		await Promise.race([
			observed,
			new Promise<void>(resolve => {
				timer = setTimeout(() => {
					report(new Error('Call media cleanup exceeded 1000ms'), 'closing call media')
					resolve()
				}, 1000)
			})
		])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

export interface MediaInputFramer<T> {
	write(chunk: T): void
	read(): T | undefined
	end(): void
	readonly done: boolean
}

export interface CallMediaClock {
	now(): number
	alarm(callback: () => void, delayMs: number): () => void
}

const defaultClock: CallMediaClock = {
	now: () => performance.now(),
	alarm(callback, delayMs) {
		const timer = setTimeout(callback, delayMs)
		return () => clearTimeout(timer)
	}
}

export const createCallMediaScope = (
	parent: AbortSignal,
	failed: (error: unknown) => void,
	report: (error: unknown, message: string) => void,
	clock: CallMediaClock = defaultClock
) => {
	const controller = new AbortController()
	const signal = controller.signal
	const cleanup: Array<() => unknown> = []
	let closing: Promise<void> | undefined
	const close = (): Promise<void> => {
		if (closing) return closing
		let settled!: () => void
		closing = new Promise<void>(resolve => {
			settled = resolve
		})
		controller.abort(new DOMException('Media stream closed', 'AbortError'))
		parent.removeEventListener('abort', onAbort)
		const tasks = cleanup.splice(0).map(stop => Promise.resolve().then(stop))
		void closeCallMedia(tasks, report).then(settled, error => {
			try {
				report(error, 'closing media scope')
			} finally {
				settled()
			}
		})
		return closing
	}

	const onAbort = () => {
		void close()
	}
	parent.addEventListener('abort', onAbort, { once: true })
	if (parent.aborted) void close()
	const wait = <T>(operation: Promise<T>): Promise<T> => {
		return new Promise<T>((resolve, reject) => {
			const detach = () => signal.removeEventListener('abort', cancelWait)
			const cancelWait = () => {
				detach()
				reject(signal.reason)
			}
			if (signal.aborted) cancelWait()
			else signal.addEventListener('abort', cancelWait, { once: true })
			operation.then(
				value => {
					detach()
					resolve(value)
				},
				error => {
					detach()
					reject(error)
				}
			)
		})
	}
	const own = (streams: {
		input?: { locked: boolean; cancel(reason?: unknown): Promise<void> }
		output?: { locked: boolean; abort(reason?: unknown): Promise<void> }
		dispose?: () => void | Promise<void>
	}) => {
		const release = () => {
			const tasks: Promise<unknown>[] = []
			if (streams.dispose) tasks.push(Promise.resolve().then(() => streams.dispose?.()))
			if (streams.input && !streams.input.locked) tasks.push(streams.input.cancel(signal.reason))
			if (streams.output && !streams.output.locked) tasks.push(streams.output.abort(signal.reason))
			return Promise.all(tasks)
		}
		if (signal.aborted) void closeCallMedia([Promise.resolve().then(release)], report)
		else cleanup.push(release)
	}
	const input = async <T>(
		stream: ReadableStream<T>,
		opening: Promise<MediaInputWriter<T>>,
		accepted: () => void,
		shed: () => void,
		frameMs?: number,
		framer?: MediaInputFramer<T>,
		start?: Promise<void>,
		pacing?: { nextAt: number }
	): Promise<{ done: Promise<void> }> => {
		// Readiness can reject before the native writer finishes opening.
		void start?.catch(() => undefined)
		const acquiring = opening.then(writer => {
			let released = false
			const release = () => {
				if (!released) {
					released = true
					writer.close()
				}
			}
			if (signal.aborted) release()
			return { writer, release }
		})
		void acquiring.catch(() => undefined)
		const lease = await wait(acquiring)
		if (signal.aborted) {
			lease.release()
			signal.throwIfAborted()
		}
		cleanup.push(lease.release)
		const reader = stream.getReader()
		let unlocked = false
		let cancelling: Promise<void> | undefined
		cleanup.push(() => cancelling ?? (unlocked ? undefined : reader.cancel(signal.reason)))
		const delay = async (ms: number) => {
			let cancel: (() => void) | undefined
			try {
				await wait(
					new Promise<void>(resolve => {
						cancel = clock.alarm(resolve, ms)
					})
				)
			} finally {
				cancel?.()
			}
		}
		const pump = async () => {
			let nextAt = 0
			const send = async (packet: T): Promise<boolean> => {
				if (frameMs !== undefined && nextAt > clock.now()) await delay(nextAt - clock.now())
				if (signal.aborted) return false
				if (lease.writer.tryWrite(packet)) accepted()
				else shed()
				if (frameMs !== undefined) {
					nextAt += frameMs
					const now = clock.now()
					if (nextAt <= now) nextAt = now + frameMs
					if (pacing) pacing.nextAt = nextAt
				}
				return true
			}
			try {
				if (start) await wait(start)
				nextAt = Math.max(pacing?.nextAt ?? 0, clock.now())
				if (framer) {
					const framing = framer
					const readChunk = async () => {
						const result = await reader.read()
						if (result.done) framing.end()
						else framing.write(result.value)
					}
					let readsWithoutFrame = 0
					while (!signal.aborted) {
						let packet = framing.read()
						if (packet !== undefined) {
							readsWithoutFrame = 0
							if (!(await send(packet))) break
							packet = undefined
						} else if (framing.done) break
						else {
							await readChunk()
							if (++readsWithoutFrame === 256) {
								await delay(0)
								readsWithoutFrame = 0
							}
						}
					}
				} else
					for (;;) {
						const frame = await reader.read()
						if (frame.done || signal.aborted || !(await send(frame.value))) break
					}
			} catch (error) {
				// Release capture/process resources even when framing or writing fails.
				cancelling = reader.cancel(error)
				void cancelling.catch(() => undefined)
				throw error
			} finally {
				lease.release()
				reader.releaseLock()
				unlocked = true
			}
		}
		const done = pump()
		void done.catch(error => {
			if (!signal.aborted) failed(error)
		})
		return { done }
	}

	const output = <T, TFrame>(
		stream: WritableStream<T>,
		listen: (sink: (frame: TFrame) => void) => () => void,
		snapshot: (frame: TFrame) => T,
		dropped: () => void
	): void => {
		signal.throwIfAborted()
		const writer = stream.getWriter()
		void writer.closed.catch(error => {
			if (!signal.aborted) failed(error)
		})
		cleanup.push(() => {
			const ending = writer.abort(signal.reason)
			writer.releaseLock()
			return ending
		})
		let writing = false
		const stop = listen(frame => {
			if (signal.aborted) return
			if (writing || writer.desiredSize === null || writer.desiredSize <= 0) {
				dropped()
				return
			}
			writing = true
			try {
				void writer.write(snapshot(frame)).then(
					() => {
						writing = false
					},
					error => {
						writing = false
						if (!signal.aborted) failed(error)
					}
				)
			} catch (error) {
				writing = false
				if (!signal.aborted) failed(error)
			}
		})
		cleanup.push(stop)
	}
	return { signal, wait, own, input, output, close }
}
