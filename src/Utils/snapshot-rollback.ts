import { rollbackProofName, snapshotDigest, verifyRollbackProof } from './snapshot-rollback-proof.ts'
import { withProcessFileLock } from './process-file-lock.ts'
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
		await withProcessFileLock(folder, `.${snapshotName}.lock`, async () => {
			await verifyRollbackProof(folder, snapshotName)
			await syncDir(folder)
		})
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
		const publish = async (name: string, bytes: Uint8Array): Promise<void> => {
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
		for (const [name, bytes] of files) await publish(name, bytes)
		for (const name of await readdir(folder))
			if (isRecordFile(name) && !files.has(name)) await unlink(join(folder, name))
		await syncDir(folder)
		const archive = `${snapshotName}.rollback-${randomUUID()}`
		const sha256 = snapshotDigest(await readFile(join(folder, snapshotName)))
		await publish(rollbackProofName(snapshotName), Buffer.from(JSON.stringify({ version: 1, archive, sha256 })))
		await syncDir(folder)
		await rename(join(folder, snapshotName), join(folder, archive))
		await syncDir(folder)
	})
}
