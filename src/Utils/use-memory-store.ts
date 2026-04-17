import type { AuthenticationState } from '../Types/index.ts'

const cacheKey = (store: string, key: string) => `${store}\0${key}`

/**
 * Creates a purely in-memory store for the WASM bridge.
 *
 * All state lives in a Map and is lost when the process exits.
 * Useful for benchmarks, tests, and ephemeral sessions.
 */
export function useMemoryStore(): NonNullable<AuthenticationState['store']> {
	const data = new Map<string, Uint8Array>()

	return {
		async get(store: string, key: string): Promise<Uint8Array | null> {
			return data.get(cacheKey(store, key)) ?? null
		},

		async set(store: string, key: string, value: Uint8Array): Promise<void> {
			data.set(cacheKey(store, key), value)
		},

		async delete(store: string, key: string): Promise<void> {
			data.delete(cacheKey(store, key))
		},

		async flush() {}
	}
}
