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

export const createCallMediaScope = (
	parent: AbortSignal,
	failed: (error: unknown) => void,
	report: (error: unknown, message: string) => void
) => {
	const controller = new AbortController()
	const signal = controller.signal
	const cleanup: Array<() => unknown> = []
	let closing: Promise<void> | undefined
	let rejectClosed!: (reason: unknown) => void
	const closed = new Promise<never>((_resolve, reject) => {
		rejectClosed = reject
	})
	void closed.catch(() => undefined)
	const close = (): Promise<void> => {
		if (closing) return closing
		let settled!: () => void
		closing = new Promise<void>(resolve => {
			settled = resolve
		})
		controller.abort(new DOMException('Media stream closed', 'AbortError'))
		parent.removeEventListener('abort', onAbort)
		rejectClosed(signal.reason)
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
	const wait = async <T>(operation: Promise<T>): Promise<T> => {
		signal.throwIfAborted()
		return Promise.race([operation, closed])
	}
	const own = (streams: {
		input?: { locked: boolean; cancel(reason?: unknown): Promise<void> }
		output?: { locked: boolean; abort(reason?: unknown): Promise<void> }
		dispose?: () => void | Promise<void>
	}) => {
		const release = () => {
			const tasks: Promise<unknown>[] = []
			if (streams.dispose) tasks.push(Promise.resolve().then(streams.dispose))
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
		frameMs?: number
	): Promise<void> => {
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
		cleanup.push(() => (unlocked ? undefined : reader.cancel(signal.reason)))
		const pump = async () => {
			let nextAt = performance.now()
			try {
				for (;;) {
					const frame = await reader.read()
					if (frame.done || signal.aborted) break
					if (frameMs !== undefined && nextAt > performance.now()) {
						let timer: ReturnType<typeof setTimeout> | undefined
						try {
							await wait(
								new Promise<void>(resolve => {
									timer = setTimeout(resolve, nextAt - performance.now())
								})
							)
						} finally {
							if (timer !== undefined) clearTimeout(timer)
						}
					}
					if (signal.aborted) break
					if (lease.writer.tryWrite(frame.value)) accepted()
					else shed()
					if (frameMs !== undefined) nextAt = Math.max(nextAt + frameMs, performance.now())
				}
			} finally {
				lease.release()
				reader.releaseLock()
				unlocked = true
			}
		}
		void pump().catch(error => {
			if (!signal.aborted) failed(error)
		})
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
		const stop = listen(frame => {
			if (signal.aborted) return
			if (writer.desiredSize === null || writer.desiredSize <= 0) {
				dropped()
				return
			}
			void writer.write(snapshot(frame)).catch(error => {
				if (!signal.aborted) failed(error)
			})
		})
		cleanup.push(stop)
	}
	return { signal, wait, own, input, output, close }
}
