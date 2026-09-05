import { Buffer } from 'node:buffer'
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AuthenticationState } from '../Types/index.ts'

/**
 * Stores whose loss on SIGKILL produces undecryptable messages or
 * permanent app-state divergence. Each entry below carries a reason —
 * promoting a store to "critical" multiplies disk I/O (write + fsync +
 * atomic rename per key), so don't add anything here that can be
 * re-derived from the network.
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
 * `ENOENT` is legitimate only where absence is a valid answer: reading a
 * key that was never written (or was deleted), deleting a key that is
 * already gone, and enumerating a folder that was removed. Everywhere
 * else — writes, flushes, non-ENOENT read/delete failures (ENOTDIR,
 * EACCES, EIO, ENOSPC) — the error MUST propagate. A write that resolves
 * without durable bytes while the caller believes it persisted silently
 * loses Signal session state or message secrets.
 */
const isEnoent = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.compare(a, b) === 0

const snapshot = (value: Uint8Array): Uint8Array => value.slice()

/**
 * Test-only fault-injection seam for the atomic-write steps. Production
 * code always uses the real implementations. Tests replace one step at a
 * time with a rejecting stub to prove that a failure before the rename
 * leaves the previous file intact, that a failure anywhere keeps the work
 * retryable, and that the retry then persists. Not part of the public
 * store contract — the bridge never touches this object.
 */
export const __testBridgeStoreIO: {
	writeTmp(tmpPath: string, value: Uint8Array): Promise<void>
	publishTmp(tmpPath: string, finalPath: string): Promise<void>
} = {
	async writeTmp(tmpPath: string, value: Uint8Array): Promise<void> {
		const handle = await open(tmpPath, 'w')
		try {
			await handle.writeFile(value)
			await handle.sync()
		} finally {
			await handle.close()
		}
	},
	async publishTmp(tmpPath: string, finalPath: string): Promise<void> {
		await rename(tmpPath, finalPath)
		// Best-effort directory sync so the rename itself survives a power
		// loss, not just a process crash. Platforms that cannot sync a
		// directory keep the rename either way — atomicity against a dead
		// process never depended on this call.
		try {
			const dirHandle = await open(dirname(finalPath), 'r')
			try {
				await dirHandle.sync()
			} finally {
				await dirHandle.close()
			}
		} catch {
			// ignore — durability degrades to process-crash atomicity
		}
	}
}

let tmpSeq = 0

/**
 * Durable file replacement: write + fsync a uniquely-named temp file in
 * the same directory, then atomically rename it over the target. The
 * previous file (or its absence) is untouched until the rename succeeds,
 * so a crash or a failed write can never leave a torn target behind —
 * readers always see the old intact file or the new intact file.
 *
 * Guarantees are scoped honestly: the rename is atomic against a dead
 * process, and the file + directory syncs raise the bar toward power-loss
 * durability on platforms that honor them. No file-level test can prove
 * power-loss survival — that would need a physical harness — so tests
 * assert the mockable half (failure atomicity, retryability) and the code
 * does not claim more.
 *
 * Every error propagates, including ENOENT: resolving a write whose bytes
 * never reached disk would let the caller believe state is durable.
 */
const durableWrite = async (finalPath: string, value: Uint8Array): Promise<void> => {
	const tmpPath = `${finalPath}.${process.pid}.${tmpSeq++}.tmp`
	try {
		await __testBridgeStoreIO.writeTmp(tmpPath, value)
	} catch (e) {
		await unlink(tmpPath).catch(() => {})
		throw e
	}
	try {
		await __testBridgeStoreIO.publishTmp(tmpPath, finalPath)
	} catch (e) {
		await unlink(tmpPath).catch(() => {})
		throw e
	}
}

/**
 * Creates a file-based store for the WASM bridge.
 *
 * Each (store, key) pair maps to a file: `<folder>/<store>-<key>.bin`
 *
 * Durability model:
 * - Critical stores write through `durableWrite` before `set`/`setMany`
 *   resolve. The in-memory map only records bytes AFTER they are on disk,
 *   so an identical retry following a failure is never skipped and always
 *   re-attempts the write.
 * - Non-critical stores are debounced (50ms coalescing) and readable
 *   immediately (read-your-write), but such reads are NOT durable until
 *   `flush()` succeeds. A failed flush keeps the pending entry and throws,
 *   so the next `flush()` retries the same bytes.
 * - All mutations of one key (set, delete, flush, concurrent batches) run
 *   through a per-key chain, so a stale failure can never erase newer
 *   state and an in-flight write can never resurrect a deleted key.
 * - Every byte array crossing the boundary is copied: caller buffers
 *   cannot mutate cached or in-flight data, and returned buffers cannot
 *   mutate the cache either.
 *
 * @param folder Directory to store bridge state files
 */
export async function useBridgeStore(folder: string): Promise<NonNullable<AuthenticationState['store']>> {
	await mkdir(folder, { recursive: true })

	// Last bytes known to be durable per key (written, flushed, or read
	// from disk). Snapshots only — never a caller-owned reference. Bounded
	// by LRU eviction; eviction only drops knowledge, disk stays canonical.
	const MAX_CACHE_ENTRIES = 5000
	const durable = new Map<string, Uint8Array>()
	const rememberDurable = (key: string, value: Uint8Array) => {
		// LRU: delete + re-insert moves to end of insertion order
		durable.delete(key)
		durable.set(key, value)
		if (durable.size > MAX_CACHE_ENTRIES) {
			const first = durable.keys().next().value!
			durable.delete(first)
		}
	}

	const filePath = (store: string, key: string) => join(folder, `${store}-${encodeURIComponent(key)}.bin`)

	// Per-key serialization chain. Every mutation or read of one key runs
	// inside `withKeyLock` for that key; different keys never block each
	// other. The tail swallows rejections so one failed op cannot wedge
	// later ops for the same key.
	const chains = new Map<string, Promise<void>>()
	const withKeyLock = <T>(cacheKey: string, fn: () => Promise<T>): Promise<T> => {
		const prev = chains.get(cacheKey) ?? Promise.resolve()
		const next = prev.then(fn, fn)
		const tail = next.then(
			() => undefined,
			() => undefined
		)
		chains.set(cacheKey, tail)
		tail.then(() => {
			if (chains.get(cacheKey) === tail) chains.delete(cacheKey)
		})
		return next
	}

	// Debounced non-critical writes not yet flushed to disk.
	const pendingWrites = new Map<
		string,
		{ store: string; key: string; path: string; value: Uint8Array; timer?: ReturnType<typeof setTimeout> }
	>()
	const WRITE_DELAY_MS = 50

	// Flush one pending key. Runs under the key lock. On failure the entry
	// is RETAINED (timer cleared) so an explicit `flush()` retries the same
	// bytes, and the error propagates to that caller. The debounce timer
	// swallows its own failure — it has no caller to report to — but the
	// entry stays pending, so the work is never lost silently.
	const flushOne = (cacheKey: string): Promise<void> =>
		withKeyLock(cacheKey, async () => {
			const pending = pendingWrites.get(cacheKey)
			if (!pending) return
			if (pending.timer) {
				clearTimeout(pending.timer)
				pending.timer = undefined
			}
			await durableWrite(pending.path, pending.value)
			if (pendingWrites.get(cacheKey) === pending) pendingWrites.delete(cacheKey)
			rememberDurable(cacheKey, snapshot(pending.value))
		})

	const FLUSH_MAX_PASSES = 32
	const flushAll = async () => {
		// Drain in passes because new sets can land while a batch's writes
		// are awaited. A pass with zero successes cannot make progress by
		// immediate retry (persistent failure), so stop and report the
		// first error with the entries still pending for the next flush.
		// The pass cap only guards a caller emitting writes in a tight
		// loop — `Socket/index.ts.end()` waits on this and must return.
		const errors: unknown[] = []
		for (let i = 0; i < FLUSH_MAX_PASSES && pendingWrites.size > 0; i++) {
			const keys = [...pendingWrites.keys()]
			let progressed = false
			await Promise.all(
				keys.map(key =>
					flushOne(key).then(
						() => {
							progressed = true
						},
						e => {
							errors.push(e)
						}
					)
				)
			)
			if (!progressed) break
		}
		if (errors.length > 0) throw errors[0]
		if (pendingWrites.size > 0) {
			throw new Error(
				`use-bridge-store flushAll did not quiesce after ${FLUSH_MAX_PASSES} passes (${pendingWrites.size} pending writes remain)`
			)
		}
	}

	// Write path shared by `set` and `setMany`. Must run under the key
	// lock — callers wrap it via `withKeyLock`.
	const doSetLocked = async (store: string, key: string, cacheKey: string, value: Uint8Array): Promise<void> => {
		const incoming = snapshot(value)

		// Skip only when the identical bytes are already durable or already
		// queued. A failed write never reaches `durable`/`pendingWrites`,
		// so an identical retry always re-attempts instead of resolving
		// without persisting.
		const pending = pendingWrites.get(cacheKey)
		if (pending) {
			if (bytesEqual(pending.value, incoming)) return
		} else {
			const known = durable.get(cacheKey)
			if (known && bytesEqual(known, incoming)) return
		}

		if (CRITICAL_STORES.has(store)) {
			if (pending) {
				if (pending.timer) clearTimeout(pending.timer)
				pendingWrites.delete(cacheKey)
			}

			// Propagate every failure (ENOSPC/EACCES/EIO/ENOTDIR/ENOENT) —
			// losing a critical Signal write silently corrupts next decrypt.
			await durableWrite(filePath(store, key), incoming)
			rememberDurable(cacheKey, snapshot(incoming))
			return
		}

		// Non-critical writes: coalesce rapid writes to the same key
		if (pending?.timer) clearTimeout(pending.timer)
		const entry = {
			store,
			key,
			path: filePath(store, key),
			value: incoming,
			timer: undefined as ReturnType<typeof setTimeout> | undefined
		}
		entry.timer = setTimeout(() => {
			void flushOne(cacheKey).catch(() => {
				// No caller to report to; the entry stays pending and the
				// next explicit flush() retries it and surfaces the error.
			})
		}, WRITE_DELAY_MS)
		entry.timer.unref() // Don't keep the process alive for debounced writes
		pendingWrites.set(cacheKey, entry)
	}

	const doSet = (store: string, key: string, value: Uint8Array): Promise<void> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, () => doSetLocked(store, key, cacheKey, value))
	}

	// Read path shared by `get` and `getMany`. Runs under the key lock so
	// a concurrent delete cannot leave stale bytes resurrected in `durable`.
	// Returns a copy — callers can never mutate the cache or in-flight data.
	// A pending (debounced, not yet durable) value satisfies read-your-write
	// immediately; it is exposed as pending, and `flush()` is the call that
	// makes it durable.
	const doGetLocked = async (store: string, key: string, cacheKey: string): Promise<Uint8Array | null> => {
		const pending = pendingWrites.get(cacheKey)
		if (pending) return snapshot(pending.value)

		const known = durable.get(cacheKey)
		if (known) return snapshot(known)

		let data: Awaited<ReturnType<typeof readFile>>
		try {
			data = await readFile(filePath(store, key))
		} catch (e) {
			// Absent key is a legitimate null. Any other read failure
			// (EACCES/EIO/ENOTDIR) must NOT masquerade as "no value", or the
			// core would treat persisted state as gone.
			if (isEnoent(e)) return null
			throw e
		}
		const arr = snapshot(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
		rememberDurable(cacheKey, snapshot(arr))
		return arr
	}

	const doGet = (store: string, key: string): Promise<Uint8Array | null> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, () => doGetLocked(store, key, cacheKey))
	}

	// Delete path shared by `delete`, `deleteMany` and `deletePrefix`.
	// Runs under the key lock: cancels queued writes first so a flush in
	// flight can never resurrect the key, and drops durable knowledge so a
	// later read goes back to disk. Only ENOENT (already absent) is
	// tolerated; real unlink failures propagate.
	const doDeleteOne = (store: string, key: string): Promise<void> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, async () => {
			durable.delete(cacheKey)
			const pending = pendingWrites.get(cacheKey)
			if (pending) {
				if (pending.timer) clearTimeout(pending.timer)
				pendingWrites.delete(cacheKey)
			}

			try {
				await unlink(filePath(store, key))
			} catch (e) {
				if (!isEnoent(e)) throw e
			}
		})
	}

	// Delete many keys concurrently (shared by `deleteMany` and
	// `deletePrefix`). Defined as a closure rather than a method so callers
	// don't depend on `this` — the bridge invokes every store callback with
	// `this = null`. Best-effort across keys: every key is attempted even
	// when a sibling fails, and the first error propagates.
	const doDeleteMany = async (store: string, keys: string[]): Promise<void> => {
		if (keys.length === 0) return
		await Promise.all(keys.map(key => doDeleteOne(store, key)))
	}

	// Enumerate live keys in a namespace (shared by `listKeys` and
	// `deletePrefix`). Closure, not a method, so it never depends on `this`.
	// Files are `<store>-<encodeURIComponent(key)>.bin`; store names never
	// contain a hyphen, so split on the FIRST hyphen and decode the remainder.
	// A flush is awaited first so debounced writes are durable before the
	// readdir; its failure propagates rather than enumerating a stale view.
	// Pending deletes both cancel their `pendingWrites` entry AND unlink
	// immediately, so they never appear here.
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
		get: doGet,

		set: doSet,

		delete: doDeleteOne,

		// Batched variant of `set`. The bridge calls this (when present) to
		// persist a burst of entries in a single FFI crossing instead of N
		// round-trips (e.g. ~20k messageSecrets from a history sync).
		// Per-entry semantics are identical to `set`. Best-effort across
		// keys per the bridge contract: every entry is attempted even when
		// a sibling fails (writes are idempotent by key, so the core can
		// retry the batch), and the first error propagates. No multi-key
		// transaction is attempted — the filesystem does not provide one.
		async setMany(store: string, entries: [key: string, value: Uint8Array][]): Promise<void> {
			// Empty batch is a valid no-op.
			if (entries.length === 0) return

			// Schedule every entry synchronously so same-key duplicates chain
			// in batch order; per-key locks serialize against concurrent
			// sets, deletes and flushes.
			await Promise.all(entries.map(([key, value]) => doSet(store, key, value)))
		},

		// Batched variant of `delete`. Per-key semantics are identical to
		// `delete`; unlinks run concurrently via Promise.all.
		deleteMany: doDeleteMany,

		// Read many keys at once. Cache-aside per key (like `get`), so a hit
		// never touches disk; misses read the file. Missing keys are omitted;
		// real read failures propagate rather than silently dropping keys.
		async getMany(store: string, keys: string[]): Promise<[key: string, value: Uint8Array][]> {
			if (keys.length === 0) return []

			const results = await Promise.all(
				keys.map(async (key): Promise<[string, Uint8Array] | null> => {
					const value = await doGet(store, key)
					return value === null ? null : [key, value]
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
