import { open } from 'node:fs/promises'
import { join } from 'node:path'

/** The kernel owns this lock and releases it on close/process exit. Keep the
 * lock file's inode stable: never unlink it while another adapter may exist.
 * Native code is loaded only for file-backed auth, outside the host entrypoint.
 */
export const withProcessFileLock = async <T>(folder: string, name: string, work: () => Promise<T>): Promise<T> => {
	const { tryLock } = await import('fs-native-extensions')
	const path = join(folder, name)
	const handle = await open(path, 'a+', 0o600)
	let outcome: { ok: true; value: T } | { ok: false; error: unknown }
	try {
		const deadline = Date.now() + 10000
		while (!tryLock(handle.fd)) {
			if (Date.now() >= deadline) throw new Error(`snapshot lock timed out: ${path}`)
			await new Promise(resolve => setTimeout(resolve, 10))
		}
		outcome = { ok: true, value: await work() }
	} catch (error) {
		outcome = { ok: false, error }
	}
	try {
		await handle.close()
	} catch (error) {
		if (!outcome.ok)
			throw new AggregateError([outcome.error, error], 'snapshot transaction and lock close failed', {
				cause: error
			})
		throw error
	}
	if (!outcome.ok) throw outcome.error
	return outcome.value
}
