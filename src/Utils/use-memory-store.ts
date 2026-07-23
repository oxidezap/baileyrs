import type { AuthenticationState } from '../Types/index.ts'
import { markNativeMemoryStore } from '../Compatibility/internal/native-memory-store.ts'

type StoreBucket = Map<string, Uint8Array>

/**
 * Creates a purely in-memory authentication store.
 *
 * By default, a reusable host Map owns the bytes. `{ native: true }` instead
 * selects the socket-local in-memory backend already owned by the core, avoiding
 * host/WASM storage crossings. Native state is intentionally ephemeral and is
 * not reusable by a later socket instance.
 */
export function useMemoryStore(options: { native?: boolean } = {}): NonNullable<AuthenticationState['store']> {
	const stores = new Map<string, StoreBucket>()

	const bucketForWrite = (store: string): StoreBucket => {
		let bucket = stores.get(store)
		if (!bucket) {
			bucket = new Map()
			stores.set(store, bucket)
		}
		return bucket
	}

	const deleteEmptyBucket = (store: string, bucket: StoreBucket): void => {
		if (bucket.size === 0) stores.delete(store)
	}

	const memoryStore: NonNullable<AuthenticationState['store']> = {
		async get(store: string, key: string): Promise<Uint8Array | null> {
			return stores.get(store)?.get(key) ?? null
		},

		async set(store: string, key: string, value: Uint8Array): Promise<void> {
			bucketForWrite(store).set(key, value)
		},

		async delete(store: string, key: string): Promise<void> {
			const bucket = stores.get(store)
			if (!bucket) return
			bucket.delete(key)
			deleteEmptyBucket(store, bucket)
		},

		async setMany(store: string, entries: [key: string, value: Uint8Array][]): Promise<void> {
			if (entries.length === 0) return
			const bucket = bucketForWrite(store)
			for (const [key, value] of entries) bucket.set(key, value)
		},

		async getMany(store: string, keys: string[]): Promise<[key: string, value: Uint8Array][]> {
			const bucket = stores.get(store)
			if (!bucket) return []
			const out: [string, Uint8Array][] = []
			for (const key of keys) {
				const value = bucket.get(key)
				if (value !== undefined) out.push([key, value])
			}

			return out
		},

		async deleteMany(store: string, keys: string[]): Promise<void> {
			const bucket = stores.get(store)
			if (!bucket) return
			for (const key of keys) bucket.delete(key)
			deleteEmptyBucket(store, bucket)
		},

		async listKeys(store: string, prefix?: string): Promise<string[]> {
			const bucket = stores.get(store)
			if (!bucket) return []
			const out: string[] = []
			for (const key of bucket.keys()) {
				if (prefix && !key.startsWith(prefix)) continue
				out.push(key)
			}

			return out
		},

		async deletePrefix(store: string, prefix: string): Promise<number> {
			const bucket = stores.get(store)
			if (!bucket) return 0
			let deleted = 0
			for (const key of bucket.keys()) {
				if (!key.startsWith(prefix)) continue
				bucket.delete(key)
				deleted += 1
			}
			deleteEmptyBucket(store, bucket)
			return deleted
		},

		// Declares the optional primitives the bridge may use. An in-memory Map
		// can do everything; enumeration lets the core drop its meta-indexes.
		capabilities: { batch: true, enumerate: true, prefixDelete: true },

		async flush() {}
	}

	if (options.native) markNativeMemoryStore(memoryStore)
	return memoryStore
}
