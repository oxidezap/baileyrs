import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { transactionalFileStore } from '../../Utils/transactional-file-store.ts'
import { defaultSyncDir } from '../../Utils/use-bridge-store.ts'
import { useMemoryStore } from '../../Utils/use-memory-store.ts'
import { rowKey, type AtomicRows } from '../../Utils/atomic-store.ts'
import { BufferJSON } from '../../Utils/generics.ts'
import type { LegacyKeysStore } from './types.ts'

/** All legacy and native-mirror writes share the same persistent snapshot.
 * The original JSON files are migration backups after the first commit.
 */
export const legacySnapshotKeys = async (
	folder: string,
	fileName: (type: string, id: string) => string
): Promise<LegacyKeysStore> => {
	const store = await transactionalFileStore(folder, useMemoryStore(), defaultSyncDir, {
		namespaces: new Set(['legacy']),
		snapshotName: 'bridge-legacy-v1.json',
		importRows: async () => {
			const rows: AtomicRows = new Map()
			for (const name of await readdir(folder)) {
				if (!name.endsWith('.json') || name === 'creds.json' || name === 'bridge-legacy-v1.json') continue
				rows.set(rowKey('legacy', name), await readFile(join(folder, name)))
			}
			return rows
		}
	})
	const decode = (bytes: Uint8Array | undefined | null): unknown =>
		bytes ? JSON.parse(Buffer.from(bytes).toString(), BufferJSON.reviver) : null
	const transactionView = (rows: AtomicRows): LegacyKeysStore => ({
		get: async (type, ids) =>
			Object.fromEntries(ids.map(id => [id, decode(rows.get(rowKey('legacy', fileName(type, id))))])),
		set: async data => {
			for (const [type, values] of Object.entries(data))
				for (const [id, value] of Object.entries(values)) {
					const key = rowKey('legacy', fileName(type, id))
					if (value == null) rows.delete(key)
					else rows.set(key, Buffer.from(JSON.stringify(value, BufferJSON.replacer)))
				}
		}
	})
	return {
		get: async (type, ids) =>
			Object.fromEntries(
				await Promise.all(ids.map(async id => [id, decode(await store.get('legacy', fileName(type, id)))]))
			),
		set: data =>
			store.transactionRows(async rows => {
				await transactionView(rows).set(data)
			}),
		bridgeTransaction: work => store.transactionRows(rows => work(transactionView(rows)))
	}
}
