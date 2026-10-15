import { settleBeforeFlushDeadline, flushDeadlineError, settledFlushError } from './flush-deadline.ts'
import { nativeAtomicNamespaces as namespaces, isNativeAtomicRecordFile } from './native-auth-rollback.ts'
import { requireOfflineMigration, type StoreMigrationOptions } from './store-migration.ts'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthenticationState } from '../Types/index.ts'
import { atomicCallbacks, rowKey, type AtomicRows, type OrdinaryStoreCallbacks } from './atomic-store.ts'
import { createSnapshotTransactions } from './snapshot-transactions.ts'

type Store = NonNullable<AuthenticationState['store']>

export const transactionalFileStore = async (
	folder: string,
	ordinary: OrdinaryStoreCallbacks,
	syncDir: (path: string) => Promise<void>,
	options: StoreMigrationOptions = {},
	createOrdinaryDrain: () => () => Promise<void> = () => () => {
		try {
			return ordinary.flush?.() ?? Promise.resolve()
		} catch (error) {
			return Promise.reject(error)
		}
	}
): Promise<Store> => {
	await requireOfflineMigration(folder, 'bridge-atomic-v1.json', isNativeAtomicRecordFile, options)
	const snapshot = createSnapshotTransactions(
		folder,
		'bridge-atomic-v1.json',
		namespaces,
		async () => {
			await requireOfflineMigration(folder, 'bridge-atomic-v1.json', isNativeAtomicRecordFile, options)
			const rows: AtomicRows = new Map()
			for (const file of await readdir(folder)) {
				const separator = file.indexOf('-')
				const store = file.slice(0, separator)
				if (!namespaces.has(store) || !file.endsWith('.bin')) continue
				const encoded = file.slice(separator + 1, -4)
				const key = decodeURIComponent(encoded)
				if (encodeURIComponent(key) !== encoded) throw new TypeError(`noncanonical native auth filename: ${file}`)
				const row = rowKey(store, key)
				if (rows.has(row)) throw new TypeError(`duplicate native auth key: ${file}`)
				rows.set(row, await readFile(join(folder, file)))
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
				const errors = new Map<Promise<unknown>, unknown>()
				const drainOrdinary = createOrdinaryDrain()
				for (;;) {
					const before = admissions
					const admitted = [...pendingCallbacks]
					await settleBeforeFlushDeadline(
						[snapshot.flush(), drainOrdinary(), ...admitted],
						deadline,
						'bridge store flush',
						errors
					)
					for (const callback of admitted) pendingCallbacks.delete(callback)
					await new Promise<void>(resolve => setImmediate(resolve))
					if (admissions === before && pendingCallbacks.size === 0) {
						if (errors.size) throw settledFlushError('bridge store flush failed', errors.values())
						return
					}
					if (Date.now() >= deadline) throw flushDeadlineError('bridge store flush', errors)
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
