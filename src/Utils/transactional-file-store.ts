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
	syncDir: (path: string) => Promise<void>
): Promise<Store> => {
	const snapshot = createSnapshotTransactions(
		folder,
		'bridge-atomic-v1.json',
		namespaces,
		async () => {
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
	return {
		...ordinary,
		async flush() {
			const pending = snapshot.flush()
			const results = await Promise.allSettled([pending, ordinary.flush?.()])
			const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
			if (errors.length === 1) throw errors[0]
			if (errors.length) throw new AggregateError(errors, 'bridge store flush failed')
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
		deleteMany: (store, keys) =>
			namespaces.has(store)
				? transaction(rows => {
						for (const key of keys) rows.delete(rowKey(store, key))
					})
				: ordinary.deleteMany!(store, keys),
		getMany: (store, keys) =>
			namespaces.has(store)
				? snapshot.read(rows => {
						return keys.flatMap(key => {
							const value = rows.get(rowKey(store, key))
							return value ? [[key, value] as [string, Uint8Array]] : []
						})
					})
				: ordinary.getMany!(store, keys),
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
}
