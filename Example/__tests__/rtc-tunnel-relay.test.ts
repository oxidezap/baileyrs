import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RelayConnectionEvents, RelayConnectionParams, RelayTransportProvider } from '@oxidezap/rtc-tunnel'
import { RELAY_DTLS_FINGERPRINT } from '@oxidezap/whatsapp-rust-bridge'
import { expect } from '../../src/__tests__/expect.ts'
import type {
	CallRelayConnectionEvents,
	CallRelayConnectionParams,
	CallRelayTransportProvider
} from '../../lib/Socket/calls.js'
import {
	createRtcTunnelRelayProvider,
	isProductionRelayMode,
	resolveRelayTransportProvider,
	validateRelayFingerprint
} from '../rtc-tunnel-relay.ts'

describe('rtc-tunnel relay provider', () => {
	it('validates RELAY_DTLS_FINGERPRINT from bridge', () => {
		expect(typeof RELAY_DTLS_FINGERPRINT).toBe('string')
		expect(RELAY_DTLS_FINGERPRINT.length > 0).toBe(true)
		expect(validateRelayFingerprint(RELAY_DTLS_FINGERPRINT)).toBe(RELAY_DTLS_FINGERPRINT)

		assert.throws(() => validateRelayFingerprint(''), /bridge did not expose RELAY_DTLS_FINGERPRINT/)
		assert.throws(() => validateRelayFingerprint(undefined), /bridge did not expose RELAY_DTLS_FINGERPRINT/)
		assert.throws(() => validateRelayFingerprint(123), /bridge did not expose RELAY_DTLS_FINGERPRINT/)
	})

	it('1. mock relay still uses cleartext UDP', async () => {
		let udpCreated = false
		const mockUdpProvider: CallRelayTransportProvider = {
			createRelayConnection: async () => ({
				send: () => {},
				close: () => {}
			})
		}

		// With socketUrl set: mock mode
		const providerWithSocket = await resolveRelayTransportProvider(
			{ socketUrl: 'wss://127.0.0.1:8080' },
			{
				createUdpProvider: () => {
					udpCreated = true
					return mockUdpProvider
				}
			}
		)
		expect(udpCreated).toBe(true)
		expect(providerWithSocket).toBe(mockUdpProvider)

		// With dangerSkipCertVerify set: mock mode
		udpCreated = false
		const providerWithSkipCert = await resolveRelayTransportProvider(
			{ dangerSkipCertVerify: true },
			{
				createUdpProvider: () => {
					udpCreated = true
					return mockUdpProvider
				}
			}
		)
		expect(udpCreated).toBe(true)
		expect(providerWithSkipCert).toBe(mockUdpProvider)
	})

	it('2. production mode selects rtc-tunnel', async () => {
		let udpCalled = false
		let rtcTunnelCreated = false

		const mockTunnelProvider: RelayTransportProvider = {
			createRelayConnection: async () => {
				rtcTunnelCreated = true
				return {
					send: () => {},
					close: () => {},
					stats: () => ({
						bufferedBytes: 0,
						droppedDatagrams: 0,
						refusedSends: 0,
						cipherSuite: 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256'
					})
				}
			}
		}

		expect(isProductionRelayMode({})).toBe(true)
		expect(isProductionRelayMode({ socketUrl: undefined, dangerSkipCertVerify: false })).toBe(true)

		const provider = await resolveRelayTransportProvider(
			{},
			{
				tunnelProvider: mockTunnelProvider,
				createUdpProvider: () => {
					udpCalled = true
					throw new Error('UDP provider should not be called in production mode')
				}
			}
		)

		expect(udpCalled).toBe(false)
		const handle = await provider.createRelayConnection(
			{ address: '127.0.0.1', port: 3478, iceUfrag: 'ufrag', icePwd: 'pwd' },
			{ onOpen: () => {}, onPacket: () => {}, onClose: () => {} }
		)
		expect(rtcTunnelCreated).toBe(true)
		handle.close()
	})

	it('3. bridge relay parameters are forwarded unchanged', async () => {
		let receivedParams: RelayConnectionParams | undefined

		const mockTunnelProvider: RelayTransportProvider = {
			createRelayConnection: async params => {
				receivedParams = params
				return {
					send: () => {},
					close: () => {}
				}
			}
		}

		const provider = await createRtcTunnelRelayProvider({ tunnelProvider: mockTunnelProvider })
		const bridgeParams: CallRelayConnectionParams = {
			address: '192.168.1.100',
			port: 54321,
			iceUfrag: 'test-ufrag-123',
			icePwd: 'test-ice-pwd-xyz'
		}

		await provider.createRelayConnection(bridgeParams, {
			onOpen: () => {},
			onPacket: () => {},
			onClose: () => {}
		})

		assert.ok(receivedParams)
		expect(receivedParams.address).toBe(bridgeParams.address)
		expect(receivedParams.port).toBe(bridgeParams.port)
		expect(receivedParams.iceUfrag).toBe(bridgeParams.iceUfrag)
		expect(receivedParams.icePwd).toBe(bridgeParams.icePwd)
	})

	it('4. RELAY_DTLS_FINGERPRINT is injected into rtc-tunnel params', async () => {
		let injectedFingerprint: string | undefined

		const mockTunnelProvider: RelayTransportProvider = {
			createRelayConnection: async params => {
				injectedFingerprint = params.fingerprint
				return {
					send: () => {},
					close: () => {}
				}
			}
		}

		const provider = await createRtcTunnelRelayProvider({ tunnelProvider: mockTunnelProvider })
		await provider.createRelayConnection(
			{ address: '1.2.3.4', port: 1234, iceUfrag: 'u', icePwd: 'p' },
			{ onOpen: () => {}, onPacket: () => {}, onClose: () => {} }
		)

		expect(injectedFingerprint).toBe(RELAY_DTLS_FINGERPRINT)
	})

	it('5. onOpen, onPacket, and onClose are forwarded correctly', async () => {
		let openFired = false
		let receivedPacket: Uint8Array | undefined
		let closeReason: string | undefined

		let tunnelEvents: RelayConnectionEvents | undefined
		const mockTunnelProvider: RelayTransportProvider = {
			createRelayConnection: async (_params, events) => {
				tunnelEvents = events
				events.onOpen()
				return {
					send: () => {},
					close: () => {}
				}
			}
		}

		const provider = await createRtcTunnelRelayProvider({ tunnelProvider: mockTunnelProvider })
		const clientEvents: CallRelayConnectionEvents = {
			onOpen: () => {
				openFired = true
			},
			onPacket: data => {
				receivedPacket = data
			},
			onClose: reason => {
				closeReason = reason
			}
		}

		await provider.createRelayConnection({ address: '1.2.3.4', port: 1234, iceUfrag: 'u', icePwd: 'p' }, clientEvents)

		expect(openFired).toBe(true)

		const packetData = new Uint8Array([1, 2, 3, 4, 5])
		tunnelEvents?.onPacket(packetData)
		expect(receivedPacket).toBe(packetData)

		tunnelEvents?.onClose('network failure')
		expect(closeReason).toBe('network failure')
	})

	it('6. closing the bridge handle closes the rtc-tunnel handle and updates liveRelays', async () => {
		let rtcClosed = false
		const liveRelays = new Set<{ close(): unknown }>()

		const mockTunnelProvider: RelayTransportProvider = {
			createRelayConnection: async () => ({
				send: () => {},
				close: () => {
					rtcClosed = true
				},
				stats: () => ({
					bufferedBytes: 100,
					droppedDatagrams: 2,
					refusedSends: 1,
					cipherSuite: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256'
				})
			})
		}

		const provider = await createRtcTunnelRelayProvider({
			tunnelProvider: mockTunnelProvider,
			liveRelays
		})

		const handle = await provider.createRelayConnection(
			{ address: '1.2.3.4', port: 1234, iceUfrag: 'u', icePwd: 'p' },
			{ onOpen: () => {}, onPacket: () => {}, onClose: () => {} }
		)

		expect(liveRelays.size).toBe(1)
		expect(liveRelays.has(handle)).toBe(true)

		handle.close()
		expect(rtcClosed).toBe(true)
		expect(liveRelays.size).toBe(0)

		// Idempotent close
		handle.close()
		expect(liveRelays.size).toBe(0)
	})

	it('7. initialization failure does not silently fall back to raw UDP', async () => {
		let udpCalled = false
		const failingTunnelProvider: RelayTransportProvider = {
			createRelayConnection: async () => {
				throw new Error('rtc-tunnel initialization failed')
			}
		}

		const provider = await resolveRelayTransportProvider(
			{},
			{
				tunnelProvider: failingTunnelProvider,
				createUdpProvider: () => {
					udpCalled = true
					return {
						createRelayConnection: async () => ({
							send: () => {},
							close: () => {}
						})
					}
				}
			}
		)

		expect(udpCalled).toBe(false)
		await assert.rejects(async () => {
			await provider.createRelayConnection(
				{ address: '1.2.3.4', port: 1234, iceUfrag: 'u', icePwd: 'p' },
				{ onOpen: () => {}, onPacket: () => {}, onClose: () => {} }
			)
		}, /rtc-tunnel initialization failed/)

		expect(udpCalled).toBe(false)
	})

	it('does not retain a relay that closes before initialization returns', async () => {
		const liveRelays = new Set<{ close(): unknown }>()
		let closeReason: string | undefined
		const tunnelProvider: RelayTransportProvider = {
			createRelayConnection: async (_params, events) => {
				events.onOpen()
				events.onClose('immediate-close')
				return { send: () => {}, close: () => {} }
			}
		}
		const provider = await createRtcTunnelRelayProvider({ tunnelProvider, liveRelays })
		await provider.createRelayConnection(
			{ address: '1.2.3.4', port: 1234, iceUfrag: 'u', icePwd: 'p' },
			{ onOpen: () => {}, onPacket: () => {}, onClose: reason => (closeReason = reason) }
		)
		expect(closeReason).toBe('immediate-close')
		expect(liveRelays.size).toBe(0)
	})
})
