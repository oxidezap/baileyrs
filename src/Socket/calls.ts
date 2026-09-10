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
	CallAudioStopReason,
	CallAudioTiming,
	CallAudioWriter,
	CallEndResult,
	CallMediaEvent,
	CallMediaStats,
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
	acceptCall(callId: string, audioFormat: CallAudioFormat): Promise<string>
	dialCall(peer: string, audioFormat: CallAudioFormat): Promise<string>
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

interface TrackedCallPump {
	stop: (reason?: CallAudioStopReason) => void
	done?: Promise<unknown>
}

export interface CallMediaRouter {
	/** Register a per-call audio sink; the returned function unregisters it. */
	addAudioSink(callId: string, sink: CallAudioSink): () => void
	/** Bridge `onCallAudio` entry point. Never throws: a throw here would stop the bridge pump. */
	routeAudioFrame(frame: CallAudioFrame): void
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

const isAudioFrame = (frame: unknown): frame is CallAudioFrame => {
	if (typeof frame !== 'object' || frame === null) return false
	const record = frame as Record<string, unknown>
	// Every field the type promises, checked: a partial or version-skewed
	// object must not reach typed sinks with undefined fields.
	return (
		typeof record.callId === 'string' &&
		record.data instanceof Uint8Array &&
		(record.codec === 'mlow' || record.codec === 'opus') &&
		typeof record.payloadType === 'number' &&
		typeof record.sequenceNumber === 'number' &&
		typeof record.timestamp === 'number' &&
		typeof record.marker === 'boolean'
	)
}

const MEDIA_EVENT_KINDS: readonly CallMediaEvent['kind'][] = [
	'relay-allocated',
	'relay-allocate-failed',
	'relay-allocate-timed-out',
	'media-setup-failed',
	'audio-codec-switched',
	'audio-codec-source-fixed',
	'ended'
]

const isMediaEvent = (event: unknown): event is CallMediaEvent => {
	if (typeof event !== 'object' || event === null) return false
	const record = event as Record<string, unknown>
	// The kind is closed: a version-skewed spelling must not publish as the
	// union the consumers were promised, and a misspelled terminal kind must
	// not skip the stop below by matching nothing.
	return (
		typeof record.callId === 'string' &&
		typeof record.kind === 'string' &&
		(MEDIA_EVENT_KINDS as readonly string[]).includes(record.kind)
	)
}

export const makeCallMediaRouter = ({ emitMediaEvent, reportError }: CallMediaRouterDeps): CallMediaRouter => {
	const sinks = new Map<string, Set<CallAudioSink>>()
	const pumps = new Map<string, Set<TrackedCallPump>>()
	// Pumps stopped but whose `done` has not settled: `drainAll` waits for
	// these, so ending a call and then the socket cannot strand source
	// cleanup behind a teardown that already resolved. Entries leave when
	// their `done` settles; only a release that never settles pins one, which
	// is a contract-violating source, not a router leak.
	const settling = new Set<Promise<unknown>>()

	const settleEntry = (entry: TrackedCallPump): void => {
		if (entry.done === undefined) return
		const waited = entry.done.then(
			() => undefined,
			() => undefined
		)
		settling.add(waited)
		void waited.finally(() => settling.delete(waited))
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
		sinks.delete(callId)
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
		sinks.clear()
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
			// The frame object is handed through, never re-wrapped: the bridge
			// already copied the encoded bytes out of linear memory once, so
			// what arrives here is an owned buffer, not a borrowed view. It is
			// shared between the call's sinks — do not modify it; copy only
			// to mutate or hand ownership elsewhere.
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
			stopAllWith('socket-closed')
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
	const closeHandle = async (): Promise<void> => {
		if (closed) return
		closed = true
		try {
			await handle.close()
		} catch {
			// Teardown races a failed open the same way: the handle is gone
			// either way, and close stays idempotent.
		}
	}
	return {
		readInto: async (target: Uint8Array, signal?: AbortSignal): Promise<number | null> => {
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
	 * Pull pacing. Defaults to `{ mode: 'source' }`: pull as fast as the
	 * source yields. Pair `{ mode: 'clock' }` with an unpaced source
	 * (`intervalMs: 0`) — pacing twice just adds the two cadences together.
	 */
	timing?: CallAudioTiming
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
	// Wakes the pull currently parked in `source.next()`, if any. Replaced
	// every iteration: a shared stop promise would pile one pair of reactions
	// per raced pull onto itself and hold them for the whole call, while a
	// per-iteration promise goes out of scope with the race that settled it.
	let wakeParkedPull: (() => void) | undefined
	const stats = { pushed: 0, shed: 0 }
	const source = asCallAudioPacketSource('startCallAudioPump', input)
	const clockMs = options.timing?.mode === 'clock' ? options.timing.packetDurationMs : undefined
	if (clockMs !== undefined && (!Number.isFinite(clockMs) || clockMs <= 0)) {
		throw new Boom('startCallAudioPump: timing.packetDurationMs must be a finite number > 0', { statusCode: 400 })
	}

	const stop = (reason: CallAudioStopReason = 'stopped'): void => {
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
		if (reason === 'socket-closed') skipReleaseWait = true
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
			if (!skipReleaseWait) await releaseSettled
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
 * (`local-only`): the caller falls back to plain signaling so the remote side
 * still hears the hangup. An unrecognized outcome shape also reads as not
 * told and falls back, reported rather than trusted: the bridge enum is
 * non-exhaustive, so failing closed would break future notified outcomes,
 * while an extra stanza is recoverable. Anything else throws, so a failed
 * hangup keeps its routing context for the retry instead of reading as a
 * call that is gone.
 */
export const endMediaCallIfPresent = async (ctx: SocketContext, callId: string): Promise<boolean> =>
	ctx.withClient(async client => {
		const endCall = (client as unknown as { endCall?: unknown }).endCall
		if (typeof endCall !== 'function') return false
		try {
			const outcome = (await (endCall as (this: unknown, id: string) => Promise<CallEndResult>).call(
				client,
				callId
			)) as CallEndResult
			const notified =
				outcome?.outcome === 'peer-notified' ||
				outcome?.outcome === 'partly-notified' ||
				outcome?.outcome === 'already-ended'
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
			// Normalized, not passed through: the pinned bridge takes the
			// format as required with no default, so an omitted promise would
			// fail there instead of meaning mlow.
			return withAudioClient('dialCall', client => client.dialCall(peerJid, audioFormat ?? 'mlow'))
		},
		/**
		 * Answer a ringing call with encoded audio. The offer arrives on the
		 * `call` event; the bridge holds it until it is answered, superseded,
		 * or missed.
		 */
		acceptCall: async (callId: string, audioFormat?: CallAudioFormat): Promise<string> => {
			assertCallId('acceptCall', callId)
			assertArgumentDomain('acceptCall', 'audioFormat', audioFormat, AUDIO_FORMATS)
			return withAudioClient('acceptCall', client => client.acceptCall(callId, audioFormat ?? 'mlow'))
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
			return withAudioClient('endCall', client => client.endCall(callId))
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
		openCallAudioWriter: async (callId: string): Promise<CallAudioWriter> => {
			assertCallId('openCallAudioWriter', callId)
			const client = await ctx.withClient(c => asCallAudioClient(c, 'callPushAudio'))
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
			return {
				tryWrite: packet => {
					assertAudioPacket('tryWrite', packet)
					if (closed) return false
					return client.callPushAudio(callId, packet)
				},
				close: () => {
					if (closed) return
					closed = true
					media.untrackPump(callId, invalidate)
				}
			}
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
