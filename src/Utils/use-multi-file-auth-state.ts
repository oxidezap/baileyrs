import { mkdir, stat } from 'node:fs/promises'
import type { AuthenticationState } from '../Types/index.ts'
import { useBridgeStore } from './use-bridge-store.ts'

/**
 * Creates a file-based authentication state for the Rust bridge.
 *
 * All crypto keys, sessions, and identity are managed by the Rust engine
 * and persisted as `.bin` files via the bridge store. No `creds.json` needed.
 *
 * Returns a `saveCreds` no-op for upstream-Baileys API parity. Upstream
 * bots wire `ev.on('creds.update', saveCreds)` as the persistence hook;
 * in baileyrs the bridge auto-persists everything through the store, so
 * the function is a stable shim that lets the same call sites keep
 * working without changes.
 *
 * @param folder Directory to store bridge state files
 */
export const useMultiFileAuthState = async (
	folder: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
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
		state: { store },
		saveCreds: async () => {
			// no-op: bridge owns creds and writes them through `store.set('device', …)`.
			// Kept on the surface so upstream-Baileys code paths keep type-checking.
		}
	}
}
