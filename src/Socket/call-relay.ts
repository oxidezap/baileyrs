import { createRtcRelayTransportProvider } from '@oxidezap/whatsapp-rust-bridge/host'
import type { VoipRelayTransport } from '@oxidezap/whatsapp-rust-bridge/host'
import type { CallRelayConnectionHandle, CallRelayTransportProvider } from './calls-core.ts'

/** Keep the socket's existing relay-provider API while voip.wasm owns the media engine. */
export const makeCallRelayTransport = () => {
	let selected: CallRelayTransportProvider | undefined
	let fallback: CallRelayTransportProvider | undefined
	const provider = () => selected ?? (fallback ??= createRtcRelayTransportProvider())
	const transport: VoipRelayTransport = {
		async connect(endpoint, events) {
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
			const dial = (nextEndpoint: typeof endpoint, current: number) =>
				provider().createRelayConnection(nextEndpoint, {
					onPacket: data => {
						if (current === generation) events.onPacket(data)
					},
					onOpen: () => {
						if (current === generation) events.onOpen()
					},
					onClose: reason => {
						if (current === generation) events.onClose(reason)
					}
				})
			connection = await dial(endpoint, generation)
			return {
				send: data => connection?.send(data),
				async reconnect(nextEndpoint) {
					if (closed) return
					const old = connection
					const current = ++generation
					try {
						const next = await dial(nextEndpoint, current)
						if (closed || current !== generation) {
							await retire(next)
							return
						}
						connection = next
					} finally {
						await retire(old)
					}
				},
				async close() {
					closed = true
					generation++
					const old = connection
					connection = undefined
					await retire(old)
				}
			}
		}
	}
	return {
		transport,
		setProvider(next: CallRelayTransportProvider) {
			selected = next
		}
	}
}
