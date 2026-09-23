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
			let connection: CallRelayConnectionHandle | undefined
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
					const old = connection
					const current = ++generation
					try {
						connection = await dial(nextEndpoint, current)
					} finally {
						await old?.close()
					}
				},
				async close() {
					generation++
					const old = connection
					connection = undefined
					await old?.close()
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
