import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { SocketConfig } from '../../Types/index.ts'
import { WebSocketClient } from '../websocket-client.ts'

describe('native WebSocket compatibility facade', () => {
	it('exposes connection state, raw subscriptions and transport methods', async () => {
		let connected = false
		const rawForwardingCalls: boolean[] = []
		const sent: Uint8Array[] = []
		const client: Partial<WasmWhatsAppClient> = {
			isConnected: () => connected,
			connect: async () => {
				connected = true
			},
			disconnect: async () => {
				connected = false
			},
			setRawNodeForwarding: enabled => {
				rawForwardingCalls.push(enabled)
			},
			sendRawMessage: async bytes => {
				sent.push(bytes)
			}
		}
		const ws = new WebSocketClient(
			'wss://web.whatsapp.com/ws/chat',
			{} as SocketConfig,
			() => client as WasmWhatsAppClient
		)

		assert.equal(ws.isConnecting, true)
		const socket = (ws as unknown as { socket: { readyState: number } }).socket
		assert.equal(socket.readyState, 0)
		const firstCallback = () => undefined
		const secondCallback = () => undefined
		const tagCallback = () => undefined
		assert.equal(ws.on('CB:test', firstCallback), ws)
		ws.on('CB:other', secondCallback)
		ws.on('TAG:message-id', tagCallback)
		assert.deepEqual(rawForwardingCalls, [true])
		ws.off('CB:test', firstCallback)
		ws.removeListener('CB:other', secondCallback)
		assert.deepEqual(rawForwardingCalls, [true])
		ws.off('TAG:message-id', tagCallback)
		assert.deepEqual(rawForwardingCalls, [true, false])

		ws.connect()
		await Promise.resolve()
		assert.equal(ws.isOpen, true)
		assert.equal(socket.readyState, 1)

		await new Promise<void>((resolve, reject) => {
			assert.equal(
				ws.send('abc', error => (error ? reject(error) : resolve())),
				true
			)
		})
		assert.deepEqual(sent, [new TextEncoder().encode('abc')])

		await ws.close()
		assert.equal(ws.isClosed, true)
		assert.equal(ws.isConnecting, false)
		assert.equal(socket.readyState, 3)
	})

	it('tracks every EventEmitter subscription API without duplicate toggles', () => {
		const rawForwardingCalls: boolean[] = []
		const client = {
			setRawNodeForwarding: (enabled: boolean) => rawForwardingCalls.push(enabled)
		} as Partial<WasmWhatsAppClient>
		const ws = new WebSocketClient(
			'wss://web.whatsapp.com/ws/chat',
			{} as SocketConfig,
			() => client as WasmWhatsAppClient
		)
		const listener = () => undefined

		ws.once('CB:once', listener)
		assert.deepEqual(rawForwardingCalls, [true])
		ws.emit('CB:once')
		assert.deepEqual(rawForwardingCalls, [true, false])

		ws.prependOnceListener('TAG:once', listener)
		ws.emit('TAG:once')
		assert.deepEqual(rawForwardingCalls, [true, false, true, false])

		ws.addListener('CB:add', listener)
		ws.prependListener('TAG:prepend', listener)
		assert.deepEqual(rawForwardingCalls, [true, false, true, false, true])
		ws.removeAllListeners('CB:add')
		assert.deepEqual(rawForwardingCalls, [true, false, true, false, true])
		ws.removeAllListeners()
		assert.deepEqual(rawForwardingCalls, [true, false, true, false, true, false])
	})

	it('returns false when the native client is not ready', () => {
		const ws = new WebSocketClient('wss://web.whatsapp.com/ws/chat', {} as SocketConfig, () => undefined)
		assert.equal(ws.send(Uint8Array.of(1)), false)
	})
})
