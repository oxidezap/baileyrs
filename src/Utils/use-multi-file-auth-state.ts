import { mkdir, stat } from 'node:fs/promises'
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge'
import type { AuthenticationCreds, AuthenticationState } from '../Types/index.ts'
import { createDeviceProjection } from '../Compatibility/legacy-store/device.ts'
import { projectNativeStore } from '../Compatibility/legacy-store/native-projection.ts'
import { initAuthCreds } from './generics.ts'
import { useBridgeStore } from './use-bridge-store.ts'

/**
 * The store namespace and keys the engine writes its own device under.
 *
 * `<folder>/device-device.bin` and `<folder>/device-account.bin` on disk.
 */
const DEVICE_STORE = 'device'
const DEVICE_RECORDS = ['device', 'account'] as const

/**
 * Rebuild the credential mirror from the device the engine persisted.
 *
 * Without this the mirror is whatever `initAuthCreds()` just made up: every
 * restart handed back `registered: false` and `me: undefined` for a session
 * that was paired and working, because nothing on this path ever read the
 * device back. The hydration itself already existed for `wrapLegacyStore`
 * (`Compatibility/legacy-store/adapter.ts`), which only runs for callers that
 * bring their own `{ creds, keys }`; a caller using this function goes straight
 * to the bridge store and used to skip it entirely.
 *
 * A record that fails to decode is skipped rather than fatal: a mirror missing
 * a field is worth less than a socket that will not start, and the engine reads
 * its own device from the same bytes regardless of what this makes of them.
 */
const hydrateFromStore = async (store: JsStoreCallbacks, creds: AuthenticationCreds): Promise<void> => {
	const projection = createDeviceProjection(creds)
	for (const record of DEVICE_RECORDS) {
		const payload = await store.get(DEVICE_STORE, record)
		if (!payload) continue
		try {
			projection.prepare(record, payload)()
		} catch {
			/* a record we cannot read leaves that part of the mirror at its default */
		}
	}
}

/**
 * Creates a file-based authentication state for the Rust bridge.
 *
 * All effective crypto keys, sessions, and identity are managed by the Rust
 * engine and persisted as `.bin` files via the bridge store. The returned
 * `creds` and `keys` are complete upstream-compatible mirrors so unchanged
 * application code can inspect them or clear legacy entries safely.
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
	const creds = initAuthCreds()
	// Before `projectNativeStore`, and that ordering is the whole point: the
	// projection captures `signedIdentityKey.public` and `registrationId` off
	// `creds` when it is called, and builds the Signal codecs around them.
	// Hydrating afterwards would leave those codecs holding the identity of the
	// throwaway `initAuthCreds()` rather than the device's, so a legacy session
	// written through this store would be imported under the wrong local
	// identity.
	await hydrateFromStore(store, creds)
	const keys: AuthenticationState['keys'] = projectNativeStore(store, creds)

	return {
		state: { creds, keys, store },
		saveCreds: async () => {
			// no-op: bridge owns effective creds and writes them through
			// `store.set('device', …)`; the in-process mirror is merged before this
			// hook runs.
			// Kept on the surface so upstream-Baileys code paths keep type-checking.
		}
	}
}
