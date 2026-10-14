import { open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSnapshotTransactions } from '../../Utils/snapshot-transactions.ts'
import { defaultSyncDir } from '../../Utils/durable-directory.ts'
import { rowKey } from '../../Utils/atomic-store.ts'
import { LegacyStore, MirrorStore, RawStore } from './constants.ts'

const snapshotName = 'bridge-legacy-v1.json'
const keyPrefixes = [...Object.values(LegacyStore), ...Object.values(MirrorStore), ...Object.values(RawStore)].map(
	type => `${type}-`
)

/** Offline rollback only. Stop every writer first. A rejection means upstream
 * must not open this directory yet. The snapshot remains authoritative until
 * every legacy record/deletion is durable, then is archived for recovery.
 */
export async function prepareLegacyAuthRollback(folder: string, options: { offline: true }): Promise<void> {
	if (options?.offline !== true)
		throw new TypeError('legacy rollback requires { offline: true } after stopping every auth writer')
	try {
		await readFile(join(folder, snapshotName))
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
		throw error
	}
	const snapshot = createSnapshotTransactions(
		folder,
		snapshotName,
		new Set(['legacy']),
		async () => {
			throw new Error('legacy snapshot disappeared during offline rollback')
		},
		defaultSyncDir
	)
	await snapshot.read(async rows => {
		for (const [key, bytes] of rows) {
			const [namespace, name]: [string, string] = JSON.parse(key)
			if (namespace !== 'legacy' || basename(name) !== name || !name.endsWith('.json') || name === 'creds.json')
				throw new Error('invalid legacy rollback filename')
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
		for (const name of await readdir(folder)) {
			if (
				name.endsWith('.json') &&
				keyPrefixes.some(prefix => name.startsWith(prefix)) &&
				!rows.has(rowKey('legacy', name))
			)
				await unlink(join(folder, name))
		}
		await defaultSyncDir(folder)
		await rename(join(folder, snapshotName), join(folder, `${snapshotName}.rollback-${randomUUID()}`))
		await defaultSyncDir(folder)
	})
}
