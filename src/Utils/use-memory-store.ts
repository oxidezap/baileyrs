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

		async setMany(store: string, entries: [key: string, value: Uint8Array][]): Promise<void> {
			for (const [key, value] of entries) data.set(cacheKey(store, key), value)
		},

		async getMany(store: string, keys: string[]): Promise<[key: string, value: Uint8Array][]> {
			const out: [string, Uint8Array][] = []
			for (const key of keys) {
				const value = data.get(cacheKey(store, key))
				if (value !== undefined) out.push([key, value])
			}

			return out
		},

		async deleteMany(store: string, keys: string[]): Promise<void> {
			for (const key of keys) data.delete(cacheKey(store, key))
		},

		// Enumerate keys in one namespace. The Map is keyed `${store}\0${key}`,
		// so we filter by that prefix and strip it back to the bare key.
		async listKeys(store: string, prefix?: string): Promise<string[]> {
			const namespace = `${store}\0`
			const out: string[] = []
			for (const composite of data.keys()) {
				if (!composite.startsWith(namespace)) continue
				const key = composite.slice(namespace.length)
				if (prefix && !key.startsWith(prefix)) continue
				out.push(key)
			}

			return out
		},

		async deletePrefix(store: string, prefix: string): Promise<number> {
			const namespace = `${store}\0${prefix}`
			// Collect matches first, then delete — avoids mutating the Map mid-iteration.
			const toDelete: string[] = []
			for (const composite of data.keys()) {
				if (composite.startsWith(namespace)) toDelete.push(composite)
			}
			for (const composite of toDelete) data.delete(composite)

			return toDelete.length
		},

		// Declares the optional primitives the bridge may use. An in-memory Map
		// can do everything; enumeration lets the core drop its meta-indexes.
		// `writeBack`: this store is ephemeral (lost on process exit), so there
		// is no durability to lose — let the bridge buffer per-message Signal
		// state in WASM and cross to this Map only on flush (disconnect). That
		// keeps the hot path off the JS↔WASM boundary.
		capabilities: { batch: true, enumerate: true, prefixDelete: true, writeBack: true },

		async flush() {}
	}
}
