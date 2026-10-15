/** A timeout reports an incomplete barrier. It never cancels a backend
 * transaction, clears its ownership, or certifies its pending writes.
 */
export class StoreFlushTimeoutError extends Error {
	readonly code = 'ERR_STORE_FLUSH_TIMEOUT'
	constructor(label: string) {
		super(`${label} did not quiesce within 30s; backend operations remain pending`)
		this.name = 'StoreFlushTimeoutError'
	}
}

export const flushDeadlineError = (label: string, errors: Iterable<unknown> = []): Error => {
	const timeout = new StoreFlushTimeoutError(label)
	const previous = [...errors]
	return previous.length ? new AggregateError([...previous, timeout], timeout.message, { cause: timeout }) : timeout
}

export async function settleBeforeFlushDeadline(
	operations: Iterable<Promise<unknown>>,
	deadline: number,
	label: string,
	errors: Set<unknown>
): Promise<void> {
	// Capture each rejection when it settles. Waiting for allSettled first
	// loses known backend failures if another operation exceeds the deadline.
	const observed = [...operations].map(operation =>
		operation.catch(error => {
			errors.add(error)
			throw error
		})
	)
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			Promise.allSettled(observed),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(flushDeadlineError(label, errors)), Math.max(0, deadline - Date.now()))
			})
		])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}
