/**
 * E2E: encoded-audio call loop against the mock server.
 *
 * Alice dials Bob's LID with the `mlow` promise, pushes MLOW silence packets
 * through the real engine, reads the media stats, and ends the call. Bob
 * observes the offer on `call`, which proves the offer stanza crossed the
 * mock — the mock answers no relay, so the media plane stays dormant and no
 * encoded packet can come back down `onCallAudio` here. That direction is
 * covered by the loopback half of `call-audio-pump.test.ts`.
 *
 * What this pins, all against the preview bridge and the mock:
 *
 * - `dialCall` resolves a call id the bridge also lists in `getActiveCalls`
 *   with Bob as the peer;
 * - Bob's `call` event carries an `offer` with the same id;
 * - `pushCallAudio` queues silence (`true`) and the stats object keeps all
 *   21 counters numeric;
 * - a one-packet silence pump through `startCallAudioPump` moves exactly it;
 * - `endCall` reports the peer told or already gone — both are honest
 *   answers against a mock that ends dormant calls on its own schedule.
 */

import { after, before, describe, test } from 'node:test'

import { makeSilenceCallAudioSource } from '../../Socket/calls.ts'
import type { CallMediaStats } from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { makeUdpRelayProvider } from './udp-relay-provider.ts'
import { waitForEvent } from './wait.ts'

const STAT_FIELDS = [
	'rtpReceived',
	'rtpPayloadTypeUnexpected',
	'srtpUnprotectFailed',
	'sframeDecryptFailed',
	'audioFramesDecoded',
	'audioFramesDelivered',
	'audioFramesConcealed',
	'mlowOffPointDropped',
	'mlowInactiveOrSid',
	'foreignFramesDecoded',
	'audioFramesWithoutDecoder',
	'outboundFramesWithoutEncoder',
	'playoutTrimmedSamples',
	'inboundPipeDropped',
	'audioSinkDropped',
	'videoSinkDropped',
	'peerKeyframeRequests',
	'relayPacketUnclassified',
	'forwardingEnvelopeRejected',
	'codecSwitches'
] as const

describe('E2E: encoded-audio call loop', { timeout: 120_000 }, () => {
	let alice: TestClient
	let bob: TestClient

	const relayProviders: { closeAll(): Promise<void> }[] = []

	before(async () => {
		alice = await createTestClient({ label: 'caller' })
		bob = await createTestClient({ label: 'callee' })
		// The caller's engine starts relay setup on dial; without a provider
		// that setup fails fast and the dormant call is gone before the first
		// push. The old mock never got this far, so the provider is new.
		for (const sock of [alice.sock, bob.sock]) {
			const provider = makeUdpRelayProvider()
			relayProviders.push(provider)
			await sock.setRelayTransportProvider(provider)
		}
	})

	after(async () => {
		for (const provider of relayProviders) {
			try {
				await provider.closeAll()
			} catch {
				/* ignore */
			}
		}
		relayProviders.length = 0
		await destroyTestClient(alice)
		await destroyTestClient(bob)
	})

	test('dial, offer wire, push, stats, pump and end', async () => {
		const bobOffer = waitForEvent(bob.sock, 'call', events => events.some(event => event.status === 'offer'))
		const callId = await alice.sock.dialCall(bob.lid ?? bob.jid, 'mlow')
		expect(typeof callId).toBe('string')

		// Push first: the mock ends a dormant call on its own schedule, so
		// every assertion that needs the call alive runs ahead of the waits.
		expect(await alice.sock.pushCallAudio(callId, new Uint8Array([0x90]))).toBe(true)

		const pump = await alice.sock.startCallAudioPump(callId, makeSilenceCallAudioSource({ packets: 1, intervalMs: 0 }))
		expect(await pump.done).toEqual({ pushed: 1, shed: 0, stopReason: 'source-ended' })

		const active = await alice.sock.getActiveCalls()
		expect(active.some(call => call.callId === callId)).toBe(true)

		const offer = await bobOffer
		expect(offer.some(event => event.status === 'offer' && event.id === callId)).toBe(true)

		const stats = (await alice.sock.getCallMediaStats(callId)) as CallMediaStats
		for (const field of STAT_FIELDS) {
			expect(typeof stats[field]).toBe('number')
		}

		// Hanging up also stops local media: the open-ended pump below would
		// outlive the test if terminateCall left it pulling. Only the reason
		// is asserted: whether the pump pushes first is a scheduling race,
		// but every path out runs through the call-ended stop.
		const lingering = await alice.sock.startCallAudioPump(callId, makeSilenceCallAudioSource({ intervalMs: 5 }))
		await alice.sock.terminateCall(callId, bob.lid ?? bob.jid)
		const lingeringStats = await lingering.done
		expect(lingeringStats.stopReason).toBe('call-ended')
		// The native handle goes with it: terminate ends the bridge record,
		// not just the JS routing.
		const afterTerminate = await alice.sock.getActiveCalls()
		expect(afterTerminate.some(call => call.callId === callId)).toBe(false)

		const end = await alice.sock.endCall(callId)
		expect(end.outcome === 'peer-notified' || end.outcome === 'already-ended').toBe(true)
	})
})
