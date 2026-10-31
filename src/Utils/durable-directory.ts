import { open } from 'node:fs/promises'
const errnoOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code

export const isUnsupportedDirSync = (e: unknown, platform: NodeJS.Platform = process.platform): boolean => {
	const code = errnoOf(e)
	if (code === 'ENOSYS' || code === 'ENOTSUP') return true
	if (platform === 'win32' && (code === 'EINVAL' || code === 'EPERM' || code === 'EISDIR')) return true
	return false
}

export const defaultSyncDir = async (dir: string): Promise<void> => {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(dir, 'r')
	} catch (e) {
		// A store folder that cannot even be opened is not a platform
		// quirk, except where the platform cannot open directory handles
		// at all (classified above).
		if (!isUnsupportedDirSync(e)) throw e
		return
	}
	try {
		await handle.sync()
	} catch (e) {
		if (!isUnsupportedDirSync(e)) throw e
	} finally {
		await handle.close().catch(() => {})
	}
}
