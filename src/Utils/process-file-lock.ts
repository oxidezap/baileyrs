import { link, mkdir, open, readFile, rmdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code

/** Reclaim only after the OS confirms the owner has exited. A recovery latch
 * serializes reclaimers, which must re-read ownership after acquiring it. This
 * prevents a second reclaimer from removing a replacement owner's live lock.
 * Local filesystems and one host/PID namespace are required. No age-based lease.
 */
const recoverExitedOwner = async (lock: string): Promise<void> => {
	const recovery = `${lock}.recovery`
	try {
		await mkdir(recovery, { mode: 0o700 })
	} catch (error) {
		if (codeOf(error) === 'EEXIST') return
		throw error
	}
	try {
		let owner: unknown
		try {
			owner = JSON.parse(await readFile(lock, 'utf8'))
		} catch (error) {
			if (codeOf(error) === 'ENOENT') return
			throw error
		}
		if (
			!owner ||
			typeof owner !== 'object' ||
			!('pid' in owner) ||
			typeof owner.pid !== 'number' ||
			!Number.isSafeInteger(owner.pid) ||
			owner.pid <= 0
		) {
			throw new TypeError(`invalid snapshot lock owner: ${lock}`)
		}
		try {
			process.kill(owner.pid, 0)
		} catch (error) {
			if (codeOf(error) === 'ESRCH') {
				await unlink(lock)
				return
			}
			// EPERM and unsupported checks are not evidence of an exited owner.
			if (codeOf(error) !== 'EPERM') throw error
		}
	} finally {
		await rmdir(recovery)
	}
}

export const withProcessFileLock = async <T>(folder: string, name: string, work: () => Promise<T>): Promise<T> => {
	const lock = join(folder, name)
	const ownerPath = `${lock}.${randomUUID()}.owner`
	const handle = await open(ownerPath, 'wx', 0o600)
	let acquired = false
	let outcome: { ok: true; value: T } | { ok: false; error: unknown }
	try {
		// Publish a fully written owner atomically using a hard link. A SIGKILL
		// cannot leave a half-created lock with no owner information.
		await handle.writeFile(JSON.stringify({ pid: process.pid }))
		await handle.close()
		const deadline = Date.now() + 10000
		for (;;) {
			try {
				await link(ownerPath, lock)
				acquired = true
				break
			} catch (error) {
				if (codeOf(error) !== 'EEXIST') throw error
				await recoverExitedOwner(lock)
				if (Date.now() >= deadline) throw new Error(`snapshot lock timed out: ${lock}`, { cause: error })
				await new Promise(resolve => setTimeout(resolve, 10))
			}
		}
		outcome = { ok: true, value: await work() }
	} catch (error) {
		outcome = { ok: false, error }
	}
	await handle.close().catch(() => {})
	const cleanup = await Promise.allSettled([acquired ? unlink(lock) : Promise.resolve(), unlink(ownerPath)])
	const errors = cleanup.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
	if (errors.length && !outcome.ok)
		throw new AggregateError([outcome.error, ...errors], 'snapshot transaction and lock cleanup failed', {
			cause: outcome.error
		})
	if (errors.length === 1) throw errors[0]
	if (errors.length) throw new AggregateError(errors, 'snapshot lock cleanup failed')
	if (!outcome.ok) throw outcome.error
	return outcome.value
}
