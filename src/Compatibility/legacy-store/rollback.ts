import { exportAuthSnapshot } from '../../Utils/snapshot-rollback.ts'
import { isLegacyAuthRecordFile } from './record-files.ts'

/** Offline rollback only. Stop every writer first. A rejection means upstream
 * must not open this directory yet. The snapshot remains authoritative until
 * every legacy record/deletion is durable, then is archived for recovery.
 */
export async function prepareLegacyAuthRollback(folder: string, options: { offline: true }): Promise<void> {
	if (options?.offline !== true)
		throw new TypeError('legacy rollback requires { offline: true } after stopping every auth writer')
	await exportAuthSnapshot(
		folder,
		'bridge-legacy-v1.json',
		new Set(['legacy']),
		(_namespace, name) => (isLegacyAuthRecordFile(name) ? name : undefined),
		isLegacyAuthRecordFile
	)
}
