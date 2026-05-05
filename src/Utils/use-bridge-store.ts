import { Buffer } from 'node:buffer'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
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

				try {
					await writeFile(filePath(store, key), value)
				} catch {
					// Directory may have been removed during shutdown
				}

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

		flush: flushAll
	}
}
