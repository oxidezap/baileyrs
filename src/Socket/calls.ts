/**
 * Encoded-audio voice calls over the bridge `client-calls-audio` domain.
 *
 * The bridge owns the media engine (accept/dial/push/stats/hangup plus the
 * relay transport); this layer owns JS ergonomics on top of it: per-call
 * audio sinks, a source pump with shed accounting, and socket-independent
 * silence/file sources for tests that have no microphone. Encoded video
 * access units travel the same shape: per-call video sinks, a synchronous
 * writer, and start/stop/accept plus resume/retry/diagnostics over the same
 * neutral client.
 *
 * Upstream Baileys has no audio media surface — only the `call` event — so
 * nothing here translates an upstream shape. The types live in
 * `../Types/Call.ts` under bridge names, and the one new socket event,
 * `call.media`, carries the bridge `CallMediaEvent` unchanged.
 *
 * Backpressure is loss-tolerant end to end: `callPushAudio` resolves `false`
 * when the engine queue is full and the packet is shed, which the pump counts
 * rather than treating as an error. The bridge exposes no watermark readout
 * (its docs name the `false` return as the pacing signal in place of one),
 * so pacing sources read the shed count and the `audioSinkDropped` /
 * `inboundPipeDropped` stats counters instead. Source format mixups never
 * reach that queue: the local source grammar is tracked from accept/dial, and
 * a push declaring another source grammar fails fast instead of shedding.
 */

import { Boom } from '../Utils/boom.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import {
	depacketizeOpusFromMlow as bridgeDepacketizeOpusFromMlow,
	packetizeOpusForMlow as bridgePacketizeOpusForMlow
} from '@oxidezap/whatsapp-rust-bridge'
import type {
	ActiveCall,
	CallAudioBuffer,
	CallAudioFormat,
	CallAudioFrame,
	CallAudioPacketSource,
	CallAudioPumpStats,
	CallAudioSink,
	CallAudioSourceInput,
	CallAudioStopReason,
	CallAudioTiming,
	CallAudioWriter,
	CallPcmFrame,
	CallPcmSink,
	CallPcmWriter,
	CallEndResult,
	CallKeyframeUrgency,
	CallMediaEvent,
	CallMediaStats,
	CallVideoDiagnostics,
	CallVideoFrame,
	CallVideoSink,
	CallVideoWriter,
	EncodedPacketReader
} from '../Types/Call.ts'
import { DisconnectReason } from '../Types/index.ts'
import type { SocketContext } from './types.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Bridge surface (structural)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `client-calls-audio` half of `WasmWhatsAppClient`, written down here
 * rather than imported: the release bridge has no audio domain, so naming its
 * types would not compile under it. The shapes come from the bridge calls PR
 * head (`src/wasm_client/calls_audio.rs` plus the `CallAudioFrame` /
 * `CallMediaEvent` / stats result types); `call-audio-surface.test.ts` proves
 * the preview client satisfies this interface at runtime.
 */
export interface CallAudioBridgeClient {
	acceptCall(callId: string, audioFormat: CallAudioFormat, withVideo?: boolean): Promise<string>
	dialCall(peer: string, audioFormat: CallAudioFormat, withVideo?: boolean): Promise<string>
	acceptCallPcm(callId: string, withVideo?: boolean): Promise<string>
	dialCallPcm(peer: string, withVideo?: boolean): Promise<string>
	callPushAudio(callId: string, data: Uint8Array): boolean
	callPushPcm16(callId: string, samples: Int16Array): boolean
	endCall(callId: string): Promise<CallEndResult>
	setCallMuted(callId: string, muted: boolean): Promise<void>
	getCallMediaStats(callId: string): CallMediaStats
	getCallAudioBuffer(callId: string): CallAudioBuffer
	getActiveCalls(): ActiveCall[]
	setRelayTransportProvider(provider: CallRelayTransportProvider): void
	acceptCallVideo(callId: string): Promise<void>
	callPushVideo(callId: string, data: Uint8Array): boolean
	startCallVideo(callId: string): Promise<void>
	stopCallVideo(callId: string): Promise<void>
	resumeCallVideo(callId: string): Promise<void>
	retryCallVideoUpgrade(callId: string): Promise<void>
	getCallVideoDiagnostics(callId: string): CallVideoDiagnostics
	requestCallKeyframe(callId: string, urgency: CallKeyframeUrgency): void
}

/** Host-owned relay media channel for one call, behind `setRelayTransportProvider`. */
export interface CallRelayConnectionEvents {
	onPacket(data: Uint8Array): void
	onOpen(): void
	onClose(reason?: string): void
}

export interface CallRelayConnectionHandle {
	send(data: Uint8Array): void | Promise<void>
	close(): void | Promise<void>
}

export interface CallRelayConnectionParams {
	address: string
	port: number
	iceUfrag: string
	icePwd: string
}

export interface CallRelayTransportProvider {
	createRelayConnection(
		params: CallRelayConnectionParams,
		events: CallRelayConnectionEvents
	): Promise<CallRelayConnectionHandle>
}

const AUDIO_FORMATS = ['mlow', 'opus', 'opus-mlow', undefined] as const
const KEYFRAME_URGENCIES = ['coalesced', 'immediate'] as const

/**
 * Rewrite one RFC Opus packet to the MLOW escape the engine carries, for
 * hosts that queue packets outside `pushCallAudio` (custom transports,
 * offline fixtures). Ordinary pushes must NOT use this: the engine rewrites
 * Opus packets in flight on `opus-mlow` calls, so a pre-packetized packet would be
 * rewritten twice and corrupt the TOC.
 */
export const packetizeOpusForMlow = (data: Uint8Array): Uint8Array => {
	assertAudioPacket('packetizeOpusForMlow', data)
	return bridgePacketizeOpusForMlow(data)
}

/**
 * Restore the RFC TOC only for received `opus` frames whose format is
 * `opus-mlow`. Native `opus` frames stay unchanged, while `mlow` frames use
 * the MLOW decoder.
 */
export const depacketizeOpusFromMlow = (data: Uint8Array): Uint8Array => {
	assertAudioPacket('depacketizeOpusFromMlow', data)
	return bridgeDepacketizeOpusFromMlow(data)
}

/**
 * Narrow a bridge client to the audio domain. A release bridge (or any build
 * without `client-calls-audio`) fails here with a 501 naming the capability,
 * rather than throwing `not a function` off the first call.
 */
export const asCallAudioClient = (client: object, method: keyof CallAudioBridgeClient): CallAudioBridgeClient => {
	const candidate = client as Partial<Record<keyof CallAudioBridgeClient, unknown>>
	if (typeof candidate[method] !== 'function') {
		throw new Boom(
			`${method} needs a bridge with the client-calls-audio domain (bridge calls preview or newer); the installed bridge has no ${method}`,
			{ statusCode: 501 }
		)
	}
	return candidate as CallAudioBridgeClient
}

const assertCallId = (method: string, callId: string): void => {
	if (typeof callId !== 'string' || callId.length === 0) {
		throw new Boom(`${method}: callId must be a non-empty string`, { statusCode: 400 })
	}
}

const assertNonEmptyPacket = (method: string, data: Uint8Array, detail?: string): void => {
	if (!(data instanceof Uint8Array) || data.length === 0) {
		const suffix = detail ? ` (${detail})` : ''
		throw new Boom(`${method}: data must be a non-empty Uint8Array${suffix}`, { statusCode: 400 })
	}
}

const assertAudioPacket = (method: string, data: Uint8Array): void => assertNonEmptyPacket(method, data)

const assertPcmSamples = (method: string, samples: Int16Array): void => {
	if (!(samples instanceof Int16Array) || samples.length !== 960) {
		throw new Boom(`${method}: samples must be a 960-sample Int16Array`, { statusCode: 400 })
	}
}

const assertSourceMode = (
	method: string,
	media: Pick<CallMediaRouter, 'getSourceMode'>,
	callId: string,
	kind: string
): void => {
	const actualMode = media.getSourceMode(callId)
	if (actualMode !== undefined && actualMode !== kind) {
		throw new Boom(`${method}: call ${callId} uses ${actualMode} audio`, { statusCode: 409 })
	}
}

/**
 * Fail a declared-format push against the call's negotiated promise. Only a
 * declared format is checked. An omitted one passes through, and a call
 * with no tracked format (never negotiated here, already ended) is the
 * bridge's to report, not this layer's to guess about.
 */
const assertPushFormat = (
	method: string,
	media: Pick<CallMediaRouter, 'getSourceFormat'>,
	callId: string,
	audioFormat: CallAudioFormat | undefined
): void => {
	if (audioFormat === undefined) return
	const sourceFormat = media.getSourceFormat(callId)
	if (sourceFormat !== undefined && sourceFormat !== audioFormat) {
		throw new Boom(`${method}: packet declares ${audioFormat} but call ${callId} source is ${sourceFormat}`, {
			statusCode: 400
		})
	}
}

/**
 * The bridge types its hangup result as a plain object but hands back a Map
 * at runtime, which reads every `outcome` as undefined. Plain objects pass
 * through untouched; anything else stays exactly what it was for the
 * outcome checks below to report.
 */
export const normalizeCallEndResult = (raw: unknown): CallEndResult => {
	if (raw instanceof Map) return Object.fromEntries(raw) as CallEndResult
	return raw as CallEndResult
}

const assertVideoPacket = (method: string, data: Uint8Array): void =>
	assertNonEmptyPacket(method, data, 'one Annex-B H.264 access unit')

/**
 * Sleep between source packets without keeping the process alive for a call
 * nobody is listening to anymore — same `unref` treatment as the socket's own
 * query timeouts.
 */
const paceDelay = (intervalMs: number): Promise<void> =>
	new Promise(resolve => {
		setTimeout(resolve, intervalMs).unref()
	})

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
] as const satisfies readonly (keyof CallMediaStats)[]

const normalizeNumericRecord = <T extends Record<string, number>>(
	method: string,
	entityName: string,
	raw: unknown,
	requiredFields: readonly (keyof T)[],
	optionalFields: readonly (keyof T)[] = []
): T => {
	if (typeof raw !== 'object' || raw === null) {
		throw new Boom(`${method}: bridge returned no ${entityName} object`, { statusCode: 500 })
	}
	const record = raw as Record<string, unknown>
	const result = {} as Record<string, number>
	for (const field of requiredFields as readonly string[]) {
		const value = record[field]
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Boom(`${method}: bridge ${entityName} field ${field} is not a number`, { statusCode: 500 })
		}
		result[field] = value
	}
	for (const field of optionalFields as readonly string[]) {
		const value = record[field]
		if (value === undefined) continue
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Boom(`${method}: bridge ${entityName} field ${field} is not a number`, { statusCode: 500 })
		}
		result[field] = value
	}
	return result as T
}

const VIDEO_DIAGNOSTIC_FIELDS = ['selfState', 'peerState', 'upgradeTimeoutMs'] as const

/** Read the core's direction-local video state and timeout contract. Numeric
 * states only: a bridge shape advertising anything else fails rather than
 * forwarding it into the typed diagnostics. */
const normalizeCallVideoDiagnostics = (method: string, raw: unknown): CallVideoDiagnostics =>
	normalizeNumericRecord<CallVideoDiagnostics>(method, 'video diagnostics', raw, VIDEO_DIAGNOSTIC_FIELDS)

/** Reject a stats object the bridge shaped unexpectedly instead of forwarding NaNs. */
const normalizeCallMediaStats = (method: string, raw: unknown): CallMediaStats =>
	normalizeNumericRecord<CallMediaStats>(method, 'media stats', raw, STAT_FIELDS)

const BUFFER_FIELDS = ['outboundQueued', 'outboundCapacity', 'inboundQueued', 'inboundCapacity'] as const
const OPTIONAL_BUFFER_FIELDS = ['videoOutboundQueued', 'videoInboundQueued'] as const

/** Same strictness as the stats above: required depths numeric, video depths numeric when present. */
const normalizeCallAudioBuffer = (method: string, raw: unknown): CallAudioBuffer =>
	normalizeNumericRecord<CallAudioBuffer>(method, 'audio buffer', raw, BUFFER_FIELDS, OPTIONAL_BUFFER_FIELDS)

// ─────────────────────────────────────────────────────────────────────────────
// Media router: bridge callbacks in, per-call sinks and socket events out
// ─────────────────────────────────────────────────────────────────────────────

export interface CallMediaRouterDeps {
	emitMediaEvent: (event: CallMediaEvent) => void
	reportError: (err: unknown, msg: string) => void
}

interface TrackedCallPump {
	stop: (reason?: CallAudioStopReason) => void
	done?: Promise<unknown>
}

export interface CallMediaRouter {
	/** Register a per-call audio sink; the returned function unregisters it. */
	addAudioSink(callId: string, sink: CallAudioSink): () => void
	/** Register a per-call decoded PCM sink; the returned function unregisters it. */
	addPcmSink(callId: string, sink: CallPcmSink): () => void
	/** Register a per-call video sink; the returned function unregisters it. */
	addVideoSink(callId: string, sink: CallVideoSink): () => void
	/**
	 * Remember the audio promise a call negotiated (recorded on accept/dial
	 * success). Push validation reads it; `undefined` means the call was
	 * never negotiated through this socket or already ended.
	 */
	setSourceFormat(callId: string, format: CallAudioFormat): void
	/** Record that a call uses the core's decoded PCM path. */
	setPcmSource(callId: string): void
	/** Return the media mode negotiated for a call. */
	getSourceMode(callId: string): 'encoded' | 'pcm' | undefined
	/** The local source format recorded above, if the call is still tracked. */
	getSourceFormat(callId: string): CallAudioFormat | undefined
	/** Bridge `onCallAudio` entry point. Never throws: a throw here would stop the bridge pump. */
	routeAudioFrame(frame: CallAudioFrame): void
	/** Bridge `onCallPcm` entry point. Never throws. */
	routePcmFrame(frame: CallPcmFrame): void
	/** Bridge `onCallVideo` entry point. Never throws, same contract as audio. */
	routeVideoFrame(frame: CallVideoFrame): void
	/** Bridge `onCallEvent` entry point. Emits `call.media`; `ended` also stops the call. */
	routeMediaEvent(event: CallMediaEvent): void
	/** Track a pump stopper so `ended` / teardown ends it with the call. */
	trackPump(callId: string, stop: (reason?: CallAudioStopReason) => void, done?: Promise<unknown>): void
	/** Forget one finished pump. Sinks and sibling pumps stay: only `ended` or teardown ends those. */
	untrackPump(callId: string, stop: () => void): void
	/** Stop a call's pumps and drop its sinks. */
	stopCall(callId: string): void
	/** Stop everything; socket teardown calls this while the client is still usable. */
	stopAll(): void
	/**
	 * Stop every pump and wait for each `done` to settle, fulfilled or
	 * rejected. Socket teardown awaits this ahead of disconnecting so no pump
	 * pushes into a closing client and no source release stays in flight.
	 */
	drainAll(): Promise<void>
}

const isIntegerInRange = (value: unknown, min: number, max: number): boolean =>
	typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

const isVideoFrame = (frame: unknown): frame is CallVideoFrame => {
	if (typeof frame !== 'object' || frame === null) return false
	const record = frame as Record<string, unknown>
	return (
		typeof record.callId === 'string' &&
		record.data instanceof Uint8Array &&
		typeof record.keyframe === 'boolean' &&
		isIntegerInRange(record.orientation, 0, 3) &&
		isIntegerInRange(record.timestamp, 0, 4294967295)
	)
}

const isAudioFrame = (frame: unknown): frame is CallAudioFrame => {
	if (typeof frame !== 'object' || frame === null) return false
	const record = frame as Record<string, unknown>
	// Every field the type promises, checked: a partial or version-skewed
	// object must not reach typed sinks with undefined fields. The RTP
	// metadata must be finite integers in protocol range — NaN, Infinity and
	// out-of-range values are malformed, not audio.
	return (
		typeof record.callId === 'string' &&
		record.data instanceof Uint8Array &&
		(record.codec === 'mlow' || record.codec === 'opus') &&
		(record.format === 'mlow' || record.format === 'opus' || record.format === 'opus-mlow') &&
		isIntegerInRange(record.payloadType, 0, 127) &&
		isIntegerInRange(record.sequenceNumber, 0, 65535) &&
		isIntegerInRange(record.timestamp, 0, 4294967295) &&
		typeof record.marker === 'boolean'
	)
}

const isPcmFrame = (frame: unknown): frame is CallPcmFrame => {
	if (typeof frame !== 'object' || frame === null) return false
	const record = frame as Record<string, unknown>
	return typeof record.callId === 'string' && record.data instanceof Int16Array && record.data.length > 0
}

const MEDIA_EVENT_KINDS: readonly CallMediaEvent['kind'][] = [
	'relay-allocated',
	'relay-allocate-failed',
	'relay-allocate-timed-out',
	'media-setup-failed',
	'audio-codec-switched',
	'audio-codec-source-fixed',
	'video-upgrade-requested',
	'video-state-changed',
	'ended'
]

const isMediaEvent = (event: unknown): event is CallMediaEvent => {
	if (typeof event !== 'object' || event === null) return false
	const record = event as Record<string, unknown>
	// The kind is closed: a version-skewed spelling must not publish as the
	// union the consumers were promised, and a misspelled terminal kind must
	// not skip the stop below by matching nothing.
	if (typeof record.callId !== 'string' || typeof record.kind !== 'string') return false
	if (!(MEDIA_EVENT_KINDS as readonly string[]).includes(record.kind)) return false
	// Per-variant field checks: the boundary that publishes typed events must
	// not let impossible values through on a malformed or version-skewed
	// payload. Absent stays absent; present must match the documented shape.
	const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'
	const optionalFiniteNumber = (value: unknown): boolean =>
		value === undefined || (typeof value === 'number' && Number.isFinite(value))
	switch (record.kind) {
		case 'relay-allocate-failed':
			return record.code === undefined || (typeof record.code === 'number' && Number.isFinite(record.code))
		case 'media-setup-failed':
			return optionalString(record.detail)
		case 'audio-codec-switched':
			return optionalString(record.from) && optionalString(record.to)
		case 'audio-codec-source-fixed':
			return optionalString(record.sending) && optionalString(record.peerExpects)
		case 'video-upgrade-requested':
		case 'video-state-changed':
			return optionalFiniteNumber(record.state)
		default:
			return true
	}
}

export const makeCallMediaRouter = ({ emitMediaEvent, reportError }: CallMediaRouterDeps): CallMediaRouter => {
	const makeSinkRegistry = <TFrame extends { callId: string }>(
		mediaName: string,
		isFrame: (frame: unknown) => frame is TFrame
	) => {
		const sinks = new Map<string, Set<(frame: TFrame) => void>>()
		return {
			add(callId: string, sink: (frame: TFrame) => void): () => void {
				let set = sinks.get(callId)
				if (!set) {
					set = new Set()
					sinks.set(callId, set)
				}
				set.add(sink)
				return () => {
					const live = sinks.get(callId)
					if (!live) return
					live.delete(sink)
					if (live.size === 0) sinks.delete(callId)
				}
			},
			route(frame: unknown): void {
				if (!isFrame(frame)) {
					reportError(
						new Error(`bridge delivered a malformed call ${mediaName} frame`),
						`call ${mediaName} frame dropped`
					)
					return
				}
				const live = sinks.get(frame.callId)
				if (!live) return
				// The frame object is handed through, never re-wrapped: the bridge
				// already copied the encoded bytes out of linear memory once, so
				// what arrives here is an owned buffer, not a borrowed view. It is
				// shared between the call's sinks — do not modify it; copy only
				// to mutate or hand ownership elsewhere.
				// Snapshot: a sink may register another sink while handling a frame,
				// and a live Set iterator would visit the newcomer in this same loop.
				const snapshot = Array.from(live)
				for (const sink of snapshot) {
					try {
						sink(frame)
					} catch (err) {
						reportError(err, `call ${mediaName} sink for ${frame.callId}`)
					}
				}
			},
			delete(callId: string): void {
				sinks.delete(callId)
			},
			clear(): void {
				sinks.clear()
			}
		}
	}

	const audioSinks = makeSinkRegistry<CallAudioFrame>('audio', isAudioFrame)
	const pcmSinks = makeSinkRegistry<CallPcmFrame>('PCM', isPcmFrame)
	const videoSinks = makeSinkRegistry<CallVideoFrame>('video', isVideoFrame)
	const pumps = new Map<string, Set<TrackedCallPump>>()
	// The audio promise per live call, recorded on accept/dial: the bridge
	// takes the format once and every later push is opaque bytes, so this is
	// the only JS-side record of which grammar a call speaks. Cleared with
	// the sinks below. An ended call negotiates nothing.
	const sourceFormats = new Map<string, CallAudioFormat>()
	const pcmCalls = new Set<string>()
	// Pumps stopped but whose `done` has not settled: `drainAll` waits for
	// these, so ending a call and then the socket cannot strand source
	// cleanup behind a teardown that already resolved. Entries leave when
	// their `done` settles; only a release that never settles pins one, which
	// is a contract-violating source, not a router leak.
	const settling = new Set<Promise<unknown>>()
	// Stop functions for the pumps above, kept so teardown can re-stop them
	// with the nonblocking `socket-closed` policy: their `done` then settles
	// without waiting out source cleanup. Without this, a pump removed from
	// `pumps` by an earlier `stopCall` could never be re-stopped, and
	// `drainAll` would wait out its release forever — hanging `sock.end()`
	// after an ordinary call-ended-then-socket-close sequence. Stored
	// pre-bound: the teardown reason is fixed, and an open reason parameter
	// here would trip the closed-domain argument scan for an internal-only
	// value every call site already passes as a literal.
	const settlingStops = new Map<Promise<unknown>, () => void>()

	const settleEntry = (entry: TrackedCallPump): void => {
		if (entry.done === undefined) return
		const waited = entry.done.then(
			() => undefined,
			() => undefined
		)
		settling.add(waited)
		settlingStops.set(waited, () => entry.stop('socket-closed'))
		void waited.finally(() => {
			settling.delete(waited)
			settlingStops.delete(waited)
		})
	}

	const stopEntry = (callId: string, entry: TrackedCallPump, reason: CallAudioStopReason): void => {
		try {
			entry.stop(reason)
		} catch (err) {
			reportError(err, `stopping a call audio pump for ${callId}`)
		}
	}

	const stopCallWith = (callId: string, reason: CallAudioStopReason): void => {
		const tracked = pumps.get(callId)
		if (tracked) {
			pumps.delete(callId)
			for (const entry of tracked) {
				stopEntry(callId, entry, reason)
				settleEntry(entry)
			}
		}
		audioSinks.delete(callId)
		pcmSinks.delete(callId)
		videoSinks.delete(callId)
		sourceFormats.delete(callId)
		pcmCalls.delete(callId)
	}

	const stopCall = (callId: string): void => stopCallWith(callId, 'call-ended')

	// Every pump on every call stops with the teardown reason; the waiter
	// collects them from `settling` instead of a return value, so pumps
	// stopped by an earlier `stopCall` join the same wait.
	const stopAllWith = (reason: CallAudioStopReason): void => {
		// Deleting the current key while iterating a Map is safe; each
		// removal takes exactly the key being visited. Sinks clear with the
		// pumps, not inside the pump loop: a sink-only registration has no
		// pump entry, and teardown must still drop it.
		for (const [callId, set] of pumps) {
			pumps.delete(callId)
			for (const entry of set) {
				stopEntry(callId, entry, reason)
				settleEntry(entry)
			}
		}
		audioSinks.clear()
		pcmSinks.clear()
		videoSinks.clear()
		sourceFormats.clear()
		pcmCalls.clear()
	}

	return {
		setSourceFormat(callId, format) {
			if (pcmCalls.has(callId)) throw new Boom(`call ${callId} already uses PCM audio`, { statusCode: 409 })
			sourceFormats.set(callId, format)
		},
		setPcmSource(callId) {
			if (sourceFormats.has(callId)) throw new Boom(`call ${callId} already uses encoded audio`, { statusCode: 409 })
			pcmCalls.add(callId)
		},
		getSourceMode(callId) {
			if (pcmCalls.has(callId)) return 'pcm'
			if (sourceFormats.has(callId)) return 'encoded'
			return undefined
		},
		getSourceFormat(callId) {
			return sourceFormats.get(callId)
		},
		addAudioSink: audioSinks.add,
		addPcmSink: pcmSinks.add,
		addVideoSink: videoSinks.add,
		routeAudioFrame: audioSinks.route,
		routePcmFrame: pcmSinks.route,
		routeVideoFrame: videoSinks.route,
		routeMediaEvent(event) {
			if (!isMediaEvent(event)) {
				reportError(new Error('bridge delivered a malformed call media event'), 'call media event dropped')
				return
			}
			if (event.kind === 'ended') stopCall(event.callId)
			// Guarded like every other dispatch into consumer code: a throwing
			// `call.media` listener must not propagate through the bridge's
			// `onCallEvent` callback, which answers a throw by stopping its
			// forwarding for the call.
			try {
				emitMediaEvent(event)
			} catch (err) {
				reportError(err, `call.media listener for ${event.callId}`)
			}
		},
		trackPump(callId, stop, done?) {
			let set = pumps.get(callId)
			if (!set) {
				set = new Set()
				pumps.set(callId, set)
			}
			set.add({ stop, done })
		},
		untrackPump(callId, stop) {
			const set = pumps.get(callId)
			if (!set) return
			for (const entry of set) {
				if (entry.stop === stop) set.delete(entry)
			}
			if (set.size === 0) pumps.delete(callId)
		},
		stopCall,
		stopAll() {
			stopAllWith('socket-closed')
		},
		async drainAll() {
			// Stop first, then wait: every pump settles its `done` off the
			// stop above, and `allSettled` keeps one rejecting pump from
			// holding the teardown open. entries stopped by earlier `stopCall`
			// calls are already in `settling` and join the same wait, so
			// cleanup they started still finishes before teardown resolves.
			// Snapshot those first: only they get re-stopped below. Pumps
			// the stop above just reached need no second stop, and counting
			// stops is how the pump tests pin exact teardown behavior.
			const priorSettling = new Set(settling)
			stopAllWith('socket-closed')
			// Re-stop the earlier entries with the teardown policy: their
			// first stop waited out source cleanup, which teardown must not
			// wait for. First stop reason still wins inside the pump.
			for (const [waited, stop] of settlingStops) {
				if (!priorSettling.has(waited)) continue
				try {
					stop()
				} catch (err) {
					reportError(err, 'stopping a settling call audio pump for teardown')
				}
			}
			await Promise.allSettled(settling)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources: silence and file, no microphone or ffmpeg in the package
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The MLOW silence token: one `0x90` byte. The core accepts it as an encoded
 * payload under both the `mlow` and `opus` promises
 * (`AudioFormat::accepts_encoded_payload` in `wacore/src/voip/audio.rs`), and
 * its own packetizer maps Opus DTX/silence to the same byte
 * (`packetize_opus_for_mlow`), so the peer decodes it as silence rather than
 * noise. For pump and backpressure tests without a microphone.
 */
export const MLOW_SILENCE_PACKET: Uint8Array = new Uint8Array([0x90])

/**
 * The wire byte silence sources send. Private rather than the export above:
 * a consumer mutating the exported sample must not change future call
 * traffic. A test pins the two equal.
 */
const MLOW_SILENCE_WIRE_BYTE: Uint8Array = new Uint8Array([0x90])

export interface SilenceCallAudioSourceOptions {
	/** Gap between packets. Defaults to 60 ms, the MLOW frame cadence. */
	intervalMs?: number
	/** Total packets before the source is spent; default runs until stopped. */
	packets?: number
	/** Packet bytes; defaults to the MLOW silence token above. */
	packet?: Uint8Array
}

export const makeSilenceCallAudioSource = (options: SilenceCallAudioSourceOptions = {}): CallAudioPacketSource => {
	if (options.packets !== undefined && (!Number.isInteger(options.packets) || options.packets < 0)) {
		throw new Boom('makeSilenceCallAudioSource: packets must be a non-negative integer', { statusCode: 400 })
	}
	const intervalMs = options.packets === 0 ? 0 : (options.intervalMs ?? 60)
	const total = options.packets ?? Number.POSITIVE_INFINITY
	const packet = options.packet ?? MLOW_SILENCE_WIRE_BYTE
	if (!(packet instanceof Uint8Array) || packet.length === 0) {
		throw new Boom('makeSilenceCallAudioSource: packet must be a non-empty Uint8Array', { statusCode: 400 })
	}
	if (!Number.isFinite(intervalMs) || intervalMs < 0) {
		throw new Boom('makeSilenceCallAudioSource: intervalMs must be a finite number >= 0', { statusCode: 400 })
	}
	let sent = 0
	return {
		next: async () => {
			if (sent >= total) return null
			if (intervalMs > 0 && sent > 0) await paceDelay(intervalMs)
			sent++
			// A fresh copy per tick: the push copies synchronously, but the
			// caller owns the packet afterwards and must not see later ticks
			// overwrite it. Built field by field on purpose — `packet.slice()`
			// on a Node Buffer aliases the same storage instead of copying.
			const copy = new Uint8Array(packet.length)
			copy.set(packet)
			return copy
		}
	}
}

export interface FileCallAudioSourceOptions {
	/** Packet size in bytes. Raw chunking, not transcoding: no ffmpeg involved. */
	packetBytes?: number
	/** Gap between packets. Defaults to 60 ms, the MLOW frame cadence. */
	intervalMs?: number
	/** Maximum packets to read; default reads the whole file. */
	packets?: number
}

/**
 * Chunk a file into fixed-size encoded packets for tests. Reads the file
 * once up front and serves slices of it — no microphone, no codec, no
 * ffmpeg — so the bytes are whatever the fixture carries, and a live peer
 * decodes them as whatever grammar they are in.
 */
export const makeFileCallAudioSource = async (
	path: string,
	options: FileCallAudioSourceOptions = {}
): Promise<CallAudioPacketSource> => {
	const { readFile } = await import('node:fs/promises')
	const packetBytes = options.packetBytes ?? 160
	if (!Number.isInteger(packetBytes) || packetBytes <= 0) {
		throw new Boom('makeFileCallAudioSource: packetBytes must be a positive integer', { statusCode: 400 })
	}
	// Validated before the read: a bad count must not cost a full file read,
	// and a missing file must not mask it with a filesystem error either —
	// the read below runs only for arguments that passed.
	if (options.packets !== undefined && (!Number.isInteger(options.packets) || options.packets < 0)) {
		throw new Boom('makeFileCallAudioSource: packets must be a non-negative integer', { statusCode: 400 })
	}
	const intervalMs = options.intervalMs ?? 60
	if (!Number.isFinite(intervalMs) || intervalMs < 0) {
		throw new Boom('makeFileCallAudioSource: intervalMs must be a finite number >= 0', { statusCode: 400 })
	}
	const bytes = await readFile(path)
	const total = options.packets ?? Number.POSITIVE_INFINITY
	let offset = 0
	let sent = 0
	return {
		next: async () => {
			if (sent >= total || offset >= bytes.length) return null
			if (intervalMs > 0 && sent > 0) await paceDelay(intervalMs)
			const chunk = bytes.subarray(offset, offset + packetBytes)
			offset += chunk.length
			sent++
			return new Uint8Array(chunk)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Pump: source in, bridge push out, shed counted
// ─────────────────────────────────────────────────────────────────────────────

export interface FilePacketReaderOptions {
	/** Packet size in bytes. Raw framing, not transcoding: no ffmpeg involved. */
	packetBytes?: number
}

/**
 * Open a file as an incremental packet reader for tests. Unlike the fixture
 * helper above, this never holds the whole file: one open handle plus the
 * caller's target buffer. Every item is one complete packet — a trailing
 * short chunk fails instead of feeding a runt — so arbitrary read chunks
 * never reach the pump as audio.
 */
export const openFilePacketReader = async (
	path: string,
	options: FilePacketReaderOptions = {}
): Promise<EncodedPacketReader> => {
	const { open } = await import('node:fs/promises')
	const packetBytes = options.packetBytes ?? 160
	if (!Number.isInteger(packetBytes) || packetBytes <= 0) {
		throw new Boom('openFilePacketReader: packetBytes must be a positive integer', { statusCode: 400 })
	}
	const handle = await open(path, 'r')
	let position = 0
	let closed = false
	// The in-flight close, shared: an abort racing a pending read must
	// observe actual completion, not just the flag. Every close path returns
	// this same promise, so callers never finish cleanup while the OS handle
	// is still closing.
	let closePromise: Promise<void> | undefined
	const closeHandle = (): Promise<void> => {
		closed = true
		return (closePromise ??= handle.close().catch(() => {
			// Teardown races a failed open the same way: the handle is
			// gone either way, and close stays idempotent.
		}))
	}
	let tail: Promise<unknown> = Promise.resolve()
	const readIntoInner = async (target: Uint8Array, signal?: AbortSignal): Promise<number | null> => {
		if (closed) {
			throw new Boom('openFilePacketReader: reader is closed', { statusCode: 400 })
		}
		if (!(target instanceof Uint8Array) || target.length < packetBytes) {
			throw new Boom('openFilePacketReader: target must hold a full packet', { statusCode: 400 })
		}
		const abortSignal: AbortSignal | undefined = signal
		let onAbort: (() => void) | undefined
		try {
			if (abortSignal?.aborted) {
				await closeHandle()
				throw abortSignal.reason
			}
			onAbort = () => {
				void closeHandle()
			}
			abortSignal?.addEventListener('abort', onAbort, { once: true })
			// A filesystem read may legally return short of the request
			// before EOF, so accumulate to a full packet: only EOF after
			// a partial aggregate is a runt tail.
			let got = 0
			while (got < packetBytes) {
				const { bytesRead } = await handle.read(target, got, packetBytes - got, position + got)
				if (bytesRead === 0) break
				got += bytesRead
			}
			if (abortSignal?.aborted) {
				await closeHandle()
				throw abortSignal.reason
			}
			if (got === 0) return null
			if (got < packetBytes) {
				throw new Boom(`openFilePacketReader: file length is not a multiple of the ${packetBytes}-byte packet size`, {
					statusCode: 400
				})
			}
			position += got
			return got
		} catch (err) {
			if (abortSignal?.aborted) throw abortSignal.reason
			throw err
		} finally {
			if (onAbort) abortSignal?.removeEventListener('abort', onAbort)
		}
	}
	return {
		readInto: (target: Uint8Array, signal?: AbortSignal): Promise<number | null> => {
			// One read at a time: concurrent calls share `position`, and
			// without ordering two of them can read the same range, then each
			// advance past it and skip a packet. Each call chains behind the
			// previous one; the chain itself never rejects, so one failed
			// read does not wedge later ones. A signal aborted while queued
			// still throws on entry to the inner read below.
			const run = tail.then(() => readIntoInner(target, signal))
			tail = run.catch(() => {})
			return run
		},
		close: () => closeHandle()
	}
}

export interface CallAudioPumpOptions {
	/** AbortSignal that stops the pump; stopping is silent, never an error. */
	signal?: AbortSignal
	/** Called per shed packet with the running shed total. */
	onShed?: (shedTotal: number) => void
	/**
	 * Declares the grammar the source emits. The socket pump checks it
	 * against the call's negotiated promise before the first pull, so a
	 * wrong-grammar source fails fast instead of pushing packets the engine
	 * sheds forever. Omitted means the caller takes responsibility.
	 */
	audioFormat?: CallAudioFormat
	/**
	 * Pull pacing. Defaults to `{ mode: 'source' }`: pull as fast as the
	 * source yields. Pair `{ mode: 'clock' }` with an unpaced source
	 * (`intervalMs: 0`) — pacing twice just adds the two cadences together.
	 */
	timing?: CallAudioTiming
}

export interface CallAudioPump {
	/** Resolves with the moved totals when the source is spent or the pump stops. */
	done: Promise<CallAudioPumpStats>
	/**
	 * Stop pulling; in-flight `done` resolves with the totals so far. The
	 * optional reason is for lifecycle callers (router teardown re-stops
	 * with `socket-closed`); the first reason wins the report, and a plain
	 * `stop()` still means `stopped`.
	 */
	stop: (reason?: CallAudioStopReason) => void
}

/**
 * Settle what the pump pulls from. An async iterable (a generator, a
 * `ReadableStream` reader wrapped as one) pulls through its iterator, where
 * `done` reads as a spent source — this branch comes first because generators
 * also carry a `next()` method, one that yields `{ value, done }` rather than
 * packets. A bare `next()` source is used directly.
 */
export const asCallAudioPacketSource = (method: string, source: CallAudioSourceInput): CallAudioPacketSource => {
	if (typeof source === 'object' && source !== null) {
		const iterable = (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]
		if (typeof iterable === 'function') {
			const iterator = (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
			return {
				next: async () => {
					const step = await iterator.next()
					return step.done ? null : step.value
				},
				// The pump guards the rejection; calling `return()` on an
				// exhausted iterator is a no-op.
				release: () => iterator.return?.()
			}
		}
		if (typeof (source as CallAudioPacketSource).next === 'function') {
			return source as CallAudioPacketSource
		}
	}
	throw new Boom(`${method}: source must carry next() or be an async iterable of Uint8Array`, { statusCode: 400 })
}

/**
 * Pull packets from a source and push them through `push` until the source is
 * spent, the signal aborts, or `stop()` runs. A `false` push is shed audio —
 * counted (and reported via `onShed`), never an error. A throwing push ends
 * the pump and rejects `done`, so an ended call surfaces instead of spinning.
 */
export const startCallAudioPump = (
	push: (data: Uint8Array) => boolean | Promise<boolean>,
	input: CallAudioSourceInput,
	options: CallAudioPumpOptions = {}
): CallAudioPump => {
	let stopped = false
	let onAbort: (() => void) | undefined
	let releaseSettled: Promise<unknown> | undefined
	// First terminal cause wins: a user stop followed by teardown still
	// reports `stopped`.
	let stopReason: CallAudioStopReason | undefined
	// Set once the loop exits for any reason. A later `stop()` — unconditional
	// cleanup, for example — is then a no-op instead of running the release a
	// second time after a spent source.
	let finished = false
	// Teardown stops must settle `done` without waiting out source cleanup:
	// a wedged generator release would otherwise hold socket teardown open.
	// Call-scoped stops still wait, so `finally` blocks run before `done`.
	let skipReleaseWait = false
	// Resolved by a teardown stop: the release wait below races it, so a
	// teardown that arrives while `done` already waits out cleanup settles
	// at once instead of hanging on it.
	let wakeReleaseWait: (() => void) | undefined
	const releaseWaitSkipped = new Promise<void>(resolve => {
		wakeReleaseWait = () => resolve()
	})
	// Wakes the pull currently parked in `source.next()`, if any. Replaced
	// every iteration: a shared stop promise would pile one pair of reactions
	// per raced pull onto itself and hold them for the whole call, while a
	// per-iteration promise goes out of scope with the race that settled it.
	let wakeParkedPull: (() => void) | undefined
	const stats = { pushed: 0, shed: 0 }
	const source = asCallAudioPacketSource('startCallAudioPump', input)
	// The mode discriminator is closed: a misspelling must fail here, not
	// silently run unpaced as source timing and flood the media queue.
	const rawTiming = options.timing as { mode?: unknown; packetDurationMs?: unknown } | undefined
	const timingMode = rawTiming?.mode
	if (rawTiming !== undefined && timingMode !== 'source' && timingMode !== 'clock') {
		throw new Boom(`startCallAudioPump: timing.mode must be 'source' or 'clock'`, { statusCode: 400 })
	}
	let clockMs: number | undefined
	if (timingMode === 'clock') {
		const durationMs = rawTiming?.packetDurationMs
		if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
			throw new Boom('startCallAudioPump: timing.packetDurationMs must be a finite number > 0', {
				statusCode: 400
			})
		}
		clockMs = durationMs
	}

	const stop = (reason: CallAudioStopReason = 'stopped'): void => {
		// A teardown stop always flips the wait policy, even after the pump
		// finished: the release already ran (or was correctly skipped), but
		// `done` may still be waiting it out, and only this flag settles it.
		// First stop reason still wins for the report.
		if (reason === 'socket-closed') {
			skipReleaseWait = true
			wakeReleaseWait?.()
		}
		if (finished) return
		stopped = true
		stopReason ??= reason
		wakeParkedPull?.()
		wakeParkedPull = undefined
		// Invoked from a continuation: a synchronously throwing release must
		// not escape `stop()` itself, which would replace an in-flight push
		// or pull failure propagating out of the loop below.
		releaseSettled ??= Promise.resolve()
			.then(() => source.release?.())
			.catch(() => {})
		if (onAbort) options.signal?.removeEventListener('abort', onAbort)
	}
	if (options.signal) {
		if (options.signal.aborted) {
			stop('aborted')
		} else {
			onAbort = () => stop('aborted')
			options.signal.addEventListener('abort', onAbort, { once: true })
		}
	}

	const done = (async (): Promise<CallAudioPumpStats> => {
		let exhausted = false
		let pulls = 0
		let nextDeadline = 0
		// The loop throws on two documented paths: `source.next()` rejects,
		// and `push()` throws when the call already ended. Both converge on
		// the same cleanup below: the release runs and the abort listener
		// comes off, while the original failure keeps propagating.
		try {
			for (;;) {
				// Checked before pulling: a pump stopped before its first pull
				// never touches the source at all.
				if (stopped) break
				// One interrupt per iteration, shared by the clock wait, the
				// pull and the push: a stop during any of the three settles
				// `done` instead of stranding it. A settled race leaves
				// nothing registered behind.
				let wakeCurrent!: () => void
				const interruptCurrent = new Promise<null>(resolve => {
					wakeCurrent = () => resolve(null)
				})
				wakeParkedPull = wakeCurrent
				try {
					if (clockMs !== undefined && pulls > 0) {
						// Clock pacing, per pull rather than per push: shed
						// audio still consumes its slot, so playback cadence
						// survives congestion instead of compressing into it.
						// Raced like everything else: a bare sleep would lose
						// the stop and strand the pull race behind it.
						const wait = nextDeadline - Date.now()
						if (wait > 0) await Promise.race([paceDelay(wait), interruptCurrent])
						if (stopped) break
					}
					const packet = await Promise.race([source.next(), interruptCurrent])
					if (stopped) break
					if (packet === null) {
						exhausted = true
						break
					}
					assertAudioPacket('startCallAudioPump: source', packet)
					// Without forcing the sync path through async: the bridge
					// answers synchronously, and awaiting a plain boolean would
					// spend a microtask hop per packet for nothing — and a sync
					// answer already entered the queue, so it counts at once.
					// Async pushes race the same interrupt as pulls: a stalled
					// push settles `done` on stop instead of hanging it, and a
					// packet whose push loses the race counts neither way.
					// Cadence stays in the source, never here.
					const pending = push(packet)
					if (typeof pending === 'boolean') {
						if (pending) {
							stats.pushed++
						} else {
							stats.shed++
							options.onShed?.(stats.shed)
						}
					} else {
						const accepted = await Promise.race([pending, interruptCurrent])
						if (stopped) break
						// Null means the interrupt won, which only stop()
						// triggers — covered by the check above, kept so the
						// type narrows.
						if (accepted === null) break
						if (accepted) {
							stats.pushed++
						} else {
							stats.shed++
							options.onShed?.(stats.shed)
						}
					}
					pulls++
					if (clockMs !== undefined) {
						// Late pulls skip the wait and snap the deadline forward:
						// the schedule never sleeps to make up lost time.
						nextDeadline = pulls === 1 ? Date.now() + clockMs : nextDeadline + clockMs
						if (nextDeadline < Date.now()) nextDeadline = Date.now() + clockMs
					}
				} finally {
					if (wakeParkedPull === wakeCurrent) wakeParkedPull = undefined
				}
			}
		} finally {
			if (exhausted) {
				// Natural end: the source is spent, so there is nothing to
				// release — only disarm. Early stops go through `stop()`,
				// which runs the release.
				stopped = true
				stopReason ??= 'source-ended'
				if (onAbort) options.signal?.removeEventListener('abort', onAbort)
			} else {
				stop()
			}
			finished = true
			// Cleanup settles inside the finally, not past it: a propagating
			// failure must not skip the release wait. The original error still
			// propagates afterwards, so failures keep their shape. Teardown
			// stops skip the wait and settle at once; their cleanup keeps
			// running detached rather than holding the socket close open.
			// Raced, not branched: a teardown arriving mid-await settles too.
			if (!skipReleaseWait) await Promise.race([releaseSettled, releaseWaitSkipped])
		}
		return { ...stats, stopReason: stopReason ?? 'source-ended' }
	})()

	return { done, stop }
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Socket-owned side effects the audio methods cannot do themselves. The
 * media router stays in this module; the offer routing cache lives with the
 * socket, so ending a call reports back through here instead.
 */
export interface CallAudioMethodHooks {
	/** A call id the socket should forget: its local side is down for good. */
	onCallEnded?: (callId: string) => void
}

/**
 * End the native media record when this socket opened one. True means a
 * record existed and the peer was told: its own terminate stanza already went
 * out through the handle, so the caller sends nothing more. False means no
 * record, no audio domain — or a record whose peer was never notified
 * (`local-only` or `partly-notified`): the caller falls back to plain signaling
 * so every remote participant can hear the hangup. These are documented
 * fallbacks, not anomalies, so they return quietly; only a shape the bridge enum never named
 * reports, rather than trusted: failing closed would break future notified
 * outcomes, while an extra stanza is recoverable. Anything else throws, so a
 * failed hangup keeps its routing context for the retry instead of reading
 * as a call that is gone.
 */
export const endMediaCallIfPresent = async (ctx: SocketContext, callId: string): Promise<boolean> =>
	ctx.withClient(async client => {
		const endCall = (client as unknown as { endCall?: unknown }).endCall
		if (typeof endCall !== 'function') return false
		try {
			const outcome = normalizeCallEndResult(
				await (endCall as (this: unknown, id: string) => Promise<CallEndResult>).call(client, callId)
			) as CallEndResult
			if (outcome?.outcome === 'local-only' || outcome?.outcome === 'partly-notified') return false
			const notified = outcome?.outcome === 'peer-notified' || outcome?.outcome === 'already-ended'
			if (!notified) {
				ctx.reportUnexpectedError(
					new Error(`endMediaCallIfPresent: bridge reported an unrecognized end outcome for ${callId}`),
					'call hangup fell back to signaling'
				)
			}
			return notified
		} catch (err) {
			const coded = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>
			if (coded.kind === 'invalid-argument' && coded.field === 'callId') return false
			throw err
		}
	})

export const makeCallAudioMethods = (ctx: SocketContext, media: CallMediaRouter, hooks: CallAudioMethodHooks = {}) => {
	/** Resolve the client once and push directly: per-packet `withClient` hops cost a tick each. */
	const withAudioClient = async <T>(
		bridgeMethod: keyof CallAudioBridgeClient,
		operation: (client: CallAudioBridgeClient) => T | Promise<T>
	): Promise<T> => ctx.withClient(client => operation(asCallAudioClient(client, bridgeMethod)))

	const openWriter = async <TWriter>(
		method: string,
		callId: string,
		requiredClientMethod: keyof CallAudioBridgeClient,
		buildWriter: (client: CallAudioBridgeClient, isClosed: () => boolean, close: () => void) => TWriter
	): Promise<TWriter> => {
		assertCallId(method, callId)
		const client = await ctx.withClient(c => asCallAudioClient(c, requiredClientMethod))
		// Same admission race as the pump: a writer registered after the
		// teardown drain would push into a closing client.
		if (ctx.isClosing?.() ?? false) {
			throw new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
		}
		let closed = false
		const invalidate = (): void => {
			closed = true
		}
		media.trackPump(callId, invalidate)
		const close = (): void => {
			if (closed) return
			closed = true
			media.untrackPump(callId, invalidate)
		}
		return buildWriter(client, () => closed, close)
	}

	const callAudioMethod = (
		method: keyof CallAudioBridgeClient,
		callId: string,
		action: (client: CallAudioBridgeClient) => Promise<void> | void
	): Promise<void> => {
		assertCallId(method, callId)
		return withAudioClient(method, action)
	}

	const registerSink = <TSink extends Function>(
		method: string,
		callId: string,
		sink: TSink,
		add: (callId: string, sink: TSink) => () => void
	): (() => void) => {
		assertCallId(method, callId)
		if (typeof sink !== 'function') {
			throw new Boom(`${method}: sink must be a function`, { statusCode: 400 })
		}
		return add(callId, sink)
	}

	return {
		/**
		 * Dial a peer with encoded audio. Returns the new call id; the handle
		 * stays dormant until the server acks the offer with a relay.
		 */
		dialCall: async (peerJid: string, audioFormat?: CallAudioFormat, withVideo?: boolean): Promise<string> => {
			if (typeof peerJid !== 'string' || peerJid.length === 0) {
				throw new Boom('dialCall: peerJid must be a non-empty string', { statusCode: 400 })
			}
			assertArgumentDomain('dialCall', 'audioFormat', audioFormat, AUDIO_FORMATS)
			// Normalized, not passed through: the pinned bridge takes the
			// format as required with no default, so an omitted promise would
			// fail there instead of meaning mlow.
			const format = audioFormat ?? 'mlow'
			const callId = await withAudioClient('dialCall', client => client.dialCall(peerJid, format, withVideo))
			media.setSourceFormat(callId, format)
			return callId
		},
		dialCallPcm: async (peerJid: string, withVideo?: boolean): Promise<string> => {
			if (typeof peerJid !== 'string' || peerJid.length === 0) {
				throw new Boom('dialCallPcm: peerJid must be a non-empty string', { statusCode: 400 })
			}
			const callId = await withAudioClient('dialCallPcm', client => client.dialCallPcm(peerJid, withVideo))
			media.setPcmSource(callId)
			return callId
		},
		/**
		 * Answer a ringing call with encoded audio. The offer arrives on the
		 * `call` event; the bridge holds it until it is answered, superseded,
		 * or missed.
		 */
		acceptCall: async (callId: string, audioFormat?: CallAudioFormat, withVideo?: boolean): Promise<string> => {
			assertCallId('acceptCall', callId)
			assertArgumentDomain('acceptCall', 'audioFormat', audioFormat, AUDIO_FORMATS)
			const format = audioFormat ?? 'mlow'
			const liveId = await withAudioClient('acceptCall', client => client.acceptCall(callId, format, withVideo))
			media.setSourceFormat(liveId, format)
			return liveId
		},
		acceptCallPcm: async (callId: string, withVideo?: boolean): Promise<string> => {
			assertCallId('acceptCallPcm', callId)
			const liveId = await withAudioClient('acceptCallPcm', client => client.acceptCallPcm(callId, withVideo))
			media.setPcmSource(liveId)
			return liveId
		},
		/**
		 * Push one encoded packet toward the peer. Resolves `true` when the
		 * packet entered the engine queue, `false` when it was shed under
		 * backpressure — the normal loss-tolerant answer, not an error.
		 *
		 * Pass ffmpeg-shaped packets straight through: on `opus-mlow` calls the
		 * engine rewrites Opus to the MLOW escape in flight, so
		 * pre-packetizing would rewrite twice and corrupt the TOC. A packet
		 * the escape cannot carry rejects naming `data` instead of queueing.
		 *
		 * The optional promise declares which grammar the packet carries. The
		 * bytes are opaque, so the declaration is checked against the format
		 * the call negotiated (recorded on accept/dial), not against the
		 * payload: a wrong-grammar push fails here with a 400 instead of
		 * dying silently in the engine and shedding forever. Omitted means
		 * the caller takes responsibility, as before.
		 */
		pushCallAudio: async (callId: string, data: Uint8Array, audioFormat?: CallAudioFormat): Promise<boolean> => {
			assertCallId('pushCallAudio', callId)
			assertAudioPacket('pushCallAudio', data)
			assertSourceMode('pushCallAudio', media, callId, 'encoded')
			assertArgumentDomain('pushCallAudio', 'audioFormat', audioFormat, AUDIO_FORMATS)
			assertPushFormat('pushCallAudio', media, callId, audioFormat)
			return withAudioClient('callPushAudio', client => client.callPushAudio(callId, data))
		},
		pushCallPcm: async (callId: string, samples: Int16Array): Promise<boolean> => {
			assertCallId('pushCallPcm', callId)
			assertPcmSamples('pushCallPcm', samples)
			assertSourceMode('pushCallPcm', media, callId, 'pcm')
			return withAudioClient('callPushPcm16', client => client.callPushPcm16(callId, samples))
		},
		/**
		 * Push one encoded H.264 Annex-B access unit toward the peer.
		 * `true` on queue, `false` on shed — the same loss-tolerant answer
		 * as audio, at video cadence.
		 */
		pushCallVideo: async (callId: string, data: Uint8Array): Promise<boolean> => {
			assertCallId('pushCallVideo', callId)
			assertVideoPacket('pushCallVideo', data)
			return withAudioClient('callPushVideo', client => client.callPushVideo(callId, data))
		},
		/** End a live call. The local side is down whatever comes back. */
		endCall: (callId: string): Promise<CallEndResult> => {
			assertCallId('endCall', callId)
			return withAudioClient('endCall', client => client.endCall(callId).then(normalizeCallEndResult))
				.then(result => {
					// Resolving means the local side is down whatever the
					// outcome, so the socket forgets the call too. A rejection
					// keeps the entry: the hangup may still be retried.
					hooks.onCallEnded?.(callId)
					return result
				})
				.finally(() => media.stopCall(callId))
		},
		/**

		 * Acquire a sync writer for one live call, for encoders and capture
		 * paths that push outside the pump. The client resolves once here;
		 * every `tryWrite` after that is a synchronous bridge call with no
		 * async hop. Invalidated by `close`, by `ended`, and by teardown —
		 * ahead of the client being freed, on the same tracking pumps use.
		 */
		openCallAudioWriter: (callId: string): Promise<CallAudioWriter> =>
			openWriter('openCallAudioWriter', callId, 'callPushAudio', (client, isClosed, close) => ({
				tryWrite: (packet, audioFormat) => {
					assertAudioPacket('tryWrite', packet)
					assertSourceMode('tryWrite', media, callId, 'encoded')
					assertArgumentDomain('tryWrite', 'audioFormat', audioFormat, AUDIO_FORMATS)
					assertPushFormat('tryWrite', media, callId, audioFormat)
					if (isClosed()) return false
					return client.callPushAudio(callId, packet)
				},
				close
			})),
		openCallPcmWriter: (callId: string): Promise<CallPcmWriter> =>
			openWriter('openCallPcmWriter', callId, 'callPushPcm16', (client, isClosed, close) => ({
				tryWrite: samples => {
					assertPcmSamples('tryWrite', samples)
					assertSourceMode('tryWrite', media, callId, 'pcm')
					if (isClosed()) return false
					return client.callPushPcm16(callId, samples)
				},
				close
			})),
		/**
		 * Acquire a sync writer for H.264 access units, same contract as the
		 * audio writer: client resolved once, synchronous pushes after that,
		 * invalidated by close, `ended` and teardown.
		 */
		openCallVideoWriter: (callId: string): Promise<CallVideoWriter> =>
			openWriter('openCallVideoWriter', callId, 'callPushVideo', (client, isClosed, close) => ({
				tryWrite: packet => {
					assertVideoPacket('tryWrite', packet)
					if (isClosed()) return false
					return client.callPushVideo(callId, packet)
				},
				close
			})),
		/** Mute or unmute the mic on a live call. */
		setCallMuted: (callId: string, muted: boolean): Promise<void> =>
			callAudioMethod('setCallMuted', callId, client => client.setCallMuted(callId, muted)),
		/** Media counters for one call; readable after the call ends. */
		getCallMediaStats: (callId: string): Promise<CallMediaStats> => {
			assertCallId('getCallMediaStats', callId)
			return withAudioClient('getCallMediaStats', client =>
				normalizeCallMediaStats('getCallMediaStats', client.getCallMediaStats(callId))
			)
		},
		/**
		 * Bridge pump depths for one call: queued packets per direction with
		 * capacities. The readout the shed count alone cannot give — a full
		 * outbound queue with no relay-allocated event means the media plane
		 * never came up, not congestion.
		 */
		getCallAudioBuffer: (callId: string): Promise<CallAudioBuffer> => {
			assertCallId('getCallAudioBuffer', callId)
			return withAudioClient('getCallAudioBuffer', client =>
				normalizeCallAudioBuffer('getCallAudioBuffer', client.getCallAudioBuffer(callId))
			)
		},
		/**
		 * The audio promise a call negotiated, recorded on accept/dial
		 * success. `undefined` means the call was never negotiated through
		 * this socket or already ended. Pure registration read: it never
		 * reaches the bridge, so there is no capability probe and no 501.
		 */
		getCallAudioFormat: (callId: string): CallAudioFormat | undefined => {
			assertCallId('getCallAudioFormat', callId)
			return media.getSourceFormat(callId)
		},
		/** Every call the bridge currently holds a handle for. */
		getActiveCalls: (): Promise<ActiveCall[]> => withAudioClient('getActiveCalls', client => client.getActiveCalls()),
		/**
		 * Start sending our camera on a live call: attaches the video
		 * endpoints and offers the upgrade to the peer. Pure encoded H.264
		 * Annex-B — the bridge never touches pixels.
		 */
		startCallVideo: (callId: string): Promise<void> =>
			callAudioMethod('startCallVideo', callId, client => client.startCallVideo(callId)),
		/** Stop our video direction. Audio is untouched; idempotent. */
		stopCallVideo: (callId: string): Promise<void> =>
			callAudioMethod('stopCallVideo', callId, client => client.stopCallVideo(callId)),
		/**
		 * Accept the peer's video upgrade request: attaches the endpoints
		 * and answers the handshake. The request token never crosses to JS.
		 */
		acceptCallVideo: (callId: string): Promise<void> =>
			callAudioMethod('acceptCallVideo', callId, client => client.acceptCallVideo(callId)),
		/** Re-add our stopped video direction without a second handshake. */
		resumeCallVideo: (callId: string): Promise<void> =>
			callAudioMethod('resumeCallVideo', callId, client => client.resumeCallVideo(callId)),
		/**
		 * Re-emit the video upgrade request for a live call. Arms the
		 * direction-local timeout and leaves the endpoints attached.
		 */
		retryCallVideoUpgrade: (callId: string): Promise<void> =>
			callAudioMethod('retryCallVideoUpgrade', callId, client => client.retryCallVideoUpgrade(callId)),
		/** Read the core's direction-local video state and timeout contract. */
		getCallVideoDiagnostics: (callId: string): Promise<CallVideoDiagnostics> => {
			assertCallId('getCallVideoDiagnostics', callId)
			return withAudioClient('getCallVideoDiagnostics', client =>
				normalizeCallVideoDiagnostics('getCallVideoDiagnostics', client.getCallVideoDiagnostics(callId))
			)
		},
		/**
		 * Ask the peer for a video keyframe. The bridge reports an unknown
		 * id rather than dropping it, so a lost frame during teardown still
		 * surfaces instead of vanishing. Nothing comes back on success.
		 */
		requestCallKeyframe: async (callId: string, urgency?: CallKeyframeUrgency): Promise<void> => {
			assertCallId('requestCallKeyframe', callId)
			assertArgumentDomain('requestCallKeyframe', 'urgency', urgency, KEYFRAME_URGENCIES)
			return withAudioClient('requestCallKeyframe', client => {
				client.requestCallKeyframe(callId, urgency ?? 'coalesced')
			})
		},
		/**
		 * Install the host's relay channel constructor. The bridge implements
		 * the core's relay transport over it and never touches WebRTC itself;
		 * pass the production rtc-tunnel provider or the explicit mock provider.
		 */
		setRelayTransportProvider: (provider: CallRelayTransportProvider): Promise<void> => {
			if (typeof provider !== 'object' || provider === null || typeof provider.createRelayConnection !== 'function') {
				throw new Boom('setRelayTransportProvider: provider must carry createRelayConnection', {
					statusCode: 400
				})
			}
			return withAudioClient('setRelayTransportProvider', client => {
				client.setRelayTransportProvider(provider)
			})
		},
		/**
		 * Register a per-call encoded-audio sink. Frames arrive at voice
		 * cadence on the bridge pump: each carries one owned encoded packet,
		 * valid after the callback returns and shared with the call's other
		 * sinks, so decode synchronously and never modify the bytes. The
		 * returned function unregisters the sink; `ended` and socket teardown
		 * unregister it automatically.
		 *
		 * Pure registration, unlike the methods above: it never reaches the
		 * bridge, so there is no capability probe and no 501 — on a bridge
		 * without the audio domain the sink simply never fires.
		 */
		onCallAudio: (callId: string, sink: CallAudioSink): (() => void) =>
			registerSink('onCallAudio', callId, sink, media.addAudioSink),
		onCallPcm: (callId: string, sink: CallPcmSink): (() => void) =>
			registerSink('onCallPcm', callId, sink, media.addPcmSink),
		/**
		 * Register a per-call video sink. Access units arrive through the
		 * bridge pump under the same synchronous contract as audio; the
		 * returned function unregisters the sink, and `ended` plus teardown
		 * unregister it automatically.
		 */
		onCallVideo: (callId: string, sink: CallVideoSink): (() => void) =>
			registerSink('onCallVideo', callId, sink, media.addVideoSink),
		/**
		 * Run a packet source into a live call until it is spent, aborted, or
		 * the call ends. Resolves the client once, then pushes directly; the
		 * pump stops with the call on `ended` or socket teardown. The source
		 * is a `next()` object or any async iterable of packets. A declared
		 * `options.audioFormat` is checked against the negotiated promise up
		 * front, so a wrong-grammar source fails here instead of shedding
		 * forever once the pulls start.
		 */
		startCallAudioPump: async (
			callId: string,
			source: CallAudioSourceInput,
			options: CallAudioPumpOptions = {}
		): Promise<CallAudioPump> => {
			assertCallId('startCallAudioPump', callId)
			const packets = asCallAudioPacketSource('startCallAudioPump', source)
			assertArgumentDomain('startCallAudioPump', 'audioFormat', options.audioFormat, AUDIO_FORMATS)
			assertPushFormat('startCallAudioPump', media, callId, options.audioFormat)
			const client = await ctx.withClient(c => asCallAudioClient(c, 'callPushAudio'))
			// Rechecked after admission: teardown may have started — and its
			// drain snapshotted — while the client promise was in flight. What
			// follows is synchronous, so no second interleaving is possible.
			if (ctx.isClosing?.() ?? false) {
				throw new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
			}
			const pump = startCallAudioPump(data => client.callPushAudio(callId, data), packets, options)
			media.trackPump(callId, pump.stop, pump.done)
			// A spent or failed pump only drops its own tracking: sibling
			// pumps and sinks belong to the call, and only `ended` or teardown
			// ends those. The rejection stays on `pump.done` for the caller.
			void pump.done.then(
				() => media.untrackPump(callId, pump.stop),
				() => media.untrackPump(callId, pump.stop)
			)
			return pump
		}
	}
}
