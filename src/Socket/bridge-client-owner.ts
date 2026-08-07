/**
 * Owns the bridge client's lifetime.
 *
 * The socket's startup is async and its teardown can start at any point during
 * it — a `sock.end()` right after `makeWASocket()`, an `await using` scope
 * exiting, or a terminal disconnect the dispatcher reports while `init()` is
 * still building the client. That window used to be managed by hand across
 * six closure variables and a scattering of `if (ended) return` checks, which
 * is where every teardown bug in this file came from: startup dereferencing a
 * handle teardown had already nulled, a client built after teardown with
 * nobody left to free it, and an `end()` that resolved for its second caller
 * while the first was still flushing the auth store.
 *
 * This gathers that into three operations with names:
 *
 *  - `adopt(client)` — startup hands the client over. Returns `false` when
 *    teardown already ran, having freed the client itself, so startup knows to
 *    stop.
 *  - `isClosing()` — the guard startup checks between awaits.
 *  - `close(error)` — runs once, and every later caller awaits that same run
 *    rather than resolving early.
 *
 * Everything the socket owns beyond the client (transport, store flushes, end
 * handlers) goes in the `teardown` hook, which runs exactly once whether or
 * not a client was ever adopted.
 */

import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger.ts'

export interface BridgeClientOwnerOptions {
	logger: ILogger
	/**
	 * The socket's own shutdown work. Receives the adopted client, if there is
	 * one, *before* it is released — so it can still talk to the bridge — and
	 * the error the teardown was started with.
	 *
	 * Runs once. Throwing propagates to `close()`'s callers, but the client is
	 * released either way.
	 */
	teardown: (client: WasmWhatsAppClient | undefined, error: Error | undefined) => Promise<void>
	/**
	 * Release the adopted client. Separate from `teardown` because ordering
	 * matters and the two have different failure semantics: this one is
	 * best-effort and never throws out.
	 */
	release: (client: WasmWhatsAppClient) => Promise<void>
}

export interface BridgeClientOwner {
	/** The adopted client, or undefined before startup finishes / after close. */
	peek: () => WasmWhatsAppClient | undefined
	/**
	 * Publish a freshly built client. Returns `false` when teardown has already
	 * started — the client is released here and the caller must stop; nothing
	 * else will ever own it.
	 */
	adopt: (client: WasmWhatsAppClient) => boolean
	/** True once `close()` has been requested. Startup checks this between awaits. */
	isClosing: () => boolean
	/**
	 * Idempotent teardown. The first call runs it; later callers await that
	 * same run instead of resolving while it is still going.
	 */
	close: (error: Error | undefined) => Promise<void>
	/**
	 * Drop the adopted client without tearing the socket down — for a startup
	 * that failed after adopting, where the client exists but its read loop
	 * never started.
	 */
	discard: () => Promise<void>
	/**
	 * Resolves once every release this owner started has finished, including
	 * the one a refused `adopt()` kicks off. Startup awaits it on the way out
	 * so its own promise does not settle with a release still in flight —
	 * otherwise `await using` could return while the discarded client is still
	 * writing to a store the caller is about to delete.
	 */
	settled: () => Promise<void>
}

export const makeBridgeClientOwner = (opts: BridgeClientOwnerOptions): BridgeClientOwner => {
	const { logger, teardown, release } = opts

	let client: WasmWhatsAppClient | undefined
	let closing = false
	let closePromise: Promise<void> | undefined
	/** Releases started outside `close()`, so `settled()` can join them. */
	const pendingReleases = new Set<Promise<void>>()

	const releaseQuietly = async (target: WasmWhatsAppClient) => {
		try {
			await release(target)
		} catch (err) {
			logger.error({ err }, 'failed to release the bridge client')
		}
	}

	/** `releaseQuietly`, but joinable through `settled()`. */
	const trackRelease = (target: WasmWhatsAppClient) => {
		const running = releaseQuietly(target).finally(() => pendingReleases.delete(running))
		pendingReleases.add(running)
		return running
	}

	const runClose = async (error: Error | undefined) => {
		// Set before the first await so `isClosing()` and `adopt()` see it the
		// moment `close()` is called, not a tick later.
		closing = true
		const adopted = client

		try {
			// `client` stays published for the whole of `teardown`. The socket's
			// transport close reads it back through `peek()` — `ws.close()` is
			// `getClient()?.disconnect()` — and clearing it first silently turned
			// that into a no-op, moving the disconnect after the auth-store
			// flush and dropping the closing-session ratchet write it emits.
			//
			// So teardown sees a live client and `isClosing()`, not `peek()`, is
			// the guard for "should I still be doing work".
			await teardown(adopted, error)
		} finally {
			client = undefined
			if (adopted) await releaseQuietly(adopted)
		}
	}

	return {
		peek: () => client,

		adopt: candidate => {
			if (closing) {
				// Teardown has already been through here and found nothing, so
				// this client would have no owner: nothing would free it and its
				// read loop would reconnect forever against a socket the caller
				// already disposed.
				void trackRelease(candidate)
				return false
			}
			client = candidate
			return true
		},

		isClosing: () => closing,

		close: error => {
			if (closePromise) {
				logger.trace({ trace: error?.stack }, 'already closing; awaiting the in-flight teardown')
				return closePromise
			}
			closePromise = runClose(error)
			return closePromise
		},

		discard: async () => {
			const adopted = client
			client = undefined
			if (adopted) await trackRelease(adopted)
		},

		settled: async () => {
			// A release can outlive the set it started in, so drain rather than
			// awaiting one snapshot.
			while (pendingReleases.size) await Promise.all(pendingReleases)
		}
	}
}
