import type { AuthenticationState } from '../../Types/index.ts'
import { initAuthCreds } from '../../Utils/generics.ts'
import { projectNativeStore } from '../legacy-store/native-projection.ts'

type NativeAuthenticationState = {
	store: NonNullable<AuthenticationState['store']>
	creds?: AuthenticationState['creds']
	keys?: AuthenticationState['keys']
}

/**
 * Complete the public authentication view used by the socket when callers use
 * the native byte-store path. The byte store remains authoritative: the key
 * facade projects that same store lazily and the credentials object is only the
 * public, in-process mirror updated by socket events.
 */
export const normalizeSocketAuthenticationState = (
	input: AuthenticationState | NativeAuthenticationState
): AuthenticationState => {
	if (!input || typeof input !== 'object') {
		throw new TypeError('auth must provide either { creds, keys } or a native store')
	}

	const store = input.store
	const creds = input.creds ?? (store ? initAuthCreds() : undefined)
	const keys = input.keys ?? (store && creds ? projectNativeStore(store, creds) : undefined)

	if (!creds || !keys) {
		throw new TypeError('auth must provide both creds and keys when no native store is configured')
	}

	return { creds, keys, ...(store ? { store } : {}) }
}
