/**
 * Every outgoing frame goes through `asWebSocketPayload` on its way to
 * `WebSocket.send()`, whose `BufferSource` parameter is `ArrayBufferView<ArrayBuffer>
 * | ArrayBuffer` — it does not accept a view over a `SharedArrayBuffer`. The
 * bridge types both `send` and `sendBorrowed` as the wider `Uint8Array`, i.e.
 * `Uint8Array<ArrayBufferLike>`, so the transport has to discriminate the backing
 * buffer at runtime.
 *
 * That check used to rebuild the view in the `ArrayBuffer` case — same buffer,
 * same offset, same length — which is an allocation per frame that changes
 * nothing about the bytes or their lifetime. These tests pin down the two halves
 * of the replacement: the `ArrayBuffer` case forwards the caller's own view, and
 * the `SharedArrayBuffer` case still copies.
 *
 * The last test uses a real `WebAssembly.Memory` because that is where
 * `sendBorrowed`'s view actually comes from — the bridge's glue hands out a
 * `subarray()` of its cached `Uint8Array` over `wasm.memory.buffer`, and growing
 * that memory detaches the buffer under every view of it.
 */

import { beforeEach, describe, it } from 'node:test'

import { makeTransport } from '../Socket/transport.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
} as unknown as ILogger

/**
 * Stands in for undici's `WebSocket`. `send()` snapshots its argument the way
 * `WebsocketFrameSend.createFrame` does — `Buffer.allocUnsafe` plus an XOR mask
 * into fresh memory — so a test can look at what was handed over *and* at what
 * was actually put on the wire, and tell the two apart.
 */
class FakeWebSocket {
	static readonly OPEN = 1

	readonly url: string
	readyState = FakeWebSocket.OPEN
	binaryType = 'blob'
	readonly handed: ArrayBufferView[] = []
	readonly framed: Uint8Array[] = []

	private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

	constructor(url: string) {
		this.url = url
		// The transport only settles `connect()` once `open` fires, and it
		// subscribes after the constructor returns.
		queueMicrotask(() => this.dispatch('open'))
	}

	addEventListener(type: string, listener: (event: never) => void) {
		const set = this.listeners.get(type) ?? new Set()
		set.add(listener as (event: unknown) => void)
		this.listeners.set(type, set)
	}

	send(data: ArrayBufferView) {
		this.handed.push(data)
		this.framed.push(Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)))
	}

	close() {
		this.readyState = 3
		this.dispatch('close')
	}

	private dispatch(type: string) {
		for (const listener of this.listeners.get(type) ?? []) listener({})
	}
}

const connect = async () => {
	const transport = makeTransport({ waWebSocketUrl: 'ws://127.0.0.1:1/ws', logger: silentLogger })
	await transport.connect({ onConnected: () => {}, onData: () => {}, onDisconnected: () => {} })
	return transport
}

/** The most recent socket the transport constructed. */
let sockets: FakeWebSocket[] = []
const lastSocket = () => sockets[sockets.length - 1]!

describe('transport: outgoing frame payloads', () => {
	beforeEach(() => {
		sockets = []
		class Tracked extends FakeWebSocket {
			constructor(url: string) {
				super(url)
				sockets.push(this)
			}
		}
		globalThis.WebSocket = Tracked as unknown as typeof WebSocket
	})

	it('hands an ArrayBuffer-backed frame straight to the socket', async () => {
		const transport = await connect()
		const frame = new Uint8Array([1, 2, 3, 4])

		transport.send(frame)

		// Identity, not just equality: a rebuilt view would be a second object
		// over the same bytes, which is the allocation this asserts is gone.
		expect(lastSocket().handed[0]).toBe(frame)
	})

	it('hands a borrowed ArrayBuffer-backed frame straight to the socket', async () => {
		const transport = await connect()
		const frame = new Uint8Array([9, 8, 7])

		transport.sendBorrowed?.(frame)

		expect(lastSocket().handed[0]).toBe(frame)
	})

	it('keeps the exact window of a sub-view', async () => {
		const transport = await connect()
		const backing = new Uint8Array(32)
		backing.set([10, 20, 30, 40], 8)
		const frame = backing.subarray(8, 12)

		transport.send(frame)

		const handed = lastSocket().handed[0]!
		// The old rebuild preserved buffer/offset/length; so must the passthrough.
		expect(handed.buffer).toBe(backing.buffer)
		expect(handed.byteOffset).toBe(8)
		expect(handed.byteLength).toBe(4)
		expect([...lastSocket().framed[0]!]).toEqual([10, 20, 30, 40])
	})

	it('copies a SharedArrayBuffer-backed frame, which the send API cannot take', async () => {
		const transport = await connect()
		const shared = new SharedArrayBuffer(4)
		const frame = new Uint8Array(shared)
		frame.set([5, 6, 7, 8])

		transport.send(frame)

		const handed = lastSocket().handed[0]!
		expect(handed).not.toBe(frame)
		expect(handed.buffer).toBeInstanceOf(ArrayBuffer)
		expect(handed.buffer).not.toBe(shared)
		expect([...new Uint8Array(handed.buffer, handed.byteOffset, handed.byteLength)]).toEqual([5, 6, 7, 8])
		// The source is untouched — the copy is a copy, not a move.
		expect([...frame]).toEqual([5, 6, 7, 8])
	})

	it('copies a borrowed SharedArrayBuffer-backed frame too', async () => {
		const transport = await connect()
		const frame = new Uint8Array(new SharedArrayBuffer(2))
		frame.set([1, 2])

		transport.sendBorrowed?.(frame)

		const handed = lastSocket().handed[0]!
		expect(handed).not.toBe(frame)
		expect(handed.buffer).toBeInstanceOf(ArrayBuffer)
	})

	it('is consumed before WASM memory growth can invalidate the borrowed view', async () => {
		const transport = await connect()
		const memory = new WebAssembly.Memory({ initial: 1 })
		// How the bridge's glue produces the borrowed view: a subarray of a
		// Uint8Array over the wasm memory buffer, at some offset into it.
		const frame = new Uint8Array(memory.buffer).subarray(64, 68)
		frame.set([1, 2, 3, 4])
		expect(memory.buffer).toBeInstanceOf(ArrayBuffer)

		transport.sendBorrowed?.(frame)

		// Growing detaches `memory.buffer`, and with it every view over it —
		// including the one the transport forwarded. This is exactly as true of
		// the view the old code rebuilt: both alias the same linear memory, so
		// passing the caller's view through does not extend anything's lifetime.
		memory.grow(1)
		expect(frame.byteLength).toBe(0)
		expect(lastSocket().handed[0]!.byteLength).toBe(0)
		// The frame still went out intact, because the socket took its own copy
		// inside the synchronous `send()` — which is what the bridge's borrow
		// contract requires of this transport.
		expect([...lastSocket().framed[0]!]).toEqual([1, 2, 3, 4])
	})
})
