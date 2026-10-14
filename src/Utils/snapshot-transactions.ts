import { withProcessFileLock } from './process-file-lock.ts'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { rowKey, type AtomicRows } from './atomic-store.ts'

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** Snapshot publication and backend-wide isolation, independent of row codecs.
 * The OS lock is shared across adapters/processes; there is no stale-owner lease.
 */
export const createSnapshotTransactions = (
	folder: string,
	snapshotName: string,
	namespaces: ReadonlySet<string>,
	importRows: () => Promise<AtomicRows>,
	syncDir: (path: string) => Promise<void>
) => {
	const path = join(folder, snapshotName)
	const readRows = async (): Promise<AtomicRows> => {
		try {
			const entries: unknown = JSON.parse(await readFile(path, 'utf8'))
			if (!Array.isArray(entries)) throw new TypeError('invalid atomic store snapshot')
			const rows: AtomicRows = new Map()
			for (const entry of entries) {
				if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string')
					throw new TypeError('invalid atomic store entry')
				const key: unknown = JSON.parse(entry[0])
				if (!Array.isArray(key) || key.length !== 2 || !namespaces.has(key[0]) || typeof key[1] !== 'string')
					throw new TypeError('invalid atomic store key')
				if (rows.has(entry[0])) throw new TypeError('duplicate atomic store key')
				if (rowKey(key[0], key[1]) !== entry[0]) throw new TypeError('noncanonical atomic store key')
				const bytes = Buffer.from(entry[1], 'base64')
				if (bytes.toString('base64') !== entry[1]) throw new TypeError('invalid atomic store bytes')
				rows.set(entry[0], bytes)
			}
			return rows
		} catch (error) {
			if (!missing(error)) throw error
		}
		return importRows()
	}

	const inFlight = new Set<Promise<unknown>>()
	let tail: Promise<unknown> = Promise.resolve()
	const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
		const result = tail.then(() => withProcessFileLock(folder, `.${snapshotName}.lock`, work))
		inFlight.add(result)
		void result.then(
			() => inFlight.delete(result),
			() => inFlight.delete(result)
		)
		tail = result.catch(() => {})
		return result
	}
	const persist = async (rows: AtomicRows): Promise<void> => {
		const bytes = Buffer.from(
			JSON.stringify([...rows].map(([key, value]) => [key, Buffer.from(value).toString('base64')]))
		)
		const tmp = `${path}.${randomUUID()}.tmp`
		const handle = await open(tmp, 'wx', 0o600)
		try {
			await handle.writeFile(bytes)
			await handle.sync()
			await handle.close()
			await rename(tmp, path)
			await syncDir(folder)
		} finally {
			await handle.close().catch(() => {})
			await unlink(tmp).catch(error => {
				if (!missing(error)) throw error
			})
		}
	}
	const transaction = <T>(
		change: (rows: AtomicRows) => T | Promise<T>,
		shouldPersist: () => boolean = () => true
	): Promise<T> =>
		exclusive(async () => {
			const rows = await readRows()
			const result = await change(rows)
			if (shouldPersist()) await persist(rows)
			return result
		})
	return {
		read: <T>(read: (rows: AtomicRows) => T | Promise<T>): Promise<T> => exclusive(async () => read(await readRows())),
		transaction,
		flush: async (): Promise<void> => {
			// A finished host callback can admit the next callback in the same
			// engine operation. Drain new admissions too, with a bounded idle turn.
			const deadline = Date.now() + 30_000
			for (;;) {
				const results = await Promise.allSettled(inFlight)
				const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
				if (errors.length === 1) throw errors[0]
				if (errors.length) throw new AggregateError(errors, 'snapshot flush failed')
				await new Promise<void>(resolve => setImmediate(resolve))
				if (inFlight.size === 0) return
				if (Date.now() >= deadline) throw new Error('snapshot flush did not quiesce within 30s')
			}
		}
	}
}
