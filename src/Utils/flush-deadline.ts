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

type FlushFailures = Map<Promise<unknown>, unknown>
const origins = new WeakMap<Promise<unknown>, FlushFailures>()

/** Keep the original backend operations visible through a drain wrapper. */
export const trackFlushFailures = <T>(operation: Promise<T>, errors: FlushFailures): Promise<T> => {
	origins.set(operation, errors)
	return operation
}

export const recordFlushFailure = (errors: FlushFailures, operation: Promise<unknown>, error: unknown): void => {
	const underlying = origins.get(operation)
	if (underlying?.size) {
		for (const [source, reason] of underlying) errors.set(source, reason)
	} else errors.set(operation, error)
}

export const flushDeadlineError = (label: string, errors: FlushFailures): Error => {
	const timeout = new StoreFlushTimeoutError(label)
	const previous = [...errors.values()]
	// The deadline is its own failed barrier, distinct from backend callbacks.
	errors.set(Promise.resolve(), timeout)
	return previous.length ? new AggregateError([...previous, timeout], timeout.message, { cause: timeout }) : timeout
}

export async function settleBeforeFlushDeadline(
	operations: Iterable<Promise<unknown>>,
	deadline: number,
	label: string,
	errors: FlushFailures
): Promise<void> {
	// Capture each rejection when it settles. Waiting for allSettled first
	// loses known backend failures if another operation exceeds the deadline.
	const admitted = [...operations]
	const observed = admitted.map(operation =>
		operation.catch(error => {
			recordFlushFailure(errors, operation, error)
			throw error
		})
	)
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			Promise.allSettled(observed),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => {
						// A backing drain may still be pending after some of its writes
						// failed. Include those known failures without inventing a second
						// identity for its wrapper or waiting for the stalled sibling.
						for (const operation of admitted) {
							const underlying = origins.get(operation)
							if (underlying) for (const [source, reason] of underlying) errors.set(source, reason)
						}
						reject(flushDeadlineError(label, errors))
					},
					Math.max(0, deadline - Date.now())
				)
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
