import { RELAY_DTLS_FINGERPRINT } from '@oxidezap/whatsapp-rust-bridge/host'
import type { RelayTransportProvider } from '@oxidezap/rtc-tunnel'
import type { CallRelayTransportProvider } from '../Types/Call.ts'

export const createNodeCallRelayProvider = async (
	load = async (): Promise<RelayTransportProvider> =>
		(await import('@oxidezap/rtc-tunnel/node')).createNodeRelayProvider()
): Promise<CallRelayTransportProvider> => {
	const provider = await load()
	return {
		createRelayConnection: (params, events) =>
			provider.createRelayConnection({ ...params, fingerprint: RELAY_DTLS_FINGERPRINT }, events)
	}
}
