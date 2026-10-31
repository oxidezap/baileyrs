import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RELAY_DTLS_FINGERPRINT } from '@oxidezap/whatsapp-rust-bridge/host'
import { createNodeCallRelayProvider } from '../Runtime/node-call-relay.ts'
import { nodeRuntime } from '../Runtime/node.ts'
import { makeCallRelayTransport } from '../Socket/call-relay.ts'
import type { CallRelayTransportProvider } from '../Types/Call.ts'

const endpoint = { address: '127.0.0.1', port: 3478, iceUfrag: 'u', icePwd: 'p' }
const events = { onOpen() {}, onPacket() {}, onClose() {} }

describe('default Node call transport', () => {
	it('pins the bridge fingerprint and delegates ICE credentials and binary media unchanged', async () => {
		const packet = new Uint8Array([1, 2, 3])
		let sent: Uint8Array | undefined
		let closes = 0
		const provider = await createNodeCallRelayProvider(async () => ({
			async createRelayConnection(params, callbacks) {
				assert.deepEqual(params, { ...endpoint, fingerprint: RELAY_DTLS_FINGERPRINT })
				assert.equal(callbacks, events)
				return {
					send(data) {
						sent = data
					},
					close() {
						closes++
					}
				}
			}
		}))
		const connection = await provider.createRelayConnection(endpoint, events)
		connection.send(packet)
		await connection.close()
		assert.equal(sent, packet)
		assert.equal(closes, 1)
	})

	it('loads the socket default only on media connect, once across reconnects', async () => {
		let loads = 0
		const provider: CallRelayTransportProvider = {
			async createRelayConnection() {
				return { send() {}, close() {} }
			}
		}
		const relay = makeCallRelayTransport(async () => {
			loads++
			return provider
		})
		assert.equal(loads, 0)
		const connection = await relay.transport.connect(endpoint, events)
		await connection.reconnect(endpoint)
		await connection.close()
		assert.equal(loads, 1)
	})

	it('uses an explicit provider without initializing the default tunnel', async () => {
		const relay = makeCallRelayTransport(async () => {
			throw new Error('unexpected default transport')
		})
		relay.setProvider({
			async createRelayConnection() {
				return { send() {}, close() {} }
			}
		})
		const connection = await relay.transport.connect(endpoint, events)
		await connection.close()
	})

	it('propagates tunnel initialization failure without a cleartext fallback and permits retry', async () => {
		let loads = 0
		const relay = makeCallRelayTransport(async () => {
			loads++
			throw new Error('tunnel unavailable')
		})
		await assert.rejects(relay.transport.connect(endpoint, events), /tunnel unavailable/)
		await assert.rejects(relay.transport.connect(endpoint, events), /tunnel unavailable/)
		assert.equal(loads, 2)
	})

	it('loads the packaged tunnel in Node without RTCPeerConnection or a live network', async () => {
		const provider = await nodeRuntime.createCallRelayProvider!()
		assert.equal(typeof provider.createRelayConnection, 'function')
	})
})
