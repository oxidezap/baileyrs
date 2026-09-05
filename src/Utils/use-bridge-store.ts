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

/**
 * Pure classifier for directory-barrier failures: does this error mean
 * "this platform cannot sync directory handles" (degrade to process-crash
 * atomicity) or "the durability barrier did not hold" (propagate)?
 *
 * - `ENOSYS` / `ENOTSUP` on any platform: the operation is not
 *   implemented — genuinely unsupported, safe to degrade.
 * - `EINVAL` / `EPERM` / `EISDIR` on `win32` only: Windows directory
 *   handles reject open-for-read and FlushFileBuffers with these codes,
 *   so they are the documented platform fallback there. On Linux/macOS
 *   the same codes from a freshly opened directory handle mean something
 *   is genuinely wrong and they propagate.
 * - Everything else propagates everywhere: `EIO`, `ENOSPC`, `EROFS`,
 *   `EACCES`, `ENOENT`, and notably `EBADF` (a bad handle is a real bug,
 *   never evidence of an unsupported platform).
 *
 * `platform` defaults to the running platform; tests pass explicit values
 * to cover the matrix deterministically on any OS.
 */
export const isUnsupportedDirSync = (e: unknown, platform: NodeJS.Platform = process.platform): boolean => {
	const code = errnoOf(e)
	if (code === 'ENOSYS' || code === 'ENOTSUP') return true
	if (platform === 'win32' && (code === 'EINVAL' || code === 'EPERM' || code === 'EISDIR')) return true
	return false
}

// File-creation steps behind one durable write plus the directory barrier.
// Scoped per store via the `options` parameter of `useBridgeStore` — never
// a shared global — so tests can hold, fail, or observe a single store's
// I/O without affecting any other store instance. Every member is optional
// and falls back to its default below, so a test can replace one low-level
// step (e.g. temp-file creation) while exercising the real default
// implementation of the rest. Only the defaults provide the durability
// contract documented on `useBridgeStore`; a custom implementation is a
// test/fault-injection seam and carries no durability guarantees of its own.
type BridgeStoreFileHandle = {
	writeFile(value: Uint8Array): Promise<void>
	sync(): Promise<void>
	close(): Promise<void>
}

type BridgeStoreFileIO = {
	writeTmp?(tmpPath: string, value: Uint8Array): Promise<void>
	publishTmp?(tmpPath: string, finalPath: string): Promise<void>
	syncDir?(dir: string): Promise<void>
	openTmp?(tmpPath: string): Promise<BridgeStoreFileHandle>
}

type BridgeStoreOptions = {
	io?: BridgeStoreFileIO
}

// Thrown by `durableWrite` when the temp file was published (rename
// attempted) but the post-rename barrier did not certify. At that point
// the target may or may not hold the new bytes, so prior durable
// knowledge for the key is invalid. Carries the original failure.
class BarrierUncertainty extends Error {
	readonly detail: unknown
	constructor(detail: unknown) {
		super('use-bridge-store: post-rename barrier uncertified; prior durable knowledge invalidated')
		this.name = 'BarrierUncertainty'
		this.detail = detail
	}
}

const defaultSyncDir = async (dir: string): Promise<void> => {
	let handle: Awaited<ReturnType<typeof open>> | undefined
	try {
		handle = await open(dir, 'r')
	} catch (e) {
		// A store folder that cannot even be opened is not a platform
		// quirk, except where the platform cannot open directory handles
		// at all (classified above).
		if (!isUnsupportedDirSync(e)) throw e
		return
	}
	try {
		await handle.sync()
	} catch (e) {
		if (!isUnsupportedDirSync(e)) throw e
	} finally {
		await handle.close().catch(() => {})
	}
}

// Exclusive temp creation with a restrictive mode for sensitive auth
// bytes. `0o600` regardless of umask: replacement renames this inode over
// the target, so an existing `0600` file can never be widened (a previously
// wider file narrows to `0600`, the safe direction for session secrets;
// POSIX only — Windows ignores mode bits).
const realOpenTmp = async (tmpPath: string): Promise<BridgeStoreFileHandle> => open(tmpPath, 'wx', 0o600)

const defaultWriteTmp = async (
	tmpPath: string,
	value: Uint8Array,
	openTmp: (tmpPath: string) => Promise<BridgeStoreFileHandle>
): Promise<void> => {
	// Exclusive create: never truncate a temp file this operation did
	// not create. Temp names are unique per attempt (see durableWrite),
	// so EEXIST is not expected — but if it ever happens the caller
	// retries with a fresh name instead of touching foreign bytes.
	const handle = await openTmp(tmpPath)
	try {
		await handle.writeFile(value)
		await handle.sync()
		await handle.close()
	} catch (e) {
		// Owned (we just created it exclusively): close best-effort and
		// remove our own temp, never anyone else's. Cleanup failures
		// cannot mask the original error — it always propagates.
		await handle.close().catch(() => {})
		await unlink(tmpPath).catch(() => {})
		throw e
	}
}

const defaultPublishTmp = async (tmpPath: string, finalPath: string): Promise<void> => {
	await rename(tmpPath, finalPath)
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
 *   resolve. The in-memory map only records bytes AFTER the full barrier
 *   (write + fsync + atomic rename + directory sync) succeeds, so an
 *   identical retry following a failure is never skipped and always
 *   re-attempts the write.
 * - If the post-rename barrier fails, the key is marked uncertain: prior
 *   durable knowledge is discarded, reads serve best-available bytes
 *   without re-certifying them, and no identical set is skipped until a
 *   later operation completes the full barrier for that key.
 * - Non-critical stores are debounced (50ms coalescing) and readable
 *   immediately (read-your-write), but such reads are NOT durable until
 *   `flush()` succeeds. A failed flush keeps the pending entry and throws,
 *   so the next `flush()` retries the same bytes.
 * - `flush()` first waits for every operation admitted before it
 *   (barrier), then drains the pending writes those operations produced.
 *   Failures observed by the barrier propagate — a failed admitted write
 *   fails the flush — but only operations outstanding during that flush
 *   are reported, so history never poisons later flushes. A drain pass
 *   with any failure stops at that pass and leaves the failed entries
 *   for the next explicit flush. `flush()` never reports quiescence
 *   while prior admitted work is still running.
 * - All operations on one key (set, delete, flush, concurrent batches) run
 *   through a per-key chain, so a stale failure can never erase newer
 *   state and an in-flight write can never resurrect a deleted key.
 * - A failed delete restores the preceding pending/durable state, so an
 *   acknowledged value stays readable and flushable; only a successful
 *   delete (unlink + directory barrier) clears it. A delete retried while
 *   the key is uncertain re-runs the directory barrier instead of
 *   swallowing the uncertainty as idempotent absence — except that a
 *   directory removed externally surfaces ENOENT rather than success.
 * - Every byte array handed back to callers is a copy.
 *
 * @param folder Directory to store bridge state files
 * @param options Optional per-store file-I/O steps. Test/fault-injection
 *   seam only: the default implementation is the sole provider of the
 *   durability contract above.
 */
export async function useBridgeStore(
	folder: string,
	options?: BridgeStoreOptions
): Promise<NonNullable<AuthenticationState['store']>> {
	await mkdir(folder, { recursive: true })

	const openTmp = options?.io?.openTmp ?? realOpenTmp
	const io = {
		writeTmp: options?.io?.writeTmp ?? ((tmpPath, value) => defaultWriteTmp(tmpPath, value, openTmp)),
		publishTmp: options?.io?.publishTmp ?? defaultPublishTmp,
		syncDir: options?.io?.syncDir ?? defaultSyncDir
	}

	/**
	 * Durable file replacement: write + fsync an exclusively-created temp
	 * file in the same directory, then atomically rename it over the
	 * target and sync the directory. The temp uses a short fixed-shape
	 * basename (independent of key length, so long-but-valid final names
	 * still fit NAME_MAX) created with mode `0600` (POSIX; Windows ignores
	 * mode bits), so replacing a hardened auth file never widens its
	 * permissions. The previous file (or its absence) is untouched until the rename succeeds, so a crash
	 * or a failed write can never leave a torn target behind — readers
	 * always see the old intact file or the new intact file. Cleanup only
	 * ever removes a temp this operation created; a temp that already
	 * existed is left alone.
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
	 * durable. A failure at or after the rename throws BarrierUncertainty
	 * so the caller invalidates prior durable knowledge for the key.
	 */
	const durableWrite = async (finalPath: string, value: Uint8Array): Promise<void> => {
		const MAX_TMP_ATTEMPTS = 5
		for (let attempt = 0; attempt < MAX_TMP_ATTEMPTS; attempt++) {
			// Short fixed-shape basename in the same directory (rename stays
			// atomic): independent of the target key length so keys whose
			// valid final names approach NAME_MAX still fit. Uniqueness from
			// pid + sequence + randomness; the final stored name is untouched.
			const tmpPath = join(
				dirname(finalPath),
				`.bstore-${process.pid.toString(36)}-${(tmpSeq++).toString(36)}-${randomBytes(4).toString('hex')}.tmp`
			)
			try {
				await io.writeTmp(tmpPath, value)
			} catch (e) {
				// EEXIST means a foreign temp owns this name (we create
				// exclusively and never overwrite): retry with a fresh name
				// instead of deleting or reusing it. Any earlier failure
				// left the target untouched; `writeTmp` already cleaned up
				// its own temp.
				if (errnoOf(e) === 'EEXIST') continue
				throw e
			}
			try {
				await io.publishTmp(tmpPath, finalPath)
				await io.syncDir(dirname(finalPath))
			} catch (e) {
				// Our own temp failed to publish or certify: remove only our
				// temp. If the rename itself succeeded, the temp is already
				// gone and this unlink is a tolerated no-op — but the
				// barrier is uncertified either way.
				await unlink(tmpPath).catch(() => {})
				throw new BarrierUncertainty(e)
			}
			return
		}
		throw new Error(`use-bridge-store durableWrite could not claim a unique temp name for ${finalPath}`)
	}

	// Last bytes known to have passed the FULL barrier per key (written,
	// flushed, or read from disk outside uncertainty). Private copies only
	// — never a caller-owned reference. Bounded by LRU eviction; eviction
	// only drops knowledge, disk stays canonical.
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

	// Keys whose last mutation never completed the full barrier (post-rename
	// or post-unlink failure). Durable knowledge is discarded; reads serve
	// best-available bytes without re-certifying them; identical sets are
	// never skipped. Cleared only by a later operation that completes the
	// full barrier for the key (write, flush, or certified delete).
	const uncertain = new Set<string>()

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

	// Full-barrier write shared by critical `set` and the flush drain.
	// Certifies the key on success; on post-rename failure discards durable
	// knowledge, marks uncertainty, and rethrows the original error.
	const certifyWrite = async (cacheKey: string, path: string, value: Uint8Array): Promise<void> => {
		try {
			await durableWrite(path, value)
		} catch (e) {
			if (e instanceof BarrierUncertainty) {
				durable.delete(cacheKey)
				uncertain.add(cacheKey)
				throw e.detail
			}
			throw e
		}
		uncertain.delete(cacheKey)
		rememberDurable(cacheKey, copyBytes(value))
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
			await certifyWrite(cacheKey, pending.path, pending.value)
			if (pendingWrites.get(cacheKey) === pending) pendingWrites.delete(cacheKey)
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
		// Failures observed by the barrier propagate: a failed admitted
		// write fails the flush. Only operations outstanding during this
		// flush are reported — settled history never poisons later flushes.
		// After a drain pass with any failure, stop and leave the failed
		// entries for a subsequent explicit flush: retrying them inside the
		// same call would resolve-or-reject on a stale error while hiding
		// whether the retry itself persisted. A fully successful pass loops,
		// since new work may have landed during the drain. The pass cap only
		// guards a caller emitting writes in a tight loop —
		// `Socket/index.ts.end()` waits on this and must return.
		const errors: unknown[] = []
		for (let i = 0; i < FLUSH_MAX_PASSES; i++) {
			const outstanding = [...admitted]
			if (outstanding.length > 0) {
				const settled = await Promise.allSettled(outstanding)
				for (const result of settled) {
					if (result.status === 'rejected') errors.push(result.reason)
				}
			}
			if (pendingWrites.size === 0) {
				if (admitted.size === 0) break
				continue
			}
			const keys = [...pendingWrites.keys()]
			let failed = false
			await Promise.all(
				keys.map(key =>
					flushOne(key).then(
						() => {},
						e => {
							failed = true
							errors.push(e)
						}
					)
				)
			)
			if (failed) break
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
		// Skip only when the identical bytes are already barrier-certified
		// or already queued. Uncertainty discards certification, so a
		// retry after an uncertified barrier always re-attempts instead of
		// resolving without persisting.
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
			await certifyWrite(cacheKey, filePath(store, key), incoming)
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
	// makes it durable. Under uncertainty, disk bytes are served
	// best-available WITHOUT re-certifying them: caching them as durable
	// would let a later identical set skip its still-required barrier.
	const doGetLocked = async (store: string, key: string, cacheKey: string): Promise<Uint8Array | null> => {
		const pending = pendingWrites.get(cacheKey)
		if (pending) return copyBytes(pending.value)

		const keyUncertain = uncertain.has(cacheKey)
		if (!keyUncertain) {
			const known = durable.get(cacheKey)
			if (known) return copyBytes(known)
		}

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
		if (!keyUncertain) rememberDurable(cacheKey, copyBytes(arr))
		return arr
	}

	const doGet = (store: string, key: string): Promise<Uint8Array | null> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, () => doGetLocked(store, key, cacheKey))
	}

	// Delete path shared by `delete`, `deleteMany` and `deletePrefix`.
	// Runs under the key lock. The preceding pending/durable state is only
	// cleared once the unlink succeeds; if the unlink fails with a real
	// error, that state is restored (timer re-armed) so an acknowledged
	// value stays readable and flushable, and the error propagates. A
	// successful unlink completes the directory barrier; if that barrier
	// fails, the key is marked uncertain. A delete retried while uncertain
	// re-runs the directory barrier instead of mistaking ENOENT for
	// certified absence — but a directory removed externally still surfaces
	// ENOENT rather than success, by explicit policy. Certain absence stays
	// idempotent.
	const doDeleteOne = (store: string, key: string): Promise<void> => {
		const cacheKey = `${store}\0${key}`
		return withKeyLock(cacheKey, async () => {
			const prevPending = pendingWrites.get(cacheKey)
			const prevDurable = durable.get(cacheKey)
			const wasUncertain = uncertain.has(cacheKey)
			if (prevPending?.timer) clearTimeout(prevPending.timer)
			pendingWrites.delete(cacheKey)
			durable.delete(cacheKey)

			// Reinstate the state captured above after any delete failure
			// that leaves the key's fate undecided, so an acknowledged
			// value stays readable and flushable. Not used when absence is
			// certified (the delete won) or when the unlink itself succeeded
			// (the file is genuinely gone; only the barrier is uncertain).
			const restoreDeleteState = () => {
				if (prevDurable) rememberDurable(cacheKey, prevDurable)
				if (prevPending) {
					armTimer(cacheKey, prevPending)
					pendingWrites.set(cacheKey, prevPending)
				}
			}

			try {
				await unlink(filePath(store, key))
			} catch (e) {
				if (isEnoent(e) && !wasUncertain) return
				if (isEnoent(e)) {
					// Absent on disk, but a prior barrier was never
					// certified: certify the absence now instead of
					// swallowing the uncertainty.
					try {
						await io.syncDir(folder)
					} catch (syncError) {
						restoreDeleteState()
						throw syncError
					}
					uncertain.delete(cacheKey)
					return
				}
				restoreDeleteState()
				throw e
			}
			try {
				await io.syncDir(folder)
			} catch (e) {
				uncertain.add(cacheKey)
				throw e
			}
			uncertain.delete(cacheKey)
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
