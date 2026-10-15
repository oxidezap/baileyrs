import { requireOfflineMigration, type StoreMigrationOptions } from './store-migration.ts'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthenticationState } from '../Types/index.ts'
import { atomicCallbacks, rowKey, type AtomicRows, type OrdinaryStoreCallbacks } from './atomic-store.ts'
import { createSnapshotTransactions } from './snapshot-transactions.ts'

const namespaces = new Set(['sync_version', 'mutation_mac', 'tc_token', 'meta'])
type Store = NonNullable<AuthenticationState['store']>

export const transactionalFileStore = async (
	folder: string,
	ordinary: OrdinaryStoreCallbacks,
	syncDir: (path: string) => Promise<void>,
	options: StoreMigrationOptions = {}
): Promise<Store> => {
	await requireOfflineMigration(
		folder,
		'bridge-atomic-v1.json',
		name => namespaces.has(name.slice(0, name.indexOf('-'))) && name.endsWith('.bin'),
		options
	)
	const snapshot = createSnapshotTransactions(
		folder,
		'bridge-atomic-v1.json',
		namespaces,
		async () => {
			await requireOfflineMigration(
				folder,
				'bridge-atomic-v1.json',
				name => namespaces.has(name.slice(0, name.indexOf('-'))) && name.endsWith('.bin'),
				options
			)
			const rows: AtomicRows = new Map()
			for (const file of await readdir(folder)) {
				const separator = file.indexOf('-')
				const store = file.slice(0, separator)
				if (!namespaces.has(store) || !file.endsWith('.bin')) continue
				const key = decodeURIComponent(file.slice(separator + 1, -4))
				rows.set(rowKey(store, key), await readFile(join(folder, file)))
			}
			return rows
		},
		syncDir
	)
	const transaction = snapshot.transaction
	const list = (rows: AtomicRows, store: string, prefix = ''): [string, Uint8Array][] =>
		[...rows].flatMap(([key, value]) => {
			const [namespace, id]: [string, string] = JSON.parse(key)
			return namespace === store && id.startsWith(prefix) ? [[id, Uint8Array.from(value)]] : []
		})
	let admissions = 0
	let activeFlushes = 0
	const pendingCallbacks = new Set<Promise<unknown>>()
	const result: Store = {
		...ordinary,
		async flush() {
			activeFlushes++
			try {
				const deadline = Date.now() + 30_000
				const errors = new Set<unknown>()
				// Failed backends retain entries for the next explicit flush.
				// Join public callbacks and the other queue without retrying those failures.
				let snapshotFailed = false
				let ordinaryFailed = false
				for (;;) {
					const before = admissions
					const admitted = [...pendingCallbacks]
					const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
						snapshotFailed ? undefined : snapshot.flush(),
						ordinaryFailed ? undefined : ordinary.flush?.(),
						...admitted
					])
					snapshotFailed ||= results[0]!.status === 'rejected'
					ordinaryFailed ||= results[1]!.status === 'rejected'
					for (const callback of admitted) pendingCallbacks.delete(callback)
					for (const settled of results) if (settled.status === 'rejected') errors.add(settled.reason)
					await new Promise<void>(resolve => setImmediate(resolve))
					if (admissions === before && pendingCallbacks.size === 0) {
						if (errors.size === 1) throw [...errors][0]
						if (errors.size) throw new AggregateError(errors, 'bridge store flush failed')
						return
					}
					if (Date.now() >= deadline)
						throw new AggregateError(
							[...errors, new Error('bridge store flush did not quiesce within 30s')],
							'bridge store flush did not quiesce within 30s'
						)
				}
			} finally {
				activeFlushes--
			}
		},
		...atomicCallbacks(transaction),
		get: (store, key) =>
			namespaces.has(store) ? snapshot.read(rows => rows.get(rowKey(store, key)) ?? null) : ordinary.get(store, key),
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
			const additions = entries.map(([key, value]) => [key, Uint8Array.from(value)] as const)
			return transaction(rows => {
				for (const [key, value] of additions) rows.set(rowKey(store, key), value)
			})
		},
		deleteMany(store, keys) {
			const requested = [...keys]
			return namespaces.has(store)
				? transaction(rows => {
						for (const key of requested) rows.delete(rowKey(store, key))
					})
				: ordinary.deleteMany!(store, requested)
		},
		getMany(store, keys) {
			const requested = [...keys]
			return namespaces.has(store)
				? snapshot.read(rows =>
						requested.flatMap(key => {
							const value = rows.get(rowKey(store, key))
							return value ? [[key, value] as [string, Uint8Array]] : []
						})
					)
				: ordinary.getMany!(store, requested)
		},
		listKeys: (store, prefix) =>
			namespaces.has(store)
				? snapshot.read(rows => list(rows, store, prefix).map(([key]) => key))
				: ordinary.listKeys!(store, prefix),
		deletePrefix: (store, prefix) =>
			namespaces.has(store)
				? transaction(rows => {
						const entries = list(rows, store, prefix)
						for (const [key] of entries) rows.delete(rowKey(store, key))
						return entries.length
					})
				: ordinary.deletePrefix!(store, prefix)
	}
	// Every public callback shares the admission counter, so cross-backend
	// completion handlers cannot escape the combined durability barrier.
	const admit =
		<A extends unknown[], R>(callback: (...args: A) => R) =>
		(...args: A): R => {
			admissions++
			const returned = callback(...args)
			const tracked = Promise.resolve(returned)
			pendingCallbacks.add(tracked)
			void tracked.then(
				() => pendingCallbacks.delete(tracked),
				() => {
					if (activeFlushes === 0) pendingCallbacks.delete(tracked)
				} // Keep failures admitted during a drain.
			)
			return returned
		}
	return {
		...result,
		get: admit(result.get),
		set: admit(result.set),
		delete: admit(result.delete),
		getMany: admit(result.getMany!),
		setMany: admit(result.setMany!),
		deleteMany: admit(result.deleteMany!),
		listKeys: admit(result.listKeys!),
		deletePrefix: admit(result.deletePrefix!),
		commitPatch: admit(result.commitPatch),
		storeReceivedTcToken: admit(result.storeReceivedTcToken),
		touchTcTokenSenderTimestamp: admit(result.touchTcTokenSenderTimestamp)
	}
}
