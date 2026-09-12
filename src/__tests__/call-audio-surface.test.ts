/**
 * The bridge audio surface, driven directly against the preview package.
 *
 * Starting or driving a call needs a live connection and a peer, and no mock
 * server answers call stanzas here — so like the bridge's own offline tests,
 * this covers what needs neither: every encoded-audio operation is present
 * with its sync/async shape, validates its arguments ahead of the core, names
 * unknown call ids, and fails as a typed `WhatsAppError` rather than hanging.
 * The one construction probe also shows the `onCallAudio` / `onCallEvent`
 * sinks install cleanly on the callbacks object a signaling-only host would
 * pass unchanged.
 *
 * Encoded packets both ways — push (JS into the engine) and the speaker pump
 * (engine out to `onCallAudio`) — need a live call, which needs an account
 * and a relay. Not verified here; see the PR body for the gap. The pump
 * machinery around those crossings is `call-audio-pump.test.ts`.
 */

import { describe, it } from 'node:test'
import {
	createWhatsAppClient,
	initWasmEngine,
	type JsHttpClientConfig,
	type JsStoreCallbacks,
	type JsTransportCallbacks
} from '@oxidezap/whatsapp-rust-bridge'

import { asCallAudioClient, type CallAudioBridgeClient } from '../Socket/calls.ts'
import type { CallAudioFrame, CallMediaEvent, CallPcmFrame, CallVideoFrame } from '../Types/Call.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as unknown as ILogger

const deadTransport = (): JsTransportCallbacks => ({
	connect: async () => undefined,
	send: () => undefined,
	disconnect: async () => undefined
})

const deadHttp = (): JsHttpClientConfig => ({
	execute: async () => ({ statusCode: 503, body: new Uint8Array() })
})

const memoryStore = (): JsStoreCallbacks => ({
	get: async () => null,
	set: async () => undefined,
	delete: async () => undefined
})

initWasmEngine(silentLogger)

type CodedError = Error & { kind?: string; field?: string }

const rejection = async (promise: Promise<unknown>): Promise<CodedError> => {
	try {
		await promise
	} catch (error) {
		return error as CodedError
	}
	throw new Error('expected the call to reject')
}

const syncRejection = (fn: () => unknown): CodedError => {
	try {
		fn()
	} catch (error) {
		return error as CodedError
	}
	throw new Error('expected the call to throw')
}

const offlineAudioClient = async (): Promise<CallAudioBridgeClient> => {
	const client = await createWhatsAppClient(deadTransport(), deadHttp(), null, memoryStore(), null)
	for (const method of [
		'acceptCall',
		'dialCall',
		'acceptCallPcm',
		'dialCallPcm',
		'callPushAudio',
		'callPushPcm16',
		'endCall',
		'setCallMuted',
		'getCallMediaStats',
		'getCallAudioBuffer',
		'getActiveCalls',
		'setRelayTransportProvider',
		'acceptCallVideo',
		'callPushVideo',
		'startCallVideo',
		'stopCallVideo',
		'resumeCallVideo',
		'retryCallVideoUpgrade',
		'getCallVideoDiagnostics',
		'requestCallKeyframe'
	] as const) {
		expect(typeof (client as unknown as Record<string, unknown>)[method]).toBe('function')
	}
	return asCallAudioClient(client, 'acceptCall')
}

describe('call audio bridge surface', { timeout: 60_000 }, () => {
	it('accepting needs a live offer for the id', async () => {
		const client = await offlineAudioClient()
		try {
			const error = await rejection(client.acceptCall('NEVER-RANG', 'mlow'))
			expect(error.kind).toBe('invalid-argument')
			expect(error.field).toBe('callId')
		} finally {
			;(client as unknown as { free(): void }).free()
		}
	})

	it('the audio format promise is validated ahead of the core', async () => {
		const client = await offlineAudioClient()
		try {
			const error = await rejection(client.acceptCall('NEVER-RANG', 'g729' as 'mlow'))
			expect(error.kind).toBe('invalid-argument')
			expect(error.field).toBe('audioFormat')
		} finally {
			;(client as unknown as { free(): void }).free()
		}
	})

	it('dialing names a malformed peer', async () => {
		const client = await offlineAudioClient()
		try {
			const error = await rejection(client.dialCall('not-a-jid', 'mlow'))
			expect(error.kind).toBe('invalid-argument')
			expect(error.field).toBe('peer')
		} finally {
			;(client as unknown as { free(): void }).free()
		}
	})

	it('push, stats, end and mute name an unknown call id', async () => {
		const client = await offlineAudioClient()
		try {
			const push = syncRejection(() => client.callPushAudio('NEVER-LIVE', new Uint8Array([0x90])))
			expect(push.kind).toBe('invalid-argument')
			expect(push.field).toBe('callId')

			const empty = syncRejection(() => client.callPushAudio('NEVER-LIVE', new Uint8Array(0)))
			expect(empty.kind).toBe('invalid-argument')
			expect(empty.field).toBe('data')

			const pcm = syncRejection(() => client.callPushPcm16('NEVER-LIVE', new Int16Array(960)))
			expect(pcm.kind).toBe('invalid-argument')
			expect(pcm.field).toBe('callId')

			const shortPcm = syncRejection(() => client.callPushPcm16('NEVER-LIVE', new Int16Array(1)))
			expect(shortPcm.kind).toBe('invalid-argument')
			expect(shortPcm.field).toBe('samples')

			const stats = syncRejection(() => client.getCallMediaStats('NEVER-LIVE'))
			expect(stats.kind).toBe('invalid-argument')
			expect(stats.field).toBe('callId')

			const end = await rejection(client.endCall('NEVER-LIVE'))
			expect(end.kind).toBe('invalid-argument')
			expect(end.field).toBe('callId')

			const mute = await rejection(client.setCallMuted('NEVER-LIVE', true))
			expect(mute.kind).toBe('invalid-argument')
			expect(mute.field).toBe('callId')

			expect(client.getActiveCalls()).toEqual([])
		} finally {
			;(client as unknown as { free(): void }).free()
		}
	})

	it('video operations name an unknown call id offline', async () => {
		const client = await offlineAudioClient()
		try {
			for (const call of [
				client.startCallVideo('NEVER-LIVE'),
				client.stopCallVideo('NEVER-LIVE'),
				client.acceptCallVideo('NEVER-LIVE'),
				client.resumeCallVideo('NEVER-LIVE'),
				client.retryCallVideoUpgrade('NEVER-LIVE')
			]) {
				const error = await rejection(call)
				expect(error.kind).toBe('invalid-argument')
				expect(error.field).toBe('callId')
			}

			const push = syncRejection(() => client.callPushVideo('NEVER-LIVE', new Uint8Array([0, 0, 0, 1, 0x65])))
			expect(push.kind).toBe('invalid-argument')
			expect(push.field).toBe('callId')

			const diagnostics = syncRejection(() => client.getCallVideoDiagnostics('NEVER-LIVE'))
			expect(diagnostics.kind).toBe('invalid-argument')
			expect(diagnostics.field).toBe('callId')

			// requestCallKeyframe reports an unknown id the same way, so a
			// lost frame during teardown still surfaces instead of vanishing.
			const keyframe = syncRejection(() => client.requestCallKeyframe('NEVER-LIVE', 'immediate'))
			expect(keyframe.kind).toBe('invalid-argument')
			expect(keyframe.field).toBe('callId')
		} finally {
			;(client as unknown as { free(): void }).free()
		}
	})

	it('the relay provider names a missing constructor', async () => {
		const client = await offlineAudioClient()
		try {
			const error = syncRejection(() => client.setRelayTransportProvider({} as never))
			expect(error.kind).toBe('invalid-argument')
			expect(error.field).toBe('provider')
		} finally {
			;(client as unknown as { free(): void }).free()
		}
	})

	it('the media sinks install on the callbacks object without disturbing signaling', async () => {
		const audioFrames: CallAudioFrame[] = []
		const mediaEvents: CallMediaEvent[] = []
		const videoFrames: CallVideoFrame[] = []
		const pcmFrames: CallPcmFrame[] = []
		const callbacks = {
			onEvent: () => undefined
		}
		Object.assign(callbacks, {
			onCallAudio: (frame: CallAudioFrame) => audioFrames.push(frame),
			onCallEvent: (event: CallMediaEvent) => mediaEvents.push(event),
			onCallVideo: (frame: CallVideoFrame) => videoFrames.push(frame),
			onCallPcm: (frame: CallPcmFrame) => pcmFrames.push(frame)
		})
		const client = await createWhatsAppClient(
			deadTransport(),
			deadHttp(),
			callbacks as unknown as Parameters<typeof createWhatsAppClient>[2],
			memoryStore(),
			null
		)
		try {
			expect(typeof client.disconnect).toBe('function')
			expect(audioFrames).toEqual([])
			expect(mediaEvents).toEqual([])
			expect(videoFrames).toEqual([])
			expect(pcmFrames).toEqual([])
		} finally {
			try {
				await client.disconnect()
			} catch {
				/* ignore */
			}
			client.free()
		}
	})
})
