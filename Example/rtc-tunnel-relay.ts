import { createNodeRelayProvider } from '@oxidezap/rtc-tunnel/node'
import type { RelayConnectionHandle, RelayTransportProvider } from '@oxidezap/rtc-tunnel'
import { RELAY_DTLS_FINGERPRINT } from '@oxidezap/whatsapp-rust-bridge'
import type {
	CallRelayConnectionEvents,
	CallRelayConnectionHandle,
	CallRelayConnectionParams,
	CallRelayTransportProvider
} from '../lib/Socket/calls.js'

export const validateRelayFingerprint = (fingerprint: unknown): string => {
	if (typeof fingerprint !== 'string' || fingerprint.length === 0) {
		throw new Error('bridge did not expose RELAY_DTLS_FINGERPRINT')
	}
	return fingerprint
}

validateRelayFingerprint(RELAY_DTLS_FINGERPRINT)

export interface RelaySelectionArgs {
	socketUrl?: string
	dangerSkipCertVerify?: boolean
}

export const isProductionRelayMode = (args: RelaySelectionArgs): boolean => {
	return !args.socketUrl && !args.dangerSkipCertVerify
}

export interface RtcTunnelRelayProviderOptions {
	tunnelProvider?: RelayTransportProvider
	fingerprint?: string
	liveRelays?: Set<{ close(): unknown }>
}

export const createRtcTunnelRelayProvider = async (
	options: RtcTunnelRelayProviderOptions = {}
): Promise<CallRelayTransportProvider> => {
	const fingerprint = validateRelayFingerprint(options.fingerprint ?? RELAY_DTLS_FINGERPRINT)
	const tunnelProvider = options.tunnelProvider ?? (await createNodeRelayProvider())
	const liveRelays = options.liveRelays

	return {
		async createRelayConnection(
			params: CallRelayConnectionParams,
			events: CallRelayConnectionEvents
		): Promise<CallRelayConnectionHandle> {
			console.log(`relay tunnel (rtc-tunnel) to ${params.address}:${params.port}`)
			let closed = false
			let bridgeHandle: CallRelayConnectionHandle | undefined
			let handle: RelayConnectionHandle | undefined

			const logNonZeroStats = (h: RelayConnectionHandle): void => {
				const stats = h.stats?.()
				if (stats && (stats.droppedDatagrams > 0 || stats.refusedSends > 0 || stats.bufferedBytes > 0)) {
					console.log(
						`relay tunnel closed ${params.address}:${params.port} dropped=${stats.droppedDatagrams} refused=${stats.refusedSends} buffered=${stats.bufferedBytes}`
					)
				}
			}

			const wrappedEvents: CallRelayConnectionEvents = {
				onOpen() {
					events.onOpen()
				},
				onPacket(data) {
					events.onPacket(data)
				},
				onClose(reason) {
					if (!closed) {
						closed = true
						if (bridgeHandle && liveRelays) {
							liveRelays.delete(bridgeHandle)
						}
						if (handle) {
							logNonZeroStats(handle)
						}
					}
					try {
						events.onClose(reason)
					} catch {
						// Bridge client may already be torn down
					}
				}
			}

			const connectionHandle = await tunnelProvider.createRelayConnection(
				{
					...params,
					fingerprint
				},
				wrappedEvents
			)
			handle = connectionHandle

			const stats = handle.stats?.()
			const cipher = stats?.cipherSuite ?? 'unknown'
			console.log(`relay tunnel open ${params.address}:${params.port} cipher=${cipher}`)

			bridgeHandle = {
				send(data: Uint8Array) {
					handle?.send(data)
				},
				close() {
					if (closed) return
					closed = true
					if (bridgeHandle && liveRelays) {
						liveRelays.delete(bridgeHandle)
					}
					if (handle) {
						logNonZeroStats(handle)
						handle.close()
					}
				}
			}

			if (!closed && liveRelays) {
				liveRelays.add(bridgeHandle)
			}

			return bridgeHandle
		}
	}
}

export interface ResolveRelayProviderOptions extends RtcTunnelRelayProviderOptions {
	createUdpProvider?: () => CallRelayTransportProvider | Promise<CallRelayTransportProvider>
}

export const resolveRelayTransportProvider = async (
	args: RelaySelectionArgs,
	options: ResolveRelayProviderOptions = {}
): Promise<CallRelayTransportProvider> => {
	if (isProductionRelayMode(args)) {
		return createRtcTunnelRelayProvider(options)
	}
	if (options.createUdpProvider) {
		return options.createUdpProvider()
	}
	throw new Error('createUdpProvider must be provided for mock/test relay mode')
}
