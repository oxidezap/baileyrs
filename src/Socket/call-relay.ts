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
			let generation = 0
			let closed = false
			let connection: CallRelayConnectionHandle | undefined
			const retired = new WeakMap<CallRelayConnectionHandle, Promise<void>>()
			const retire = (handle: CallRelayConnectionHandle | undefined): Promise<void> => {
				if (!handle) return Promise.resolve()
				const inFlight = retired.get(handle)
				if (inFlight) return inFlight
				const closing = Promise.resolve().then(() => handle.close())
				retired.set(handle, closing)
				return closing
			}
			const close = async () => {
				closed = true
				generation++
				connections.delete(close)
				const old = connection
				connection = undefined
				await retire(old)
			}
			connections.add(close)
			const dial = async (nextEndpoint: typeof endpoint, current: number) => {
				const selectedProvider = await provider()
				if (closed) throw new Error('call relay transport is closed')
				const next = await selectedProvider.createRelayConnection(nextEndpoint, {
					onPacket: data => {
						if (!closed && current === generation) events.onPacket(data)
					},
					onOpen: () => {
						if (!closed && current === generation) events.onOpen()
					},
					onClose: reason => {
						if (!closed && current === generation) events.onClose(reason)
					}
				})
				if (closed || current !== generation) {
					await retire(next)
					throw new Error('call relay connection superseded')
				}
				return next
			}
			try {
				connection = await dial(endpoint, generation)
			} catch (error) {
				await close()
				throw error
			}
			return {
				send(data) {
					if (closed || !connection) return
					const current = generation
					const failed = (error: unknown) => {
						if (closed || current !== generation) return
						const closing = close()
						try {
							events.onClose(error instanceof Error ? error.message : 'relay send failed')
						} finally {
							void closing.catch(() => undefined)
						}
					}
					try {
						const result = connection.send(data)
						if (result) return Promise.resolve(result).catch(failed)
					} catch (error) {
						failed(error)
					}
				},
				async reconnect(nextEndpoint) {
					if (closed) return
					const old = connection
					const current = ++generation
					try {
						connection = await dial(nextEndpoint, current)
					} catch (error) {
						if (!closed && current === generation) throw error
					} finally {
						if (connection === old) connection = undefined
						await retire(old)
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
