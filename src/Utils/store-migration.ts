import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type StoreMigrationOptions = {
	/** Explicit handoff: every adapter/process using the old files has stopped.
	 * Back up the whole directory, including hidden completion records and archives. The snapshot becomes authoritative.
	 * Older writers cannot share its lock. Before reverting storage formats, stop
	 * all writers and run prepareNativeAuthRollback or prepareLegacyAuthRollback
	 * with { offline: true }; do not reopen stale per-key backups directly. */
	migrate?: true
}

export const requireOfflineMigration = async (
	folder: string,
	snapshotName: string,
	isOldRecord: (name: string) => boolean,
	options: StoreMigrationOptions
): Promise<void> => {
	try {
		await access(join(folder, snapshotName))
		return
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
	}
	if (options.migrate !== true && (await readdir(folder)).some(isOldRecord)) {
		throw new Error(
			`existing auth files require an offline migration: stop every old writer, back up the whole directory, then pass { migrate: true } (${folder})`
		)
	}
}
