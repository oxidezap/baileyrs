import type { AuthenticationState, NativeAuthenticationState } from '../../Types/index.ts'

/** Host normalization: native stores remain Rust-owned and expose no legacy key facade. */
export const normalizeHostAuthenticationState = (
	input: AuthenticationState | NativeAuthenticationState
): AuthenticationState => {
	if (!input || typeof input !== 'object')
		throw new TypeError('auth must provide either { creds, keys } or a native store')
	if (input.creds && input.keys) return input as AuthenticationState
	if (input.store && input.creds) return input as AuthenticationState
	if (input.store) {
		throw new TypeError('host auth with a native store must be created with await createAuthenticationState(store)')
	}
	throw new TypeError('auth must provide both creds and keys when no native store is configured')
}
