import { Buffer } from 'node:buffer'
import type { AuthenticationCreds, AuthenticationState, NativeAuthenticationState } from '../../Types/index.ts'
import { initAuthCreds } from '../../Utils/generics.ts'
import { hydrateHostAuthCreds } from '../host-auth-state.ts'
import { projectNativeStore } from '../legacy-store/native-projection.ts'

const hydrationByState = new WeakMap<AuthenticationState, Promise<void>>()

const preserveNodeCredentialBytes = (creds: AuthenticationCreds): void => {
	for (const pair of [
		creds.noiseKey,
		creds.pairingEphemeralKeyPair,
		creds.signedIdentityKey,
		creds.signedPreKey.keyPair
	]) {
		pair.private = Buffer.from(pair.private)
		pair.public = Buffer.from(pair.public)
	}
	creds.signedPreKey.signature = Buffer.from(creds.signedPreKey.signature)
	if (creds.routingInfo) creds.routingInfo = Buffer.from(creds.routingInfo)
}

export const waitForSocketAuthenticationState = (state: AuthenticationState): Promise<void> =>
	hydrationByState.get(state) ?? Promise.resolve()

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

	const state = { creds, keys, ...(store ? { store } : {}) }
	if (store && !input.creds) {
		const hydration = hydrateHostAuthCreds(store, creds as never).then(() => preserveNodeCredentialBytes(creds))
		// The socket initialization awaits the original promise. Attach a
		// rejection observer immediately so a synchronously rejecting store does
		// not become an unhandled rejection before init reaches its first await.
		void hydration.catch(() => undefined)
		hydrationByState.set(state, hydration)
	}
	return state
}
