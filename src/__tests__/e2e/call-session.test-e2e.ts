import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import type { CallSession, CallVideoFrame } from '../../Types/index.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { makeUdpRelayProvider } from './udp-relay-provider.ts'
import { waitForEvent } from './wait.ts'

const waitUntil = async (condition: () => boolean, label: string) => {
	const deadline = Date.now() + 15000
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
		await new Promise(resolve => setTimeout(resolve, 20))
	}
}
const videoSource = (frame: Uint8Array): ReadableStream<Uint8Array> => {
	let timer: ReturnType<typeof setTimeout> | undefined, finish: (() => void) | undefined
	return new ReadableStream({
		pull(controller) {
			return new Promise<void>(resolve => {
				finish = resolve
				timer = setTimeout(() => {
					timer = undefined
					controller.enqueue(frame.slice())
					finish = undefined
					resolve()
				}, 80)
			})
		},
		cancel() {
			if (timer !== undefined) clearTimeout(timer)
			finish?.()
		}
	})
}
const idr = (bytes: Uint8Array): Uint8Array | undefined => {
	const starts: Array<{ prefix: number; payload: number }> = []
	for (let index = 0; index + 3 < bytes.length; index++) {
		if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue
		const size = bytes[index + 2] === 1 ? 3 : bytes[index + 2] === 0 && bytes[index + 3] === 1 ? 4 : 0
		if (size) {
			starts.push({ prefix: index, payload: index + size })
			index += size - 1
		}
	}
	for (let index = 0; index < starts.length; index++) {
		const start = starts[index]!
		if ((bytes[start.payload]! & 31) === 5) return bytes.slice(start.payload, starts[index + 1]?.prefix ?? bytes.length)
	}
	return undefined
}

describe('E2E: managed call sessions', { timeout: 90000 }, () => {
	let alice: TestClient, bob: TestClient
	const relays: ReturnType<typeof makeUdpRelayProvider>[] = []
	before(async () => {
		alice = await createTestClient({ label: 'managed-caller' })
		bob = await createTestClient({ label: 'managed-callee' })
		for (const socket of [alice.sock, bob.sock]) {
			const relay = makeUdpRelayProvider()
			relays.push(relay)
			await socket.setRelayTransportProvider(relay)
		}
	})
	after(async () => {
		await Promise.all([alice, bob].filter(Boolean).map(client => destroyTestClient(client)))
		await Promise.all(relays.map(relay => relay.closeAll()))
	})
	it('owns duplex PCM, peer termination, streams and call identity', async () => {
		let alicePcm = 0,
			bobPcm = 0,
			sourcesStopped = 0
		const trace: string[] = []
		for (const [name, sock] of [
			['alice', alice.sock],
			['bob', bob.sock]
		] as const)
			sock.ev.on('call.media', event => trace.push(`${name}:${event.kind}:${event.code ?? ''}:${event.detail ?? ''}`))
		const media = (sink: () => void) => () => ({
			audio: {
				input: new ReadableStream<Int16Array>({
					pull(controller) {
						controller.enqueue(
							Int16Array.from({ length: 960 }, (_, index) => Math.round(6000 * Math.sin((index * Math.PI) / 20)))
						)
					},
					cancel() {
						sourcesStopped++
					}
				}),
				output: new WritableStream<Int16Array>({
					write(samples) {
						assert.ok(samples.length > 0)
						sink()
					}
				})
			}
		})
		const offered = waitForEvent(bob.sock, 'call', events => events.some(event => event.status === 'offer'), 15000)
		let caller: CallSession | undefined, callee: CallSession | undefined
		try {
			caller = await alice.sock.voip.call(bob.lid ?? bob.jid, { media: media(() => alicePcm++) })
			const offer = (await offered).find(event => event.status === 'offer')!
			callee = await bob.sock.voip.accept(offer, { media: media(() => bobPcm++) })
			assert.equal(caller.id, callee.id)
			try {
				await waitUntil(() => alicePcm > 0 && bobPcm > 0, 'duplex decoded PCM')
			} catch (error) {
				console.log('PCM trace', trace, 'caller', await caller.stats(), 'callee', await callee.stats())
				throw error
			}
			assert.ok((await caller.stats()).io.audioInputAccepted > 0)
			await caller.end()
			assert.equal((await callee.closed).reason, 'remote')
			assert.equal(sourcesStopped, 2)
			assert.equal(alice.sock.voip.active.length, 0)
			assert.equal(bob.sock.voip.active.length, 0)
		} finally {
			await caller?.end().catch(() => undefined)
			await callee?.end().catch(() => undefined)
		}
	})
	it('carries a generated H.264 IDR through both managed video endpoints', async () => {
		const frame = new Uint8Array(await readFile(new URL('../fixtures/voip-testsrc-idr.h264', import.meta.url)))
		const expected = idr(frame)
		assert.ok(expected)
		const aliceVideo: CallVideoFrame[] = [],
			bobVideo: CallVideoFrame[] = []
		const media = (received: CallVideoFrame[]) => () => ({
			video: () => ({
				input: videoSource(frame),
				output: new WritableStream<CallVideoFrame>({
					write(unit) {
						received.push(unit)
					}
				})
			})
		})
		const offered = waitForEvent(bob.sock, 'call', events => events.some(event => event.status === 'offer'), 15000)
		let caller: CallSession | undefined, callee: CallSession | undefined
		try {
			caller = await alice.sock.voip.call(bob.lid ?? bob.jid, { video: true, media: media(aliceVideo) })
			const offer = (await offered).find(event => event.status === 'offer')!
			assert.equal(offer.isVideo, true)
			callee = await bob.sock.voip.accept(offer, { media: media(bobVideo) })
			try {
				await waitUntil(
					() => aliceVideo.some(unit => idr(unit.data)) && bobVideo.some(unit => idr(unit.data)),
					'duplex H.264 IDR'
				)
			} catch (error) {
				console.log(
					'VIDEO diagnostics',
					await caller.stats(),
					await callee.stats(),
					await caller.video.diagnostics(),
					await callee.video.diagnostics()
				)
				throw error
			}
			for (const received of [aliceVideo, bobVideo])
				assert.deepEqual(idr(received.find(unit => idr(unit.data))!.data), expected)
			await caller.end()
			await callee.closed
			assert.equal(alice.sock.voip.active.length, 0)
			assert.equal(bob.sock.voip.active.length, 0)
		} finally {
			await caller?.end().catch(() => undefined)
			await callee?.end().catch(() => undefined)
		}
	})
})
