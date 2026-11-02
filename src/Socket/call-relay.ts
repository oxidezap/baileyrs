import { createRtcRelayTransportProvider } from '@oxidezap/whatsapp-rust-bridge/host'
import type { VoipRelayTransport } from '@oxidezap/whatsapp-rust-bridge/host'
import type { CallRelayConnectionHandle, CallRelayTransportProvider } from './calls-core.ts'

export const makeCallRelayTransport = (createProvider?: () => Promise<CallRelayTransportProvider>) => {
	let selected: CallRelayTransportProvider | undefined
	let fallback: Promise<CallRelayTransportProvider> | undefined
	let disposed = false
	const connections = new Set<() => Promise<void>>()
	const provider = async () => {
		if (selected) return selected
		if (!fallback) {
			fallback = (createProvider ? createProvider() : Promise.resolve(createRtcRelayTransportProvider())).catch(
				error => {
					fallback = undefined
					throw error
				}
			)
		}
		return fallback
	}
	const transport: VoipRelayTransport = {
		async connect(endpoint, events) {
			if (disposed) throw new Error('call relay transport is closed')
			let closed = false
			let connection: CallRelayConnectionHandle | undefined
			let closing: Promise<void> | undefined
			const close = (): Promise<void> => {
				if (closing) return closing
				closed = true
				connections.delete(close)
				const old = connection
				connection = undefined
				closing = Promise.resolve().then(() => old?.close())
				return closing
			}
			connections.add(close)
			const dial = async () => {
				const selectedProvider = await provider()
				if (closed) throw new Error('call relay transport is closed')
				const next = await selectedProvider.createRelayConnection(endpoint, {
					onPacket: data => {
						if (!closed) events.onPacket(data)
					},
					onOpen: () => {
						if (!closed) events.onOpen()
					},
					onClose: reason => {
						if (!closed) events.onClose(reason)
					}
				})
				if (closed) {
					await next.close()
					throw new Error('call relay connection superseded')
				}
				return next
			}
			try {
				connection = await dial()
			} catch (error) {
				await close()
				throw error
			}
			return {
				send(data) {
					if (closed || !connection) return
					const failed = (error: unknown) => {
						if (closed) return
						const stopped = close()
						try {
							events.onClose(error instanceof Error ? error.message : 'relay send failed')
						} finally {
							void stopped.catch(() => undefined)
						}
					}
					try {
						const result = connection.send(data)
						if (result) return Promise.resolve(result).catch(failed)
					} catch (error) {
						failed(error)
					}
				},
				close
			}
		}
	}
	return {
		transport,
		setProvider(next: CallRelayTransportProvider) {
			selected = next
		},
		async closeAll() {
			disposed = true
			await Promise.all([...connections].map(close => close()))
		}
	}
}
