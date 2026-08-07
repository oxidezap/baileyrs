/**
 * The bridge client's lifetime, tested without a bridge.
 *
 * These races used to need a real wasm client to reach, which meant child
 * processes, loopback listeners and a cuttable TCP proxy — and even then some
 * of them could not be forced deterministically. Owning the lifetime behind a
 * small interface makes the same cases plain unit tests: a fake "client" is
 * only ever adopted, disconnected and freed.
 */

import { describe, it } from 'node:test'

import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { type BridgeClientOwner, makeBridgeClientOwner } from '../Socket/bridge-client-owner.ts'
import { expect } from './expect.ts'

const noopLogger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return noopLogger
	}
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface Harness {
	owner: BridgeClientOwner
	/** Ordered log of every lifecycle effect, for asserting sequence not just occurrence. */
	trace: string[]
	client: (name?: string) => WasmWhatsAppClient
	teardownCalls: Array<{ client: WasmWhatsAppClient | undefined; error: Error | undefined }>
}

const makeHarness = (
	overrides: {
		teardown?: (client: WasmWhatsAppClient | undefined, error: Error | undefined) => Promise<void>
		release?: (client: WasmWhatsAppClient) => Promise<void>
	} = {}
): Harness => {
	const trace: string[] = []
	const teardownCalls: Array<{ client: WasmWhatsAppClient | undefined; error: Error | undefined }> = []

	const client = (name = 'client') => ({ name }) as unknown as WasmWhatsAppClient

	const owner = makeBridgeClientOwner({
		logger: noopLogger as never,
		teardown: async (adopted, error) => {
			teardownCalls.push({ client: adopted, error })
			trace.push(adopted ? 'teardown(with-client)' : 'teardown(no-client)')
			if (overrides.teardown) await overrides.teardown(adopted, error)
		},
		release: async adopted => {
			trace.push(`release(${(adopted as unknown as { name: string }).name})`)
			if (overrides.release) await overrides.release(adopted)
		}
	})

	return { owner, trace, client, teardownCalls }
}

describe('bridge client owner: adoption', () => {
	it('publishes the client so the socket can reach it', () => {
		const h = makeHarness()
		const c = h.client()

		expect(h.owner.adopt(c)).toBe(true)
		expect(h.owner.peek()).toBe(c)
	})

	it('refuses and releases a client adopted after close started', async () => {
		// The mid-init teardown window: startup finished building a client that
		// nothing would otherwise own — no owner means nothing frees it and its
		// read loop reconnects forever against a disposed socket.
		const h = makeHarness()
		const closed = h.owner.close(undefined)

		const late = h.client('late')
		expect(h.owner.adopt(late)).toBe(false)
		expect(h.owner.peek()).toBe(undefined)

		await closed
		await wait(10)
		expect(h.trace).toContain('release(late)')
	})

	it('reports isClosing() synchronously, before close() has awaited anything', () => {
		// Startup checks this between awaits; a flag that only flipped a tick
		// later would let it keep issuing calls against a client being released.
		const h = makeHarness()
		expect(h.owner.isClosing()).toBe(false)

		void h.owner.close(undefined)
		expect(h.owner.isClosing()).toBe(true)
	})
})

describe('bridge client owner: close', () => {
	it('tears down with the client still usable, then releases it', async () => {
		// Ordering, not just occurrence: teardown needs the live client to close
		// the transport and drain the store before anything frees it.
		const h = makeHarness()
		const c = h.client()
		h.owner.adopt(c)

		await h.owner.close(undefined)

		expect(h.trace).toEqual(['teardown(with-client)', 'release(client)'])
		expect(h.owner.peek()).toBe(undefined)
	})

	it('still tears down when no client was ever adopted', async () => {
		// A socket disposed mid-init still has a transport to close and a store
		// to drain; skipping that left `ws.readyState` stuck at CONNECTING.
		const h = makeHarness()

		await h.owner.close(undefined)

		expect(h.trace).toEqual(['teardown(no-client)'])
	})

	it('passes the error through to teardown', async () => {
		const h = makeHarness()
		const boom = new Error('terminal')

		await h.owner.close(boom)

		expect(h.teardownCalls[0]?.error).toBe(boom)
	})

	it('runs once, and later callers await that same run', async () => {
		// The socket ends itself on a terminal close, so a consumer's own
		// `await sock.end()` is usually the second call. Resolving it early
		// while the first was still flushing is how `close` → `end()` →
		// `makeWASocket()` ended up with two writers on one auth folder.
		let teardownFinished = false
		const h = makeHarness({
			teardown: async () => {
				await wait(150)
				teardownFinished = true
			}
		})
		h.owner.adopt(h.client())

		void h.owner.close(undefined)
		await h.owner.close(undefined)

		expect(teardownFinished).toBe(true)
		expect(h.teardownCalls.length).toBe(1)
	})

	it('releases the client even when teardown throws', async () => {
		// `teardown` rethrows the first auth-store flush failure. Leaking the
		// wasm client on that path would make a bad shutdown worse.
		const h = makeHarness({
			teardown: async () => {
				throw new Error('flush exploded')
			}
		})
		h.owner.adopt(h.client())

		let thrown: unknown
		await h.owner.close(undefined).catch(err => {
			thrown = err
		})

		expect((thrown as Error | undefined)?.message).toBe('flush exploded')
		expect(h.trace).toContain('release(client)')
	})

	it('does not let a failing release mask the teardown, or throw on its own', async () => {
		const h = makeHarness({
			release: async () => {
				throw new Error('free exploded')
			}
		})
		h.owner.adopt(h.client())

		// Resolving is the assertion: release failures are logged, not surfaced.
		await h.owner.close(undefined)
	})
})

describe('bridge client owner: teardown sees a live client', () => {
	it('keeps peek() published for the whole teardown', async () => {
		// The socket's transport close reads the client back through `peek()` —
		// `ws.close()` is `getClient()?.disconnect()`. Clearing the handle before
		// `teardown` turned that into a silent no-op, which moved the disconnect
		// after the auth-store flush and dropped the closing-session ratchet
		// write it emits. Nothing else in the suite could see that: the owner
		// looked correct in isolation and the damage lived in the wiring.
		const seen: Array<unknown> = []
		const h = makeHarness({
			teardown: async () => {
				seen.push(h.owner.peek())
			}
		})
		const c = h.client()
		h.owner.adopt(c)

		await h.owner.close(undefined)

		expect(seen[0]).toBe(c)
		// …and gone once teardown is done.
		expect(h.owner.peek()).toBe(undefined)
	})

	it('reports isClosing() during teardown, so work can still be gated', () => {
		// `peek()` staying live means it is no longer the "are we shutting down"
		// signal. `isClosing()` is.
		const h = makeHarness()
		h.owner.adopt(h.client())

		void h.owner.close(undefined)

		expect(h.owner.isClosing()).toBe(true)
		expect(h.owner.peek() !== undefined).toBe(true)
	})
})

describe('bridge client owner: settled', () => {
	it('joins the release a refused adopt started', async () => {
		// `adopt` refuses and releases detached so startup can bail on a plain
		// `return`. Startup joins it here, keeping that work inside
		// `initPromise` — otherwise `await using` returns while the discarded
		// client is still disconnecting, possibly writing to a store the caller
		// is about to delete.
		let releaseFinished = false
		const h = makeHarness({
			release: async () => {
				await wait(120)
				releaseFinished = true
			}
		})
		void h.owner.close(undefined)

		expect(h.owner.adopt(h.client('late'))).toBe(false)
		await h.owner.settled()

		expect(releaseFinished).toBe(true)
	})

	it('resolves immediately when nothing is in flight', async () => {
		const h = makeHarness()
		await h.owner.settled()
	})
})

describe('bridge client owner: discard', () => {
	it('releases an adopted client without running teardown', async () => {
		// Startup that failed after adopting: the client exists but its read
		// loop never started, so the socket has nothing to tear down — while
		// the standalone helpers would happily keep reaching the half-built one.
		const h = makeHarness()
		h.owner.adopt(h.client('half-built'))

		await h.owner.discard()

		expect(h.trace).toEqual(['release(half-built)'])
		expect(h.owner.peek()).toBe(undefined)
		expect(h.teardownCalls.length).toBe(0)
	})

	it('joins an in-flight close instead of releasing its client again', async () => {
		// `close()` keeps the client published for the whole of `teardown`, so a
		// discard landing in that window used to take the same handle and
		// release it a second time — two disconnect/free sequences on one wasm
		// client. Reachable for real: a teardown's disconnect can make an
		// in-flight `init()` bridge call reject, and that failure path discards.
		let teardownDone = false
		const h = makeHarness({
			teardown: async () => {
				await wait(120)
				teardownDone = true
			}
		})
		h.owner.adopt(h.client())

		const closing = h.owner.close(undefined)
		await h.owner.discard()

		// Joined the close rather than racing it…
		expect(teardownDone).toBe(true)
		await closing
		// …and the client was released exactly once.
		expect(h.trace).toEqual(['teardown(with-client)', 'release(client)'])
	})

	it('is a no-op when nothing was adopted', async () => {
		const h = makeHarness()

		await h.owner.discard()

		expect(h.trace).toEqual([])
	})
})
