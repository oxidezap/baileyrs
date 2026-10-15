import { open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSnapshotTransactions } from './snapshot-transactions.ts'
import { defaultSyncDir } from './durable-directory.ts'

/** Caller has stopped every writer. Keep the snapshot authoritative until all
 * exported records and deletions are durable, then archive it for recovery.
 */
export async function exportAuthSnapshot(
	folder: string,
	snapshotName: string,
	namespaces: ReadonlySet<string>,
	recordFile: (namespace: string, id: string) => string | undefined,
	isRecordFile: (name: string) => boolean,
	syncDir: (folder: string) => Promise<void> = defaultSyncDir
): Promise<void> {
	try {
		await readFile(join(folder, snapshotName))
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
		// Also retry a directory barrier that failed after snapshot archival.
		await syncDir(folder)
		return
	}
	const snapshot = createSnapshotTransactions(
		folder,
		snapshotName,
		namespaces,
		async () => {
			throw new Error('auth snapshot disappeared during offline rollback')
		},
		syncDir
	)
	await snapshot.read(async rows => {
		const files = new Map<string, Uint8Array>()
		for (const [key, bytes] of rows) {
			const [namespace, id]: [string, string] = JSON.parse(key)
			const name = recordFile(namespace, id)
			if (name === undefined) continue
			if (/[\\/\0]/.test(name) || !isRecordFile(name) || files.has(name))
				throw new Error('invalid or duplicate auth rollback filename')
			files.set(name, bytes)
		}
		for (const [name, bytes] of files) {
			const tmp = join(folder, `.rollback-${randomUUID()}.tmp`)
			const handle = await open(tmp, 'wx', 0o600)
			try {
				await handle.writeFile(bytes)
				await handle.sync()
				await handle.close()
				await rename(tmp, join(folder, name))
			} finally {
				await handle.close().catch(() => {})
				await unlink(tmp).catch(error => {
					if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
				})
			}
		}
		for (const name of await readdir(folder))
			if (isRecordFile(name) && !files.has(name)) await unlink(join(folder, name))
		await syncDir(folder)
		await rename(join(folder, snapshotName), join(folder, `${snapshotName}.rollback-${randomUUID()}`))
		await syncDir(folder)
	})
}
