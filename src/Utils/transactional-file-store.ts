import { mkdir, open, readFile, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AuthenticationState } from '../Types/index.ts'
import { atomicCallbacks, rowKey, type AtomicRows } from './atomic-store.ts'

const atomicNamespaces = new Set(['sync_version', 'mutation_mac', 'tc_token', 'meta'])
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
type Store = NonNullable<AuthenticationState['store']>

/** One snapshot and one cross-process lock for the complete atomic namespace set.
 * No lock stealing: after a crashed owner, recovery must first establish that no
 * writer remains and remove the snapshot lock directory. A timeout fails closed.
 */
export const transactionalFileStore = async (
	folder: string,
	ordinary: Store,
	syncDir: (path: string) => Promise<void>,
	configuration: {
		namespaces?: ReadonlySet<string>
		snapshotName?: string
		importRows?: () => Promise<AtomicRows>
	} = {}
): Promise<Store & { transactionRows<T>(work: (rows: AtomicRows) => Promise<T>): Promise<T> }> => {
	const namespaces = configuration.namespaces ?? atomicNamespaces
	const snapshotName = configuration.snapshotName ?? 'bridge-atomic-v1.json'
	const path = join(folder, snapshotName)
	const lock = join(folder, `.${snapshotName}.lock`)
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
				rows.set(entry[0], Buffer.from(entry[1], 'base64'))
			}
			return rows
		} catch (error) {
			if (!missing(error)) throw error
		}
		// Import old bytes once, under the same lock as the first commit. Keep
		// source files as a backup, never read them after the snapshot exists.
		if (configuration.importRows) return configuration.importRows()
		const rows: AtomicRows = new Map()
		for (const file of await readdir(folder)) {
			const separator = file.indexOf('-')
			const store = file.slice(0, separator)
			if (!namespaces.has(store) || !file.endsWith('.bin')) continue
			const key = decodeURIComponent(file.slice(separator + 1, -4))
			rows.set(rowKey(store, key), await readFile(join(folder, file)))
		}
		return rows
	}
	const locked = async <T>(work: () => Promise<T>): Promise<T> => {
		const deadline = Date.now() + 10000
		for (;;) {
			try {
				await mkdir(lock, { mode: 0o700 })
				break
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
				if (Date.now() >= deadline)
					throw new Error(
						`atomic store lock timed out: ${lock}; verify all writers stopped before removing a crash lock`,
						{ cause: error }
					)
				await new Promise(resolve => setTimeout(resolve, 10))
			}
		}
		try {
			return await work()
		} finally {
			await rmdir(lock)
		}
	}
	let tail: Promise<unknown> = Promise.resolve()
	const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
		const result = tail.then(() => locked(work))
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
	const transaction = (change: (rows: AtomicRows) => void): Promise<void> =>
		exclusive(async () => {
			const rows = await readRows()
			change(rows)
			await persist(rows)
		})
	const list = (rows: AtomicRows, store: string, prefix = ''): [string, Uint8Array][] =>
		[...rows].flatMap(([key, value]) => {
			const [namespace, id]: [string, string] = JSON.parse(key)
			return namespace === store && id.startsWith(prefix) ? [[id, Uint8Array.from(value)]] : []
		})
	return {
		...ordinary,
		transactionRows: work =>
			exclusive(async () => {
				const rows = await readRows()
				const result = await work(rows)
				await persist(rows)
				return result
			}),
		async flush() {
			const pending = tail
			const results = await Promise.allSettled([pending, ordinary.flush?.()])
			const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
			if (errors.length === 1) throw errors[0]
			if (errors.length) throw new AggregateError(errors, 'bridge store flush failed')
		},
		...atomicCallbacks(transaction),
		get: (store, key) =>
			namespaces.has(store)
				? exclusive(async () => (await readRows()).get(rowKey(store, key)) ?? null)
				: ordinary.get(store, key),
		set(store, key, value) {
			const bytes = Uint8Array.from(value)
			return namespaces.has(store)
				? transaction(rows => {
						rows.set(rowKey(store, key), bytes)
					})
				: ordinary.set(store, key, bytes)
		},
		delete: (store, key) =>
			namespaces.has(store)
				? transaction(rows => {
						rows.delete(rowKey(store, key))
					})
				: ordinary.delete(store, key),
		setMany(store, entries) {
			if (!namespaces.has(store)) return ordinary.setMany!(store, entries)
			const snapshot = entries.map(([key, value]) => [key, Uint8Array.from(value)] as const)
			return transaction(rows => {
				for (const [key, value] of snapshot) rows.set(rowKey(store, key), value)
			})
		},
		deleteMany: (store, keys) =>
			namespaces.has(store)
				? transaction(rows => {
						for (const key of keys) rows.delete(rowKey(store, key))
					})
				: ordinary.deleteMany!(store, keys),
		getMany: (store, keys) =>
			namespaces.has(store)
				? exclusive(async () => {
						const rows = await readRows()
						return keys.flatMap(key => {
							const value = rows.get(rowKey(store, key))
							return value ? [[key, value] as [string, Uint8Array]] : []
						})
					})
				: ordinary.getMany!(store, keys),
		listKeys: (store, prefix) =>
			namespaces.has(store)
				? exclusive(async () => list(await readRows(), store, prefix).map(([key]) => key))
				: ordinary.listKeys!(store, prefix),
		deletePrefix: (store, prefix) =>
			namespaces.has(store)
				? exclusive(async () => {
						const rows = await readRows()
						const entries = list(rows, store, prefix)
						for (const [key] of entries) rows.delete(rowKey(store, key))
						await persist(rows)
						return entries.length
					})
				: ordinary.deletePrefix!(store, prefix)
	}
}
