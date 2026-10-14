import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type StoreMigrationOptions = {
	/** Explicit handoff: every adapter/process using the old files has stopped.
	 * The snapshot becomes authoritative. Older writers cannot share its lock. */
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
