/**
 * Owns the bridge client's lifetime.
 *
 * The socket's startup is async and its teardown can start at any point during
 * it — a `sock.end()` right after `makeWASocket()`, an `await using` scope
 * exiting, or a terminal disconnect the dispatcher reports while `init()` is
 * still building the client. That window used to be managed by hand across six
 * closure variables and a scattering of `if (ended) return` checks, which is
 * where every teardown bug in this file came from: startup dereferencing a
 * handle teardown had already nulled, a client built after teardown with
 * nobody left to free it, an `end()` that resolved for its second caller while
 * the first was still flushing, and a re-entrant close releasing the same wasm
 * handle twice.
 *
 * All of those are one question — *what phase is this client in?* — so it is
 * one discriminated union rather than a set of booleans that can disagree:
 *
 * ```
 *   starting ──adopt()──► running ──close()──► closing ──► closed
 *      │                     │                    ▲
 *      └──────close()────────┴──discard()─────────┘
 * ```
 *
 * Two rules make the whole thing safe, and both are properties of the union
 * rather than of any individual method:
 *
 *  - **The transition is synchronous and happens first.** `close()` publishes
 *    `closing` — carrying the promise callers await — before any teardown work
 *    starts, so re-entering it finds an in-flight close instead of starting a
 *    second one. That is why the work is deferred by a microtask rather than
 *    started inline: an async body would otherwise run eagerly to its first
 *    `await`, i.e. before the state was stored.
 *  - **`closing` still carries the client.** The socket's transport close
 *    reads it back through `peek()` (`ws.close()` is `getClient()?.disconnect()`),
 *    so dropping the handle at the start of teardown silently turns that into
 *    a no-op and moves the disconnect after the auth-store flush. `isClosing()`
 *    — not `peek()` — is the "should I still be doing work" signal.
 */

import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger.ts'

/**
 * `closing` keeps the client so teardown can still reach the bridge; `closed`
 * has handed it back. Both carry the same promise, so a late caller awaits the
 * real teardown either way.
 */
type OwnerState =
	| { readonly phase: 'starting' }
	| { readonly phase: 'running'; readonly client: WasmWhatsAppClient }
	| { readonly phase: 'closing'; readonly client: WasmWhatsAppClient | undefined; readonly done: Promise<void> }
	| { readonly phase: 'closed'; readonly done: Promise<void> }

export interface BridgeClientOwnerOptions {
	logger: ILogger
	/**
	 * The socket's own shutdown work. Receives the adopted client, if there is
	 * one, while it is still usable, and the error teardown was started with.
	 *
	 * Runs once. Throwing propagates to `close()`'s callers; the client is
	 * released either way.
	 */
	teardown: (client: WasmWhatsAppClient | undefined, error: Error | undefined) => Promise<void>
	/**
	 * Hand the client back to the bridge. Separate from `teardown` because
	 * ordering matters and the two have different failure semantics: this one
	 * is best-effort and never throws out.
	 */
	release: (client: WasmWhatsAppClient) => Promise<void>
}

export interface BridgeClientOwner {
	/** The client while `running` or `closing`; undefined before and after. */
	peek: () => WasmWhatsAppClient | undefined
	/**
	 * Publish a freshly built client. Returns `false` when teardown has already
	 * started — the client is released here and the caller must stop, because
	 * nothing else will ever own it.
	 */
	adopt: (client: WasmWhatsAppClient) => boolean
	/** True from the moment `close()` is called. Startup checks it between awaits. */
	isClosing: () => boolean
	/** Runs teardown once; later callers await that same run. */
	close: (error: Error | undefined) => Promise<void>
	/**
	 * Drop the client without tearing the socket down — for a startup that
	 * failed after adopting, where the client exists but its read loop never
	 * started. Joins an in-flight close rather than releasing a client that
	 * close already owns.
	 */
	discard: () => Promise<void>
	/**
	 * Resolves once every release this owner started has finished, including
	 * the one a refused `adopt()` kicks off. Startup awaits it on the way out
	 * so its own promise does not settle with a release still in flight.
	 */
	settled: () => Promise<void>
}

export const makeBridgeClientOwner = (opts: BridgeClientOwnerOptions): BridgeClientOwner => {
	const { logger, teardown, release } = opts

	let state: OwnerState = { phase: 'starting' }
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

	const runClose = async (client: WasmWhatsAppClient | undefined, error: Error | undefined, done: Promise<void>) => {
		try {
			await teardown(client, error)
		} finally {
			state = { phase: 'closed', done }
			if (client) await releaseQuietly(client)
		}
	}

	return {
		peek: () => (state.phase === 'running' || state.phase === 'closing' ? state.client : undefined),

		adopt: candidate => {
			if (state.phase !== 'starting') {
				// Teardown has already been through here and found nothing, so
				// this client would have no owner: nothing would free it and its
				// read loop would reconnect forever against a disposed socket.
				void trackRelease(candidate)
				return false
			}
			state = { phase: 'running', client: candidate }
			return true
		},

		isClosing: () => state.phase === 'closing' || state.phase === 'closed',

		close: error => {
			if (state.phase === 'closing' || state.phase === 'closed') {
				logger.trace({ trace: error?.stack }, 'already closing; awaiting the in-flight teardown')
				return state.done
			}

			const client = state.phase === 'running' ? state.client : undefined
			// Deferred by a microtask so the `closing` state below is stored
			// before any teardown work runs. Calling `runClose` inline would
			// execute its body eagerly up to the first `await` — teardown starts
			// by closing the transport — and anything reached synchronously that
			// calls back into `close()` would find no in-flight close and start
			// a second teardown, releasing the same wasm handle twice.
			const done: Promise<void> = Promise.resolve().then(() => runClose(client, error, done))
			state = { phase: 'closing', client, done }
			return done
		},

		discard: async () => {
			// `close()` owns the client from the moment it starts, and keeps it
			// published for the whole of teardown — releasing it here as well
			// would be two disconnect/free sequences on one handle. Join instead.
			//
			// Joining without adopting the failure: `close()` rejects when
			// teardown rethrows the first auth-store flush error, and this is
			// best-effort cleanup called from `init()`'s catch. Propagating it
			// would make `initPromise` reject — which the socket documents as
			// impossible, relies on for `getClient()`'s error message, and does
			// not always await, so it could surface as an unhandled rejection.
			if (state.phase === 'closing' || state.phase === 'closed') {
				await state.done.catch(() => {})
				return
			}
			if (state.phase !== 'running') return

			const { client } = state
			// Back to `starting`, not `closed`: a later `close()` must still run
			// teardown for everything the socket owns beyond the client.
			state = { phase: 'starting' }
			await trackRelease(client)
		},

		settled: async () => {
			// A release can outlive the set it started in, so drain rather than
			// awaiting one snapshot.
			while (pendingReleases.size) await Promise.all(pendingReleases)
		}
	}
}
