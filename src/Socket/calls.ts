/**
 * Encoded-audio voice calls over the bridge `client-calls-audio` domain.
 *
 * The bridge owns the media engine (accept/dial/push/stats/hangup plus the
 * relay transport); this layer owns JS ergonomics on top of it: per-call
 * audio sinks, a source pump with shed accounting, and socket-independent
 * silence/file sources for tests that have no microphone.
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
 * `inboundPipeDropped` stats counters instead.
 */

import { Boom } from '../Utils/boom.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type {
	ActiveCall,
	CallAudioFormat,
	CallAudioFrame,
	CallAudioPacketSource,
	CallAudioPumpStats,
	CallAudioSink,
	CallAudioSourceInput,
	CallEndResult,
	CallMediaEvent,
	CallMediaStats
} from '../Types/Call.ts'
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
	acceptCall(callId: string, audioFormat?: CallAudioFormat | null): Promise<string>
	dialCall(peer: string, audioFormat?: CallAudioFormat | null): Promise<string>
	callPushAudio(callId: string, data: Uint8Array): boolean
	endCall(callId: string): Promise<CallEndResult>
	setCallMuted(callId: string, muted: boolean): Promise<void>
	getCallMediaStats(callId: string): CallMediaStats
	getActiveCalls(): ActiveCall[]
	setRelayTransportProvider(provider: CallRelayTransportProvider): void
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

const AUDIO_FORMATS = ['mlow', 'opus', undefined] as const

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

const assertAudioPacket = (method: string, data: Uint8Array): void => {
	if (!(data instanceof Uint8Array) || data.length === 0) {
		throw new Boom(`${method}: data must be a non-empty Uint8Array`, { statusCode: 400 })
	}
}

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

/** Reject a stats object the bridge shaped unexpectedly instead of forwarding NaNs. */
const normalizeCallMediaStats = (method: string, raw: unknown): CallMediaStats => {
	if (typeof raw !== 'object' || raw === null) {
		throw new Boom(`${method}: bridge returned no media stats object`, { statusCode: 500 })
	}
	const record = raw as Record<string, unknown>
	const stats = {} as Record<string, number>
	for (const field of STAT_FIELDS) {
		const value = record[field]
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Boom(`${method}: bridge media stats field ${field} is not a number`, { statusCode: 500 })
		}
		stats[field] = value
	}
	return stats as CallMediaStats
}

// ─────────────────────────────────────────────────────────────────────────────
// Media router: bridge callbacks in, per-call sinks and socket events out
// ─────────────────────────────────────────────────────────────────────────────

export interface CallMediaRouterDeps {
	emitMediaEvent: (event: CallMediaEvent) => void
	reportError: (err: unknown, msg: string) => void
}

export interface CallMediaRouter {
	/** Register a per-call audio sink; the returned function unregisters it. */
	addAudioSink(callId: string, sink: CallAudioSink): () => void
	/** Bridge `onCallAudio` entry point. Never throws: a throw here would stop the bridge pump. */
	routeAudioFrame(frame: CallAudioFrame): void
	/** Bridge `onCallEvent` entry point. Emits `call.media`; `ended` also stops the call. */
	routeMediaEvent(event: CallMediaEvent): void
	/** Track a pump stopper so `ended` / teardown ends it with the call. */
	trackPump(callId: string, stop: () => void): void
	/** Stop a call's pumps and drop its sinks. */
	stopCall(callId: string): void
	/** Stop everything; socket teardown calls this while the client is still usable. */
	stopAll(): void
}

const isAudioFrame = (frame: unknown): frame is CallAudioFrame => {
	if (typeof frame !== 'object' || frame === null) return false
	const record = frame as Record<string, unknown>
	return (
		typeof record.callId === 'string' &&
		record.data instanceof Uint8Array &&
		(record.codec === 'mlow' || record.codec === 'opus')
	)
}

const isMediaEvent = (event: unknown): event is CallMediaEvent => {
	if (typeof event !== 'object' || event === null) return false
	const record = event as Record<string, unknown>
	return typeof record.callId === 'string' && typeof record.kind === 'string'
}

export const makeCallMediaRouter = ({ emitMediaEvent, reportError }: CallMediaRouterDeps): CallMediaRouter => {
	const sinks = new Map<string, Set<CallAudioSink>>()
	const pumps = new Map<string, Set<() => void>>()

	const stopCall = (callId: string): void => {
		const tracked = pumps.get(callId)
		if (tracked) {
			pumps.delete(callId)
			for (const stop of tracked) {
				try {
					stop()
				} catch (err) {
					reportError(err, `stopping a call audio pump for ${callId}`)
				}
			}
		}
		sinks.delete(callId)
	}

	return {
		addAudioSink(callId, sink) {
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
		routeAudioFrame(frame) {
			if (!isAudioFrame(frame)) {
				reportError(new Error('bridge delivered a malformed call audio frame'), 'call audio frame dropped')
				return
			}
			const live = sinks.get(frame.callId)
			if (!live) return
			// The frame is handed through, never copied: the bridge already
			// paid the one copy out of linear memory, and a sink that needs to
			// keep bytes copies them itself before returning.
			for (const sink of live) {
				try {
					sink(frame)
				} catch (err) {
					reportError(err, `call audio sink for ${frame.callId}`)
				}
			}
		},
		routeMediaEvent(event) {
			if (!isMediaEvent(event)) {
				reportError(new Error('bridge delivered a malformed call media event'), 'call media event dropped')
				return
			}
			if (event.kind === 'ended') stopCall(event.callId)
			emitMediaEvent(event)
		},
		trackPump(callId, stop) {
			let set = pumps.get(callId)
			if (!set) {
				set = new Set()
				pumps.set(callId, set)
			}
			set.add(stop)
		},
		stopCall,
		stopAll() {
			// Deleting the current key while iterating a Map is safe; each
			// stopCall removes exactly the key being visited.
			for (const callId of pumps.keys()) stopCall(callId)
			sinks.clear()
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

export interface SilenceCallAudioSourceOptions {
	/** Gap between packets. Defaults to 60 ms, the MLOW frame cadence. */
	intervalMs?: number
	/** Total packets before the source is spent; default runs until stopped. */
	packets?: number
	/** Packet bytes; defaults to the MLOW silence token above. */
	packet?: Uint8Array
}

export const makeSilenceCallAudioSource = (options: SilenceCallAudioSourceOptions = {}): CallAudioPacketSource => {
	const intervalMs = options.packets === 0 ? 0 : (options.intervalMs ?? 60)
	const total = options.packets ?? Number.POSITIVE_INFINITY
	const packet = options.packet ?? MLOW_SILENCE_PACKET
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
			// A fresh view per tick: the push copies synchronously, but the
			// caller owns the packet afterwards and must not see later ticks
			// overwrite it.
			return packet.slice()
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

export interface CallAudioPumpOptions {
	/** AbortSignal that stops the pump; stopping is silent, never an error. */
	signal?: AbortSignal
	/** Called per shed packet with the running shed total. */
	onShed?: (shedTotal: number) => void
}

export interface CallAudioPump {
	/** Resolves with the moved totals when the source is spent or the pump stops. */
	done: Promise<CallAudioPumpStats>
	/** Stop pulling; in-flight `done` resolves with the totals so far. */
	stop: () => void
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
				}
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
	const stats: CallAudioPumpStats = { pushed: 0, shed: 0 }
	const source = asCallAudioPacketSource('startCallAudioPump', input)

	const stop = (): void => {
		stopped = true
		options.signal?.removeEventListener('abort', onAbort as () => void)
	}
	if (options.signal?.aborted) stopped = true
	if (!stopped && options.signal) {
		onAbort = () => stop()
		options.signal.addEventListener('abort', onAbort, { once: true })
	}

	const done = (async (): Promise<CallAudioPumpStats> => {
		for (;;) {
			const packet = await source.next()
			if (packet === null || stopped) break
			assertAudioPacket('startCallAudioPump: source', packet)
			if (await push(packet)) {
				stats.pushed++
			} else {
				stats.shed++
				options.onShed?.(stats.shed)
			}
		}
		stop()
		return { ...stats }
	})()

	return { done, stop }
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket methods
// ─────────────────────────────────────────────────────────────────────────────

export const makeCallAudioMethods = (ctx: SocketContext, media: CallMediaRouter) => {
	/** Resolve the client once and push directly: per-packet `withClient` hops cost a tick each. */
	const withAudioClient = async <T>(
		bridgeMethod: keyof CallAudioBridgeClient,
		operation: (client: CallAudioBridgeClient) => T | Promise<T>
	): Promise<T> => ctx.withClient(client => operation(asCallAudioClient(client, bridgeMethod)))

	return {
		/**
		 * Dial a peer with encoded audio. Returns the new call id; the handle
		 * stays dormant until the server acks the offer with a relay.
		 */
		dialCall: async (peerJid: string, audioFormat?: CallAudioFormat): Promise<string> => {
			if (typeof peerJid !== 'string' || peerJid.length === 0) {
				throw new Boom('dialCall: peerJid must be a non-empty string', { statusCode: 400 })
			}
			assertArgumentDomain('dialCall', 'audioFormat', audioFormat, AUDIO_FORMATS)
			return withAudioClient('dialCall', client => client.dialCall(peerJid, audioFormat ?? null))
		},
		/**
		 * Answer a ringing call with encoded audio. The offer arrives on the
		 * `call` event; the bridge holds it until it is answered, superseded,
		 * or missed.
		 */
		acceptCall: async (callId: string, audioFormat?: CallAudioFormat): Promise<string> => {
			assertCallId('acceptCall', callId)
			assertArgumentDomain('acceptCall', 'audioFormat', audioFormat, AUDIO_FORMATS)
			return withAudioClient('acceptCall', client => client.acceptCall(callId, audioFormat ?? null))
		},
		/**
		 * Push one encoded packet toward the peer. Resolves `true` when the
		 * packet entered the engine queue, `false` when it was shed under
		 * backpressure — the normal loss-tolerant answer, not an error.
		 */
		pushCallAudio: async (callId: string, data: Uint8Array): Promise<boolean> => {
			assertCallId('pushCallAudio', callId)
			assertAudioPacket('pushCallAudio', data)
			return withAudioClient('callPushAudio', client => client.callPushAudio(callId, data))
		},
		/** End a live call. The local side is down whatever comes back. */
		endCall: (callId: string): Promise<CallEndResult> => {
			assertCallId('endCall', callId)
			return withAudioClient('endCall', client => client.endCall(callId)).finally(() => media.stopCall(callId))
		},
		/** Mute or unmute the mic on a live call. */
		setCallMuted: (callId: string, muted: boolean): Promise<void> => {
			assertCallId('setCallMuted', callId)
			return withAudioClient('setCallMuted', client => client.setCallMuted(callId, muted))
		},
		/** Media counters for one call; readable after the call ends. */
		getCallMediaStats: (callId: string): Promise<CallMediaStats> => {
			assertCallId('getCallMediaStats', callId)
			return withAudioClient('getCallMediaStats', client =>
				normalizeCallMediaStats('getCallMediaStats', client.getCallMediaStats(callId))
			)
		},
		/** Every call the bridge currently holds a handle for. */
		getActiveCalls: (): Promise<ActiveCall[]> => withAudioClient('getActiveCalls', client => client.getActiveCalls()),
		/**
		 * Install the host's relay channel constructor. The bridge implements
		 * the core's relay transport over it and never touches WebRTC itself;
		 * pass the bridge's own `createRtcRelayTransportProvider` result or a
		 * custom constructor keeping the same contract.
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
		 * Register a per-call decoded-audio sink. Frames arrive at voice
		 * cadence on the bridge pump: decode or copy before returning, and
		 * never retain the view. The returned function unregisters the sink;
		 * `ended` and socket teardown unregister it automatically.
		 */
		onCallAudio: (callId: string, sink: CallAudioSink): (() => void) => {
			assertCallId('onCallAudio', callId)
			if (typeof sink !== 'function') {
				throw new Boom('onCallAudio: sink must be a function', { statusCode: 400 })
			}
			return media.addAudioSink(callId, sink)
		},
		/**
		 * Run a packet source into a live call until it is spent, aborted, or
		 * the call ends. Resolves the client once, then pushes directly; the
		 * pump stops with the call on `ended` or socket teardown. The source
		 * is a `next()` object or any async iterable of packets.
		 */
		startCallAudioPump: async (
			callId: string,
			source: CallAudioSourceInput,
			options: CallAudioPumpOptions = {}
		): Promise<CallAudioPump> => {
			assertCallId('startCallAudioPump', callId)
			const packets = asCallAudioPacketSource('startCallAudioPump', source)
			const client = await ctx.withClient(c => asCallAudioClient(c, 'callPushAudio'))
			const pump = startCallAudioPump(data => client.callPushAudio(callId, data), packets, options)
			media.trackPump(callId, pump.stop)
			// A spent or failed pump holds no call resources: drop its
			// tracking either way. Both branches stop the call's pumps, and
			// the rejection stays on `pump.done` for the caller.
			void pump.done.then(
				() => media.stopCall(callId),
				() => media.stopCall(callId)
			)
			return pump
		}
	}
}
