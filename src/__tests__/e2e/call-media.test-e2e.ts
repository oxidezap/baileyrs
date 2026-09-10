/**
 * E2E: encoded-audio media loop over the mock's loopback UDP relay.
 *
 * Alice dials Bob, Bob answers with encoded audio, both sides allocate the
 * relay through a test-only UDP pipe (see udp-relay-provider.ts: the core
 * builds every datagram from the signaling keys, the pipe only ships bytes),
 * and MLOW silence packets cross both ways: Alice's pushes arrive in Bob's
 * `onCallAudio` sink and back again, with the decode counters proving the
 * decrypt path rather than just the send queue.
 *
 * Needs the VoIP-capable mock with its UDP relay on BARBACK_RELAY_PORT,
 * published where the test runner reaches it (the loopback candidates name
 * 127.0.0.1). Without relay candidates in the offer this fails at the
 * relay-allocated wait, which is the honest signal, not a hang: every wait
 * below carries an explicit timeout.
 *
 * Video has no test here on purpose. The bridge preview exposes no video
 * operations and drops video engine events, and nothing in this repo can
 * place a video offer, so there is no video path to drive yet.
 */

import { after, before, describe, test } from 'node:test'

import type { CallAudioFrame, CallAudioSink, CallMediaStats } from '../../index.ts'
import { makeSilenceCallAudioSource } from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { makeUdpRelayProvider } from './udp-relay-provider.ts'
import { waitForEvent } from './wait.ts'

const SID = new Uint8Array([0x90])

const waitForFrames = async (
	frames: CallAudioFrame[],
	count: number,
	timeoutMs: number,
	label: string
): Promise<CallAudioFrame[]> => {
	const started = Date.now()
	while (frames.length < count) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`${label}: only ${frames.length}/${count} audio frames arrived in ${timeoutMs}ms`)
		}
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	return frames
}

/**
 * A `call.media` wait the test can cancel. Plain `waitForEvent` leaves its
 * timer behind when the test bails early (a skip after a relay timeout, for
 * example), and the late rejection lands past the end of the file as an
 * unhandled rejection that fails the run.
 */
const waitForMedia = (
	sock: TestClient['sock'],
	kind: string,
	timeoutMs: number
): { promise: Promise<void>; cancel: () => void } => {
	let cleanup!: () => void
	const promise = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error(`timed out waiting for call.media ${kind}`))
		}, timeoutMs)
		const listener = (event: { kind: string }) => {
			if (event.kind !== kind) return
			cleanup()
			resolve()
		}
		cleanup = () => {
			clearTimeout(timer)
			sock.ev.off('call.media', listener)
		}
		sock.ev.on('call.media', listener)
	})
	return { promise, cancel: () => cleanup() }
}

describe('E2E: encoded-audio media loop', { timeout: 300_000 }, () => {
	let alice: TestClient
	let bob: TestClient
	const relayProviders: { closeAll(): Promise<void> }[] = []

	before(async () => {
		alice = await createTestClient({ label: 'caller' })
		bob = await createTestClient({ label: 'callee' })
		// Installed before any call exists: the core asks the provider for
		// one channel per relay endpoint during media setup.
		for (const sock of [alice.sock, bob.sock]) {
			const provider = makeUdpRelayProvider()
			relayProviders.push(provider)
			await sock.setRelayTransportProvider(provider)
		}
	})

	after(async () => {
		// Relay sockets first: their close events must land in a live
		// bridge, and open ones hold the process open past the run.
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

	test('answer, relay, audio both ways, hangup', async () => {
		const aliceFrames: CallAudioFrame[] = []
		const bobFrames: CallAudioFrame[] = []
		const aliceAudio: CallAudioSink = frame => aliceFrames.push(frame)
		const bobAudio: CallAudioSink = frame => bobFrames.push(frame)
		// Every wait below is armed before the action that can fire it: media
		// events do not queue for late listeners, so attaching after the
		// trigger would turn a fast relay into a timeout.
		const bobOffer = waitForEvent(bob.sock, 'call', events => events.some(event => event.status === 'offer'), 30_000)
		const aliceRelay = waitForMedia(alice.sock, 'relay-allocated', 60_000)
		const bobRelay = waitForMedia(bob.sock, 'relay-allocated', 60_000)
		const bobEnded = waitForMedia(bob.sock, 'ended', 30_000)
		const mediaSeen: string[] = []
		const recordMedia = (tag: string) => (event: { callId: string; kind: string }) => {
			mediaSeen.push(`${tag}:${event.callId.slice(0, 8)}:${event.kind}`)
		}
		const onAliceMedia = recordMedia('alice')
		const onBobMedia = recordMedia('bob')
		alice.sock.ev.on('call.media', onAliceMedia)
		bob.sock.ev.on('call.media', onBobMedia)
		const callId = await alice.sock.dialCall(bob.lid ?? bob.jid, 'mlow')
		const offer = await bobOffer
		const offeredId = offer.find(event => event.status === 'offer')?.id
		expect(offeredId).toBe(callId)

		const bobCallId = await bob.sock.acceptCall(callId, 'mlow')
		expect(bobCallId).toBe(callId)
		const stopAliceSink = alice.sock.onCallAudio(callId, aliceAudio)
		const stopBobSink = bob.sock.onCallAudio(bobCallId, bobAudio)
		try {
			// Both engines must report the relay up before media can flow.
			// The recorded events below say which half went quiet if this
			// ever times out again.
			try {
				await aliceRelay.promise
				await bobRelay.promise
			} catch (err) {
				console.log('media events seen:', JSON.stringify(mediaSeen))
				throw err
			}

			for (let i = 0; i < 5; i++) {
				expect(await alice.sock.pushCallAudio(callId, SID)).toBe(true)
			}
			const received = await waitForFrames(bobFrames, 1, 30_000, 'alice->bob')
			expect(received[0]!.codec).toBe('mlow')
			expect(received[0]!.data).toEqual(SID)

			for (let i = 0; i < 5; i++) {
				const pushed = await bob.sock.pushCallAudio(bobCallId, SID)
				expect(pushed).toBe(true)
			}
			const echoed = await waitForFrames(aliceFrames, 1, 30_000, 'bob->alice')
			expect(echoed[0]!.codec).toBe('mlow')
			expect(echoed[0]!.data).toEqual(SID)

			// The encoded path forwards opaque payloads: per-packet
			// classification counters (decoded, inactive-or-sid) belong to
			// the PCM decoder and stay zero here. Delivery plus received
			// counters prove the relay, decrypt and handoff ran.
			const bobStats = (await bob.sock.getCallMediaStats(bobCallId)) as CallMediaStats
			expect(bobStats.audioFramesDelivered > 0).toBe(true)
			expect(bobStats.rtpReceived > 0).toBe(true)
			const aliceStats = (await alice.sock.getCallMediaStats(callId)) as CallMediaStats
			expect(aliceStats.audioFramesDelivered > 0).toBe(true)
			expect(aliceStats.rtpReceived > 0).toBe(true)

			// The mock suppresses the bare-LID terminate leg as
			// accepted_elsewhere and routes the device-addressed one, so a
			// partial notification is the honest answer here. local-only
			// would mean nobody was told.
			const end = await alice.sock.endCall(callId)
			expect(end.outcome !== 'local-only').toBe(true)
			await bobEnded.promise
			expect(await bob.sock.getActiveCalls()).toEqual([])
			expect(await alice.sock.getActiveCalls()).toEqual([])
		} catch (err) {
			console.log('media events seen:', JSON.stringify(mediaSeen))
			throw err
		} finally {
			// Cancel every armed media wait first: a failure after relay
			// allocation leaves their timers live, and a late rejection past
			// the end of the test reads as an unhandled failure in another
			// test instead of this one.
			aliceRelay.cancel()
			bobRelay.cancel()
			bobEnded.cancel()
			stopAliceSink()
			stopBobSink()
			alice.sock.ev.off('call.media', onAliceMedia)
			bob.sock.ev.off('call.media', onBobMedia)
		}
	})

	test('a silence pump moves real packets through the relay', async () => {
		const offer = waitForEvent(bob.sock, 'call', events => events.some(event => event.status === 'offer'), 30_000)
		const callId = await alice.sock.dialCall(bob.lid ?? bob.jid, 'mlow')
		const offered = await offer
		expect(offered.some(event => event.status === 'offer' && event.id === callId)).toBe(true)
		await bob.sock.acceptCall(callId, 'mlow')
		const pump = await alice.sock.startCallAudioPump(callId, makeSilenceCallAudioSource({ packets: 3, intervalMs: 5 }))
		expect(await pump.done).toEqual({ pushed: 3, shed: 0, stopReason: 'source-ended' })
		await alice.sock.endCall(callId)
	})
})
