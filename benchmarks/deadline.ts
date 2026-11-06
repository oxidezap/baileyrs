/** Bound the entire operation, including a send waiting for reconnect. */
export async function withDeadline<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	cancel: () => Promise<void>
): Promise<T> {
	const expired = new Error('benchmark send-and-receive deadline exceeded')
	let timer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(expired), timeoutMs)
	})
	try {
		// Promise.race observes late rejection too, including cancellation of a
		// send that was blocked inside the bridge when the deadline expired.
		return await Promise.race([Promise.resolve().then(operation), deadline])
	} catch (error) {
		if (error === expired) {
			try {
				await cancel()
			} catch (cleanupError) {
				throw new AggregateError([expired, cleanupError], 'Benchmark deadline and teardown failed', {
					cause: cleanupError
				})
			}
		}
		throw error
	} finally {
		clearTimeout(timer)
	}
}
