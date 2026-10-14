import { requireOfflineMigration, type StoreMigrationOptions } from '../../Utils/store-migration.ts'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createSnapshotTransactions } from '../../Utils/snapshot-transactions.ts'
import { defaultSyncDir } from '../../Utils/durable-directory.ts'
import { rowKey, type AtomicRows } from '../../Utils/atomic-store.ts'
import { BufferJSON } from '../../Utils/generics.ts'
import type { LegacyKeysStore } from './types.ts'

/** All legacy and native-mirror writes share the same persistent snapshot.
 * The original JSON files are migration backups after the first commit.
 */
export const legacySnapshotKeys = async (
	folder: string,
	fileName: (type: string, id: string) => string,
	options: StoreMigrationOptions = {}
): Promise<LegacyKeysStore> => {
	await requireOfflineMigration(
		folder,
		'bridge-legacy-v1.json',
		name => name.endsWith('.json') && name !== 'creds.json',
		options
	)
	const store = createSnapshotTransactions(
		folder,
		'bridge-legacy-v1.json',
		new Set(['legacy']),
		async () => {
			await requireOfflineMigration(
				folder,
				'bridge-legacy-v1.json',
				name => name.endsWith('.json') && name !== 'creds.json',
				options
			)
			const rows: AtomicRows = new Map()
			for (const name of await readdir(folder)) {
				if (!name.endsWith('.json') || name === 'creds.json' || name === 'bridge-legacy-v1.json') continue
				rows.set(rowKey('legacy', name), await readFile(join(folder, name)))
			}
			return rows
		},
		defaultSyncDir
	)

	const decode = (bytes: Uint8Array | undefined | null): unknown =>
		bytes ? JSON.parse(Buffer.from(bytes).toString(), BufferJSON.reviver) : null
	const transactionView = (rows: AtomicRows, mutated: () => void): LegacyKeysStore => ({
		get: async (type, ids) =>
			Object.fromEntries(ids.map(id => [id, decode(rows.get(rowKey('legacy', fileName(type, id))))])),
		set: async data => {
			for (const [type, values] of Object.entries(data))
				for (const [id, value] of Object.entries(values ?? {})) {
					const key = rowKey('legacy', fileName(type, id))
					mutated()
					if (value == null) rows.delete(key)
					else rows.set(key, Buffer.from(JSON.stringify(value, BufferJSON.replacer)))
				}
		}
	})
	const transaction = <T>(work: (keys: LegacyKeysStore) => Promise<T>): Promise<T> => {
		let dirty = false
		return store.transaction(
			rows =>
				work(
					transactionView(rows, () => {
						dirty = true
					})
				),
			() => dirty
		)
	}

	return {
		get: async (type, ids) =>
			Object.fromEntries(
				await Promise.all(
					ids.map(async id => [id, decode(await store.read(rows => rows.get(rowKey('legacy', fileName(type, id)))))])
				)
			),
		set: data =>
			transaction(async keys => {
				await keys.set(data)
			}),
		bridgeTransaction: transaction
	}
}
