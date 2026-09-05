import { Buffer } from 'node:buffer'
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
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

const errnoOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.compare(a, b) === 0

// Real copy for both Uint8Array and Buffer. `Buffer.prototype.slice`
// deliberately returns a view over the same memory, so `.slice()` is NOT
// a valid snapshot for caller-owned buffers.
const copyBytes = (value: Uint8Array): Uint8Array => Uint8Array.from(value)

// File-creation steps behind one durable write. Scoped per store via the
// `options` parameter of `useBridgeStore` — never a shared global — so
// tests can hold, fail, or observe a single store's I/O without affecting
// any other store instance. When omitted, the production implementation
// below is used.
type BridgeStoreFileIO = {
	writeTmp(tmpPath: string, value: Uint8Array): Promise<void>
	publishTmp(tmpPath: string, finalPath: string): Promise<void>
}

type BridgeStoreOptions = {
	io?: BridgeStoreFileIO
}

/**
 * Directory fsync failures that mean "this platform cannot sync directory
 * handles" rather than "your data is at risk". ENOSYS/ENOTSUP: the syscall
 * is not implemented. EINVAL/EBADF: the handle kind does not support
 * syncing (e.g. directory handles on some platforms). EPERM: the sandbox
 * forbids handle sync even though the data path succeeded. Everything
 * else — EIO, ENOSPC, EROFS, EACCES on open — is a real I/O failure and
 * propagates so the caller learns the durability barrier did not hold.
 */
const isUnsupportedDirSync = (e: unknown): boolean => {
	const code = errnoOf(e)
	return code === 'ENOSYS' || code === 'ENOTSUP' || code === 'EINVAL' || code === 'EBADF' || code === 'EPERM'
}

// Persist a directory entry update (rename/unlink) toward power-loss
// durability. `open` failures propagate untouched; only the narrow
// "unsupported" class of `sync` failures is swallowed, documented above.
const syncDir = async (dir: string): Promise<void> => {
	const handle = await open(dir, 'r')
	try {
		await handle.sync()
	} catch (e) {
		if (!isUnsupportedDirSync(e)) throw e
	} finally {
		await handle.close().catch(() => {})
	}
}

const defaultFileIO: BridgeStoreFileIO = {
	async writeTmp(tmpPath: string, value: Uint8Array): Promise<void> {
		// Exclusive create: never truncate a temp file this operation did
		// not create. Temp names are unique per attempt (see durableWrite),
		// so EEXIST is not expected — but if it ever happens the caller
		// retries with a fresh name instead of touching foreign bytes.
		const handle = await open(tmpPath, 'wx')
		try {
			await handle.writeFile(value)
			await handle.sync()
		} catch (e) {
			// Owned (we just created it exclusively): remove our own
			// partial temp, never anyone else's.
			await handle.close().catch(() => {})
			await unlink(tmpPath).catch(() => {})
			throw e
		}
		await handle.close()
	},
	async publishTmp(tmpPath: string, finalPath: string): Promise<void> {
		await rename(tmpPath, finalPath)
		await syncDir(dirname(finalPath))
	}
}

let tmpSeq = 0

/**
 * Creates a file-based store for the WASM bridge.
 *
 * Each (store, key) pair maps to a file: `<folder>/<store>-<key>.bin`
 *
 * Durability model:
 * - Caller buffers are copied synchronously at admission (`set`/`setMany`
 *   copy before queueing), so mutating a buffer after the call — even
 *   before awaiting it — can never change what gets persisted.
 * - Critical stores write through `durableWrite` before `set`/`setMany`
 *   resolve. The in-memory map only records bytes AFTER they are on disk,
 *   so an identical retry following a failure is never skipped and always
 *   re-attempts the write.
 * - Non-critical stores are debounced (50ms coalescing) and readable
 *   immediately (read-your-write), but such reads are NOT durable until
 *   `flush()` succeeds. A failed flush keeps the pending entry and throws,
 *   so the next `flush()` retries the same bytes.
 * - `flush()` first waits for every operation admitted before it (barrier),
 *   then drains the pending writes those operations produced. It never
 *   reports quiescence while prior admitted work is still running.
 * - All operations on one key (set, delete, flush, concurrent batches) run
 *   through a per-key chain, so a stale failure can never erase newer
 *   state and an in-flight write can never resurrect a deleted key.
 * - A failed delete restores the preceding pending/durable state, so an
 *   acknowledged value stays readable and flushable; only a successful
 *   delete clears it, at its linearization point under the key lock.
 * - Every byte array handed back to callers is a copy.
 *
 * @param folder Directory to store bridge state files
 * @param options Optional per-store file-I/O steps (scoped test seam)
 */
export async function useBridgeStore(
	folder: string,
	options?: BridgeStoreOptions
): Promise<NonNullable<AuthenticationState['store']>> {
	await mkdir(folder, { recursive: true })

	const io = options?.io ?? defaultFileIO

	/**
	 * Durable file replacement: write + fsync an exclusively-created,
	 * uniquely-named temp file in the same directory, then atomically
	 * rename it over the target. The previous file (or its absence) is
	 * untouched until the rename succeeds, so a crash or a failed write can
	 * never leave a torn target behind — readers always see the old intact
	 * file or the new intact file. Cleanup only ever removes a temp this
	 * operation created; a temp that already existed is left alone.
	 *
	 * Guarantees are scoped honestly: the rename is atomic against a dead
	 * process, and the file + directory syncs raise the bar toward
	 * power-loss durability on platforms that honor them. No file-level
	 * test can prove power-loss survival — that would need a physical
	 * harness — so tests assert the checkable half (failure atomicity,
	 * retryability) and the code does not claim more.
	 *
	 * Every error propagates, including ENOENT: resolving a write whose
	 * bytes never reached disk would let the caller believe state is
	 * durable.
	 */
	const durableWrite = async (finalPath: string, value: Uint8Array): Promise<void> => {
		const MAX_TMP_ATTEMPTS = 5
		for (let attempt = 0; attempt < MAX_TMP_ATTEMPTS; attempt++) {
			const tmpPath = `${finalPath}.${process.pid}.${tmpSeq++}.${randomBytes(4).toString('hex')}.tmp`
			try {
				await io.writeTmp(tmpPath, value)
			} catch (e) {
				// EEXIST means a foreign temp owns this name (we create
				// exclusively and never overwrite): retry with a fresh name
				// instead of deleting or reusing it. Any other failure is
				// ours to report; `writeTmp` already cleaned up its own temp.
				if (errnoOf(e) === 'EEXIST') continue
				throw e
			}
			try {
				await io.publishTmp(tmpPath, finalPath)
			} catch (e) {
				// Publish of our own temp failed before (or atomically
				// without) replacing the target: remove only our temp. If
				// the rename itself succeeded, the temp is already gone and
				// this unlink is a tolerated no-op.
				await unlink(tmpPath).catch(() => {})
				throw e
			}
			return
		}
		throw new Error(`use-bridge-store durableWrite could not claim a unique temp name for ${finalPath}`)
	}

	// Last bytes known to be durable per key (written, flushed, or read
	// from disk). Private copies only — never a caller-owned reference.
	// Bounded by LRU eviction; eviction only drops knowledge, disk stays
	// canonical.
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

	// Per-key serialization chain. Every key operation runs inside
	// `withKeyLock` for that key; different keys never block each other.
	// The tail swallows rejections so one failed op cannot wedge later ops
	// for the same key. Every admitted op is also tracked in `admitted`
	// until it settles so `flush()` can wait for work admitted before it.
	const chains = new Map<string, Promise<void>>()
	const admitted = new Set<Promise<unknown>>()
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
		admitted.add(next)
		next.then(
			() => {
				admitted.delete(next)
			},
			() => {
				admitted.delete(next)
			}
		)
		return next
	}

	// Debounced non-critical writes not yet flushed to disk.
	const pendingWrites = new Map<
		string,
		{ store: string; key: string; path: string; value: Uint8Array; timer?: ReturnType<typeof setTimeout> }
	>()
	const WRITE_DELAY_MS = 50

	const armTimer = (cacheKey: string, entry: { value: Uint8Array; timer?: ReturnType<typeof setTimeout> }): void => {
		if (entry.timer) clearTimeout(entry.timer)
		entry.timer = setTimeout(() => {
			void flushOne(cacheKey).catch(() => {
				// No caller to report to; the entry stays pending and the
				// next explicit flush() retries it and surfaces the error.
			})
		}, WRITE_DELAY_MS)
		entry.timer.unref() // Don't keep the process alive for debounced writes
	}

	// Flush one pending key. Runs under the key lock (not tracked in
	// `admitted`: the drain loop drives it, so tracking it would make
	// `flush()` wait on itself). On failure the entry is RETAINED (timer
	// cleared) so an explicit `flush()` retries the same bytes, and the
	// error propagates to that caller.
	const flushOne = (cacheKey: string): Promise<void> =>
		withKeyLockInternal(cacheKey, async () => {
			const pending = pendingWrites.get(cacheKey)
			if (!pending) return
			if (pending.timer) {
				clearTimeout(pending.timer)
				pending.timer = undefined
			}
			await durableWrite(pending.path, pending.value)
			if (pendingWrites.get(cacheKey) === pending) pendingWrites.delete(cacheKey)
			rememberDurable(cacheKey, copyBytes(pending.value))
		})

	// Same as `withKeyLock` but invisible to the flush admission barrier.
	// Only the flush drain loop may use this; key operations use
	// `withKeyLock` so `flush()` observes them.
	const withKeyLockInternal = <T>(cacheKey: string, fn: () => Promise<T>): Promise<T> => {
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

	const FLUSH_MAX_PASSES = 32
	const flushAll = async () => {
		// Each pass first waits for every operation admitted so far
		// (barrier), then drains the pending writes those operations
		// produced. A `set()` queued just before `flush()` is therefore
		// observed even if it had not reached `pendingWrites` yet, and an
		// already-running critical write completes before quiescence is
		// declared. `flushOne` internals are not admitted, so the barrier
		// never waits on the drain loop itself (no self-deadlock).
		// A pass with zero successes and nothing newly admitted cannot make
		// progress by immediate retry (persistent failure), so stop and
		// report the first error with the entries still pending for the
		// next flush. The pass cap only guards a caller emitting writes in
		// a tight loop — `Socket/index.ts.end()` waits on this and must
		// return.
		const errors: unknown[] = []
		for (let i = 0; i < FLUSH_MAX_PASSES; i++) {
			const outstanding = [...admitted]
			if (outstanding.length > 0) await Promise.allSettled(outstanding)
			if (pendingWrites.size === 0) {
				if (admitted.size === 0) break
				continue
			}
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
			if (!progressed && admitted.size === 0) break
		}
		if (errors.length > 0) throw errors[0]
		if (pendingWrites.size > 0 || admitted.size > 0) {
			throw new Error(
				`use-bridge-store flushAll did not quiesce after ${FLUSH_MAX_PASSES} passes (${pendingWrites.size} pending writes, ${admitted.size} in-flight operations remain)`
			)
		}
	}

	// Write path shared by `set` and `setMany`. `incoming` is already a
	// private admission-time copy. Must run under the key lock — callers
	// wrap it via `withKeyLock`.
	const doSetLocked = async (store: string, key: string, cacheKey: string, incoming: Uint8Array): Promise<void> => {
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
			rememberDurable(cacheKey, copyBytes(incoming))
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
		armTimer(cacheKey, entry)
		pendingWrites.set(cacheKey, entry)
	}

	const doSet = (store: string, key: string, value: Uint8Array): Promise<void> => {
		// Admission-time copy, synchronous with the call: a caller mutating
		// its buffer immediately after (even before awaiting) cannot change
		// what this operation persists. `Uint8Array.from` copies Buffer
		// inputs too — `Buffer.slice` would only create a shared view.
		const incoming = copyBytes(value)
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, () => doSetLocked(store, key, cacheKey, incoming))
	}

	// Read path shared by `get` and `getMany`. Runs under the key lock so
	// a concurrent delete cannot leave stale bytes resurrected in `durable`.
	// Returns a copy — callers can never mutate the cache or in-flight data.
	// A pending (debounced, not yet durable) value satisfies read-your-write
	// immediately; it is exposed as pending, and `flush()` is the call that
	// makes it durable.
	const doGetLocked = async (store: string, key: string, cacheKey: string): Promise<Uint8Array | null> => {
		const pending = pendingWrites.get(cacheKey)
		if (pending) return copyBytes(pending.value)

		const known = durable.get(cacheKey)
		if (known) return copyBytes(known)

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
		const arr = copyBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
		rememberDurable(cacheKey, copyBytes(arr))
		return arr
	}

	const doGet = (store: string, key: string): Promise<Uint8Array | null> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, () => doGetLocked(store, key, cacheKey))
	}

	// Delete path shared by `delete`, `deleteMany` and `deletePrefix`.
	// Runs under the key lock. The preceding pending/durable state is only
	// cleared once the unlink succeeds (its linearization point); if the
	// unlink fails with a real error, that state is restored — timer
	// re-armed — so an acknowledged value stays readable and flushable, and
	// the error propagates. Only ENOENT (already absent) is tolerated. A
	// successful unlink is followed by a directory sync with the same
	// scoped fallback as the write path, so the deletion itself is durable.
	const doDeleteOne = (store: string, key: string): Promise<void> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, async () => {
			const prevPending = pendingWrites.get(cacheKey)
			const prevDurable = durable.get(cacheKey)
			if (prevPending?.timer) clearTimeout(prevPending.timer)
			pendingWrites.delete(cacheKey)
			durable.delete(cacheKey)

			try {
				await unlink(filePath(store, key))
			} catch (e) {
				if (isEnoent(e)) return
				if (prevDurable) rememberDurable(cacheKey, prevDurable)
				if (prevPending) {
					armTimer(cacheKey, prevPending)
					pendingWrites.set(cacheKey, prevPending)
				}
				throw e
			}
			await syncDir(folder)
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
	// A flush is awaited first so admitted and debounced writes are durable
	// before the readdir; its failure propagates rather than enumerating a
	// stale view. Pending deletes both cancel their `pendingWrites` entry
	// AND unlink immediately, so they never appear here.
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
		// Per-entry semantics are identical to `set` — admission copies are
		// taken synchronously for every entry, in order. Best-effort across
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
