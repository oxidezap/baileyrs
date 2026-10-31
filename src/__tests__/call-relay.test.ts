import { describe, it } from 'node:test'
import { makeCallRelayTransport } from '../Socket/call-relay.ts'
import type { CallRelayConnectionEvents } from '../Socket/calls-core.ts'
import { expect } from './expect.ts'

const endpoint = (port: number) => ({ address: '127.0.0.1', port, iceUfrag: 'u', icePwd: 'p' })

describe('VoIP relay transport adapter', () => {
	it('routes the selected provider and isolates callbacks across reconnect', async () => {
		const events: Array<{ port: number; callbacks: CallRelayConnectionEvents; sent: Uint8Array[]; closes: number }> = []
		const relay = makeCallRelayTransport()
		relay.setProvider({
			async createRelayConnection(params, callbacks) {
				const record = { port: params.port, callbacks, sent: [] as Uint8Array[], closes: 0 }
				events.push(record)
				return {
					send: data => {
						record.sent.push(data)
					},
					close: () => {
						record.closes++
					}
				}
			}
		})
		const received: number[] = []
		const closed: string[] = []
		const connection = await relay.transport.connect(endpoint(1), {
			onPacket: data => received.push(data[0]!),
			onOpen: () => {},
			onClose: reason => closed.push(reason ?? '')
		})
		connection.send(new Uint8Array([4]))
		events[0]!.callbacks.onPacket(new Uint8Array([5]))
		await connection.reconnect(endpoint(2))
		events[0]!.callbacks.onClose('retired')
		events[0]!.callbacks.onPacket(new Uint8Array([6]))
		events[1]!.callbacks.onPacket(new Uint8Array([7]))
		connection.send(new Uint8Array([8]))
		expect(events.map(e => e.port)).toEqual([1, 2])
		expect(events[0]!.sent[0]).toEqual(new Uint8Array([4]))
		expect(events[1]!.sent[0]).toEqual(new Uint8Array([8]))
		expect(events[0]!.closes).toBe(1)
		expect(received).toEqual([5, 7])
		expect(closed).toEqual([])
		await connection.close()
		events[1]!.callbacks.onClose('retired')
		expect(events[1]!.closes).toBe(1)
		expect(closed).toEqual([])
	})

	it('closes a reconnect result that arrives after teardown without retaining it', async () => {
		let resolveReconnect!: (handle: { send(data: Uint8Array): void; close(): void }) => void
		let started!: () => void
		const reconnectStarted = new Promise<void>(resolve => {
			started = resolve
		})
		let closes = 0
		let lateCloses = 0
		const sent: number[] = []
		const relay = makeCallRelayTransport()
		relay.setProvider({
			createRelayConnection: async params =>
				params.port === 1
					? {
							send: () => undefined,
							close: () => {
								closes++
							}
						}
					: new Promise(resolve => {
							resolveReconnect = resolve
							started()
						})
		})
		const connection = await relay.transport.connect(endpoint(1), {
			onPacket: () => undefined,
			onOpen: () => undefined,
			onClose: () => undefined
		})
		const reconnecting = connection.reconnect(endpoint(2))
		await reconnectStarted
		await connection.close()
		resolveReconnect({
			send: data => sent.push(data[0]!),
			close: () => {
				lateCloses++
			}
		})
		await reconnecting
		connection.send(new Uint8Array([7]))
		expect(sent).toEqual([])
		expect(closes).toBe(1)
		expect(lateCloses).toBe(1)
	})
})

describe('relay teardown and write failures', () => {
	it('retires an initial connection resolving after socket teardown', async () => {
		let resolve!: (handle: { send(): void; close(): void }) => void
		let started!: () => void
		const starting = new Promise<void>(done => {
			started = done
		})
		let closes = 0
		let packets = 0
		const relay = makeCallRelayTransport()
		relay.setProvider({
			createRelayConnection: async (_endpoint, events) => {
				started()
				const handle = await new Promise<{ send(): void; close(): void }>(done => {
					resolve = done
				})
				events.onPacket(new Uint8Array([1]))
				return handle
			}
		})
		const connecting = relay.transport.connect(endpoint(1), {
			onOpen() {},
			onClose() {},
			onPacket() {
				packets++
			}
		})
		await starting
		await relay.closeAll()
		resolve({
			send() {},
			close() {
				closes++
			}
		})
		await import('node:assert/strict').then(({ default: assert }) => assert.rejects(connecting, /superseded/))
		expect(closes).toBe(1)
		expect(packets).toBe(0)
	})
	it('reports async send rejection and releases the failed connection exactly once', async () => {
		let closes = 0
		const reasons: Array<string | undefined> = []
		const relay = makeCallRelayTransport()
		relay.setProvider({
			async createRelayConnection() {
				return {
					async send() {
						throw new Error('write rejected')
					},
					close() {
						closes++
					}
				}
			}
		})
		const connection = await relay.transport.connect(endpoint(1), {
			onPacket() {},
			onOpen() {},
			onClose(reason) {
				reasons.push(reason)
			}
		})
		await connection.send(new Uint8Array([1]))
		await connection.close()
		await relay.closeAll()
		expect(reasons).toEqual(['write rejected'])
		expect(closes).toBe(1)
	})
})
