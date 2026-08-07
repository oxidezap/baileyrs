/**
 * `WebSocketClient.close()` is what the socket's teardown uses to drop the
 * transport, and it is a `client.disconnect()` underneath.
 *
 * The early return on an already-closing socket used to be bare, so
 * `void ws.close(); await sock.end()` saw the flag, returned immediately, and
 * let teardown reach `free()` with the original `disconnect()` still in
 * flight — the wasm heap corruption `bridge-free-safety.test.ts` documents.
 * Awaiting a second `disconnect()` does not join the first one.
 */

import { describe, it } from 'node:test'

import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { WebSocketClient } from '../Compatibility/websocket-client.ts'
import type { SocketConfig } from '../Types/index.ts'
import { expect } from './expect.ts'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** A client whose `disconnect()` takes a known, observable amount of time. */
const makeSlowClient = (ms: number) => {
	let calls = 0
	let finished = 0
	const client = {
		isConnected: () => true,
		disconnect: async () => {
			calls++
			await wait(ms)
			finished++
		}
	} as unknown as WasmWhatsAppClient
	return { client, calls: () => calls, finished: () => finished }
}

const makeWs = (client: WasmWhatsAppClient) =>
	new WebSocketClient('wss://127.0.0.1:1/ws', {} as SocketConfig, () => client)

describe('WebSocketClient.close()', () => {
	it('a second caller joins the in-flight close instead of returning early', async () => {
		const slow = makeSlowClient(200)
		const ws = makeWs(slow.client)

		void ws.close()
		await ws.close()

		// Returning early would resolve here with the first disconnect still
		// running, which is what let teardown free a busy client.
		expect(slow.finished()).toBe(1)
		// …and joining, not re-issuing.
		expect(slow.calls()).toBe(1)
	})

	it('disconnects exactly once across concurrent callers', async () => {
		const slow = makeSlowClient(100)
		const ws = makeWs(slow.client)

		await Promise.all([ws.close(), ws.close(), ws.close()])

		expect(slow.calls()).toBe(1)
	})

	it('is a no-op once closed', async () => {
		const slow = makeSlowClient(10)
		const ws = makeWs(slow.client)

		await ws.close()
		await ws.close()

		expect(slow.calls()).toBe(1)
		expect(ws.isClosed).toBe(true)
	})

	it('reports CLOSING while in flight and CLOSED after', async () => {
		const slow = makeSlowClient(120)
		const ws = makeWs(slow.client)

		const closing = ws.close()
		// 2 === CLOSING, 3 === CLOSED on the upstream readyState ladder.
		expect(ws.isClosing).toBe(true)
		await closing
		expect(ws.isClosed).toBe(true)
		expect(ws.isClosing).toBe(false)
	})

	it('is safe against a disconnect that re-enters close()', async () => {
		// The state is stored before `disconnect()` runs, and the work deferred
		// by a microtask so that ordering holds. An inline async body would run
		// eagerly to its first await, invoking `disconnect()` while the state
		// still said `open` — a synchronous callback reaching back into
		// `close()` would then issue a second one on the same wasm handle.
		let calls = 0
		let ws!: WebSocketClient
		let reentered: Promise<void> | undefined
		const client = {
			isConnected: () => true,
			disconnect: async () => {
				calls++
				// Synchronous re-entry, before this body's first await.
				reentered = ws.close()
				await wait(20)
			}
		} as unknown as WasmWhatsAppClient
		ws = makeWs(client)

		await ws.close()
		await reentered

		expect(calls).toBe(1)
	})

	it('settles for later callers even when the disconnect rejects', async () => {
		let calls = 0
		const client = {
			isConnected: () => true,
			disconnect: async () => {
				calls++
				await wait(50)
				throw new Error('disconnect exploded')
			}
		} as unknown as WasmWhatsAppClient
		const ws = makeWs(client)

		const first = ws.close().catch(() => 'rejected')
		const second = ws.close().catch(() => 'rejected')

		expect(await first).toBe('rejected')
		expect(await second).toBe('rejected')
		expect(calls).toBe(1)
		// The socket is still considered closed: teardown must not be able to
		// loop on a transport that refuses to go away.
		expect(ws.isClosed).toBe(true)
	})
})
