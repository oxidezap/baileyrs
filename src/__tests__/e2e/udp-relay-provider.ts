/**
 * Test-only UDP relay pipe for the mock's loopback relay.
 *
 * The bridge implements the core's relay transport over three host callbacks
 * and never touches the wire itself: the core builds every Allocate, keepalive
 * and media datagram from the signaling keys, and the provider only ships the
 * opaque bytes. Against the mock's UDP loopback relay that pipe is a plain
 * datagram socket — no DTLS, no ICE, no STUN knowledge on this side.
 *
 * `onOpen` fires right after bind (UDP needs no handshake), and again
 * guarded on the first inbound datagram, so the core is never left waiting
 * for connectivity either way.
 */

import dgram from 'node:dgram'
import type {
	JsRelayConnectionEvents,
	JsRelayConnectionHandle,
	JsRelayConnectionParams,
	JsRelayProviderCallbacks
} from '@oxidezap/whatsapp-rust-bridge'

export const makeUdpRelayProvider = (
	openSocket = () => dgram.createSocket('udp4')
): JsRelayProviderCallbacks & { closeAll(): Promise<void> } => {
	const live = new Set<dgram.Socket>()
	const pending = new Set<() => void>()
	let disposed = false
	return {
		async createRelayConnection(
			params: JsRelayConnectionParams,
			events: JsRelayConnectionEvents
		): Promise<JsRelayConnectionHandle> {
			if (disposed) throw new Error('UDP relay provider is closed')
			const socket = openSocket()
			live.add(socket)
			let socketClosed = false
			const closeSocket = (): void => {
				if (socketClosed) return
				try {
					socket.close()
					socketClosed = true
				} catch {
					// Already gone: the close event below still reports it.
				}
			}
			try {
				await new Promise<void>((resolve, reject) => {
					const cancel = () => {
						pending.delete(cancel)
						reject(new Error('UDP relay provider is closed'))
						closeSocket()
					}
					const failed = (error: Error) => {
						pending.delete(cancel)
						reject(error)
					}
					pending.add(cancel)
					socket.once('error', failed)
					socket.bind(0, '127.0.0.1', () => {
						socket.off('error', failed)
						pending.delete(cancel)
						if (disposed) {
							closeSocket()
							reject(new Error('UDP relay provider is closed'))
							return
						}
						resolve()
					})
				})
				if (disposed) throw new Error('UDP relay provider is closed')
			} catch (err) {
				live.delete(socket)
				closeSocket()
				throw err
			}
			let finished = false
			let opened = false
			const markOpen = (): void => {
				if (!opened && !disposed && !socketClosed) {
					opened = true
					events.onOpen()
				}
			}
			const finish = (reason?: string): void => {
				if (finished) return
				finished = true
				events.onClose(reason)
			}
			socket.on('message', (message: Buffer) => {
				if (disposed || socketClosed) return
				markOpen()
				events.onPacket(new Uint8Array(message))
			})
			socket.on('error', () => finish('udp socket error'))
			socket.on('close', () => {
				live.delete(socket)
				finish()
			})
			queueMicrotask(markOpen)
			return {
				send: (data: Uint8Array) => {
					socket.send(data, params.port, params.address)
				},
				close: async () => {
					closeSocket()
				}
			}
		},
		// Best-effort teardown for failing tests: the bridge closes handles
		// it still holds, but a test that dies mid-call leaves sockets the
		// bridge never saw closed, and an open datagram socket holds the
		// process open. Call before destroying the clients so no close event
		// lands in a freed bridge.
		async closeAll(): Promise<void> {
			disposed = true
			for (const cancel of pending) cancel()
			const closing = [...live].map(
				socket =>
					new Promise<void>(resolve => {
						const done = (): void => resolve()
						socket.once('close', done)
						try {
							socket.close()
						} catch {
							resolve()
						}
						setTimeout(done, 1000).unref()
					})
			)
			live.clear()
			await Promise.all(closing)
		}
	}
}
