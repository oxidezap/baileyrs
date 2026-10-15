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
	errors: Map<Promise<unknown>, unknown>
): Promise<void> {
	// Capture each rejection when it settles. Waiting for allSettled first
	// loses known backend failures if another operation exceeds the deadline.
	const observed = [...operations].map(operation =>
		operation.catch(error => {
			errors.set(operation, error)
			throw error
		})
	)
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			Promise.allSettled(observed),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(flushDeadlineError(label, errors.values())), Math.max(0, deadline - Date.now()))
			})
		])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

/** Preserve individual failures and keep their messages visible to callers. */
export const settledFlushError = (label: string, errors: Iterable<unknown>): unknown => {
	const failures = [...errors]
	if (failures.length === 1) return failures[0]
	const messages = failures.map(error => {
		try {
			return String(error)
		} catch {
			return '<unprintable backend rejection>'
		}
	})
	return new AggregateError(failures, `${label}: ${messages.join('; ')}`)
}
