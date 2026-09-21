import type { AuthenticationState, NativeAuthenticationState } from '../../Types/index.ts'
import { initHostAuthCreds } from '../host-auth-state.ts'

/** Host normalization: native stores remain Rust-owned and expose no legacy key facade. */
export const normalizeHostAuthenticationState = (
	input: AuthenticationState | NativeAuthenticationState
): AuthenticationState => {
	if (!input || typeof input !== 'object')
		throw new TypeError('auth must provide either { creds, keys } or a native store')
	if (input.creds && input.keys) return input as AuthenticationState
	if (!input.store) throw new TypeError('auth must provide both creds and keys when no native store is configured')
	const creds = input.creds ?? initHostAuthCreds()
	const keys = {
		get: async () => {
			throw new Error('legacy SignalKeyStore is not available on the host surface')
		},
		set: async () => {
			throw new Error('legacy SignalKeyStore is not available on the host surface')
		}
	} as unknown as AuthenticationState['keys']
	return { creds, keys, store: input.store }
}
