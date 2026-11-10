/**
 * Minimal FIFO mutex for compatibility helpers that operate before a bridge
 * client exists. Operational socket concurrency remains owned by Rust.
 */
export class AsyncMutex {
	private tail: Promise<void> = Promise.resolve()
	private pending = 0

	async runExclusive<T>(work: () => Promise<T> | T): Promise<T> {
		let release!: () => void
		const ticket = new Promise<void>(resolve => {
			release = resolve
		})
		const previous = this.tail
		this.tail = ticket
		this.pending++

		await previous
		try {
			return await work()
		} finally {
			this.pending--
			release()
		}
	}

	isLocked(): boolean {
		return this.pending > 0
	}
}

/** A rejection-safe, concurrency-one task queue. */
export class SerialQueue {
	private tail: Promise<void> = Promise.resolve()

	add<T>(work: () => Promise<T> | T): Promise<T> {
		const result = this.tail.then(work, work)
		this.tail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}
}
