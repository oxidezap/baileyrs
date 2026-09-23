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
})
