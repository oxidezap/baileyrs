import { Buffer } from 'node:buffer'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthenticationState } from '../Types/index.ts'

/**
 * Stores whose loss on SIGKILL produces undecryptable messages or
 * permanent app-state divergence. Each entry below carries a reason —
 * promoting a store to "critical" doubles disk I/O, so don't add
 * anything here that can be re-derived from the network.
 *
 *   `session` / `identity` — Signal session ratchet steps. Lose
 *      one step → next inbound message from peer undecryptable.
 *   `device` — own device record (noiseKey, signedIdentityKey,
 *      adv_secret_key). Loss = forced re-pair.
 *   `prekey` — consumed prekey must be durably consumed; reuse
 *      on a different peer makes the server reject the bundle.
 *   `sync_key` — app-state HMAC key. Loss → permanent gap in
 *      app-state mutations until full re-sync.
 *   `sender_key` — group-message ratchet (same model as `session`,
 *      but per group). Lose a step → next inbound message from the
 *      same group undecryptable.
 *   `sync_version` — LTHash state per app-state collection
 *      (regular_high / regular_low / critical_block / etc.). Gates
 *      every mutation MAC verification — lose it and every
 *      subsequent app-state action throws "hash mismatch" until
 *      full re-sync.
 *   `mutation_mac` — replay-protection cache for app-state
 *      mutations. Loss can let a replayed mutation re-apply.
 */
const CRITICAL_STORES: ReadonlySet<string> = new Set([
	'session',
	'identity',
	'device',
	'prekey',
	'sync_key',
	'sender_key',
	'sync_version',
	'mutation_mac'
])

/**
 * `ENOENT` is the only error tolerated on a write/readdir: it means the auth
 * folder was removed (e.g. during shutdown/cleanup). Any other error (ENOSPC,
 * EACCES, EIO, ENOTDIR) is a real persistence failure that MUST propagate —
 * swallowing it would silently lose Signal session state or message secrets
 * while the caller believes the write succeeded.
 */
const isEnoent = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

/**
 * Creates a file-based store for the WASM bridge.
 *
 * Each (store, key) pair maps to a file: `<folder>/<store>-<key>.bin`
 *
 * Uses a write-through in-memory cache to avoid redundant disk reads.
 * Writes go to both cache and disk. Reads hit cache first, disk on miss.
 *
 * @param folder Directory to store bridge state files
 */
export async function useBridgeStore(folder: string): Promise<NonNullable<AuthenticationState['store']>> {
	await mkdir(folder, { recursive: true })

	// Write-through cache with LRU eviction to bound memory
	const MAX_CACHE_ENTRIES = 5000
	const cache = new Map<string, Uint8Array>()
	const touchCache = (key: string, value: Uint8Array) => {
		// LRU: delete + re-insert moves to end of insertion order
		cache.delete(key)
		cache.set(key, value)
		// Evict oldest entries if over limit
		if (cache.size > MAX_CACHE_ENTRIES) {
			const first = cache.keys().next().value!
			cache.delete(first)
		}
	}

	const filePath = (store: string, key: string) => join(folder, `${store}-${encodeURIComponent(key)}.bin`)

	// Durable write that propagates real failures but tolerates the folder
	// having been removed (shutdown race). Used by both `set` and `setMany`.
	const writeCritical = async (store: string, key: string, value: Uint8Array): Promise<void> => {
		try {
			await writeFile(filePath(store, key), value)
		} catch (e) {
			if (!isEnoent(e)) throw e
			// folder removed during shutdown — nothing to persist into
		}
	}

	// Batch write queue: coalesces rapid writes to the same key
	const pendingWrites = new Map<string, { path: string; value: Uint8Array; timer: ReturnType<typeof setTimeout> }>()
	const WRITE_DELAY_MS = 50

	const flushWrite = async (cacheKey: string) => {
		const pending = pendingWrites.get(cacheKey)
		if (!pending) return
		clearTimeout(pending.timer)
		pendingWrites.delete(cacheKey)
		try {
			await writeFile(pending.path, pending.value)
		} catch {
			// Ignore — folder may have been deleted during cleanup
		}
	}

	// Delete many keys concurrently (shared by `deleteMany` and `deletePrefix`).
	// Defined as a closure rather than a method so callers don't depend on
	// `this` — the bridge invokes every store callback with `this = null`.
	const doDeleteMany = async (store: string, keys: string[]): Promise<void> => {
		if (keys.length === 0) return
		await Promise.all(
			keys.map(async key => {
				const cacheKey = `${store}\0${key}`
				cache.delete(cacheKey)
				const existing = pendingWrites.get(cacheKey)
				if (existing) {
					clearTimeout(existing.timer)
					pendingWrites.delete(cacheKey)
				}

				try {
					await unlink(filePath(store, key))
				} catch {
					// ignore if file doesn't exist
				}
			})
		)
	}

	const FLUSH_MAX_PASSES = 32
	const flushAll = async () => {
		// Drain in a loop because new sets can land while we're awaiting the
		// previous batch's writeFile. Bounded so a caller emitting writes in
		// a tight loop can't lock us forever — `Socket/index.ts.end()` waits
		// on this and must always return. If the cap is hit with writes
		// still pending, surface that to the caller — silently dropping
		// them would lose Signal session steps and corrupt next decrypt.
		for (let i = 0; i < FLUSH_MAX_PASSES && pendingWrites.size > 0; i++) {
			const keys = [...pendingWrites.keys()]
			await Promise.all(keys.map(flushWrite))
		}
		if (pendingWrites.size > 0) {
			throw new Error(
				`use-bridge-store flushAll did not quiesce after ${FLUSH_MAX_PASSES} passes (${pendingWrites.size} pending writes remain)`
			)
		}
	}

	// Enumerate live keys in a namespace (shared by `listKeys` and
	// `deletePrefix`). Closure, not a method, so it never depends on `this`.
	// Files are `<store>-<encodeURIComponent(key)>.bin`; store names never
	// contain a hyphen, so split on the FIRST hyphen and decode the remainder.
	// readdir (durable view) is unioned with not-yet-flushed debounced writes
	// so a key written <50ms ago isn't missed; a flush is awaited first so a
	// torn debounce window can't drop a key. Pending deletes both cancel their
	// `pendingWrites` entry AND unlink immediately, so they never appear here.
	const doListKeys = async (store: string, prefix?: string): Promise<string[]> => {
		await flushAll()

		const filePrefix = `${store}-`
		const found = new Set<string>()

		let entries: string[]
		try {
			entries = await readdir(folder)
		} catch (e) {
			// Folder removed (shutdown) → genuinely empty. Any other error
			// (EACCES/EIO) must NOT masquerade as "no keys", or the core would
			// think persisted state is gone and could prune live indexes.
			if (isEnoent(e)) entries = []
			else throw e
		}

		for (const file of entries) {
			if (!file.startsWith(filePrefix) || !file.endsWith('.bin')) continue
			const encoded = file.slice(filePrefix.length, -'.bin'.length)
			let key: string
			try {
				key = decodeURIComponent(encoded)
			} catch {
				continue // skip a filename we can't decode rather than crash
			}
			if (prefix && !key.startsWith(prefix)) continue
			found.add(key)
		}

		// Union any writes still pending after the flush (a fresh set could land
		// while flushAll awaited). Belt-and-suspenders.
		for (const cacheKey of pendingWrites.keys()) {
			const sep = cacheKey.indexOf('\0')
			if (sep < 0 || cacheKey.slice(0, sep) !== store) continue
			const key = cacheKey.slice(sep + 1)
			if (prefix && !key.startsWith(prefix)) continue
			found.add(key)
		}

		return [...found]
	}

	return {
		async get(store: string, key: string): Promise<Uint8Array | null> {
			const cacheKey = `${store}\0${key}`

			// Check cache first
			const cached = cache.get(cacheKey)
			if (cached) return cached

			const pending = pendingWrites.get(cacheKey)
			if (pending) return pending.value

			try {
				const data = await readFile(filePath(store, key))
				const arr = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
				touchCache(cacheKey, arr)
				return arr
			} catch {
				return null
			}
		},

		async set(store: string, key: string, value: Uint8Array): Promise<void> {
			const cacheKey = `${store}\0${key}`

			// Skip write if value is identical to cached version
			const prev = cache.get(cacheKey)
			if (prev && Buffer.from(prev).equals(Buffer.from(value))) {
				return
			}

			touchCache(cacheKey, value)

			if (CRITICAL_STORES.has(store)) {
				const existing = pendingWrites.get(cacheKey)
				if (existing) {
					clearTimeout(existing.timer)
					pendingWrites.delete(cacheKey)
				}

				// Propagate real failures (ENOSPC/EACCES/…) — losing a critical
				// Signal write silently corrupts the next decrypt.
				await writeCritical(store, key, value)

				return
			}

			// Non-critical writes: coalesce rapid writes to the same key
			const existing = pendingWrites.get(cacheKey)
			if (existing) {
				clearTimeout(existing.timer)
			}

			const path = filePath(store, key)
			const timer = setTimeout(() => void flushWrite(cacheKey), WRITE_DELAY_MS)
			timer.unref() // Don't keep the process alive for debounced writes
			pendingWrites.set(cacheKey, { path, value, timer })
		},

		async delete(store: string, key: string): Promise<void> {
			const cacheKey = `${store}\0${key}`
			cache.delete(cacheKey)

			// Cancel pending write
			const existing = pendingWrites.get(cacheKey)
			if (existing) {
				clearTimeout(existing.timer)
				pendingWrites.delete(cacheKey)
			}

			try {
				await unlink(filePath(store, key))
			} catch {
				// ignore if file doesn't exist
			}
		},

		// Batched variant of `set`. The bridge calls this (when present) to
		// persist a burst of entries in a single FFI crossing instead of N
		// round-trips (e.g. ~20k messageSecrets from a history sync). Per-entry
		// semantics are identical to `set` — same skip-if-equal, same cache
		// touch, same critical-vs-debounced write policy.
		async setMany(store: string, entries: [key: string, value: Uint8Array][]): Promise<void> {
			// Empty batch is a valid no-op.
			if (entries.length === 0) return

			const critical = CRITICAL_STORES.has(store)
			// Collect critical writes so we can run them concurrently with
			// Promise.all instead of awaiting each writeFile serially in a loop.
			const criticalWrites: Promise<void>[] = []

			for (const [key, value] of entries) {
				const cacheKey = `${store}\0${key}`

				// Skip write if value is identical to cached version
				const prev = cache.get(cacheKey)
				if (prev && Buffer.from(prev).equals(Buffer.from(value))) {
					continue
				}

				touchCache(cacheKey, value)

				if (critical) {
					// Cancel any pending debounced write for this key first,
					// exactly like `set` does, then write immediately.
					const existing = pendingWrites.get(cacheKey)
					if (existing) {
						clearTimeout(existing.timer)
						pendingWrites.delete(cacheKey)
					}

					// Propagate real failures: if a critical write in the batch
					// fails, setMany rejects, and the Rust core skips the
					// follow-up self-index rewrite (so the index can't claim a
					// value exists that was never persisted).
					criticalWrites.push(writeCritical(store, key, value))
					continue
				}

				// Non-critical writes: coalesce rapid writes to the same key.
				// The debounce already coalesces a burst, so scheduling each
				// entry is fine — no immediate flush needed.
				const existing = pendingWrites.get(cacheKey)
				if (existing) {
					clearTimeout(existing.timer)
				}

				const path = filePath(store, key)
				const timer = setTimeout(() => void flushWrite(cacheKey), WRITE_DELAY_MS)
				timer.unref() // Don't keep the process alive for debounced writes
				pendingWrites.set(cacheKey, { path, value, timer })
			}

			// Run all critical writes concurrently.
			if (criticalWrites.length > 0) {
				await Promise.all(criticalWrites)
			}
		},

		// Batched variant of `delete`. Per-key semantics are identical to
		// `delete`; unlinks run concurrently via Promise.all.
		deleteMany: doDeleteMany,

		// Read many keys at once. Cache-aside per key (like `get`), so a hit
		// never touches disk; misses read the file. Missing keys are omitted.
		async getMany(store: string, keys: string[]): Promise<[key: string, value: Uint8Array][]> {
			if (keys.length === 0) return []

			const results = await Promise.all(
				keys.map(async (key): Promise<[string, Uint8Array] | null> => {
					const cacheKey = `${store}\0${key}`
					const cached = cache.get(cacheKey)
					if (cached) return [key, cached]
					const pending = pendingWrites.get(cacheKey)
					if (pending) return [key, pending.value]
					try {
						const data = await readFile(filePath(store, key))
						const arr = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
						touchCache(cacheKey, arr)
						return [key, arr]
					} catch {
						return null
					}
				})
			)

			return results.filter((r): r is [string, Uint8Array] => r !== null)
		},

		listKeys: doListKeys,

		async deletePrefix(store: string, prefix: string): Promise<number> {
			const keys = await doListKeys(store, prefix)
			await doDeleteMany(store, keys)

			return keys.length
		},

		// File-per-key can do everything; enumeration via readdir lets the core
		// drop its hand-maintained meta-indexes for this backend.
		capabilities: { batch: true, enumerate: true, prefixDelete: true },

		flush: flushAll
	}
}
