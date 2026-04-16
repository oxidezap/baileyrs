import { mkdir, stat } from 'node:fs/promises'
import type { AuthenticationState } from '../Types/index'
import { useBridgeStore } from './use-bridge-store'

/**
 * Creates a file-based authentication state for the Rust bridge.
 *
 * All crypto keys, sessions, and identity are managed by the Rust engine
 * and persisted as `.bin` files via the bridge store. No `creds.json` needed.
 *
 * @param folder Directory to store bridge state files
 */
export const useMultiFileAuthState = async (folder: string): Promise<{ state: AuthenticationState }> => {
	const folderInfo = await stat(folder).catch(() => {})
	if (folderInfo) {
		if (!folderInfo.isDirectory()) {
			throw new Error(
				`found something that is not a directory at ${folder}, either delete it or specify a different location`
			)
		}
	} else {
		await mkdir(folder, { recursive: true })
	}

	const store = await useBridgeStore(folder)

	return {
		state: { store }
	}
}
