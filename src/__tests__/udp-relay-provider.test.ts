import assert from 'node:assert/strict'
import type { Socket } from 'node:dgram'
import { EventEmitter } from 'node:events'
import { it } from 'node:test'
import { makeUdpRelayProvider } from './e2e/udp-relay-provider.ts'

it('retires a UDP relay creation while bind is pending', async () => {
	class PendingSocket extends EventEmitter {
		bound!: () => void
		bind(_port: number, _address: string, bound: () => void) {
			this.bound = bound
		}
		close() {
			queueMicrotask(() => this.emit('close'))
		}
	}
	const socket = new PendingSocket()
	const provider = makeUdpRelayProvider(() => socket as unknown as Socket)
	const connecting = provider.createRelayConnection(
		{ address: '127.0.0.1', port: 3479, iceUfrag: '', icePwd: '' },
		{ onPacket() {}, onOpen() {}, onClose() {} }
	)
	const rejected = assert.rejects(connecting, /closed/)
	await provider.closeAll()
	await rejected
	socket.bound()
	await assert.rejects(
		provider.createRelayConnection(
			{ address: '127.0.0.1', port: 3479, iceUfrag: '', icePwd: '' },
			{ onPacket() {}, onOpen() {}, onClose() {} }
		),
		/closed/
	)
})
