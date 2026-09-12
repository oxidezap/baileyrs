export type WACallUpdateType =
	| 'offer'
	| 'ringing'
	| 'preaccept'
	| 'transport'
	| 'relaylatency'
	| 'timeout'
	| 'reject'
	| 'accept'
	| 'terminate'

export type WACallEvent = {
	chatId: string
	from: string
	/** Action-level call creator; may differ from `chatId` for companion-device signaling. */
	callCreator?: string
	callerPn?: string
	isGroup?: boolean
	groupJid?: string
	id: string
	date: Date
	isVideo?: boolean
	status: WACallUpdateType
	offline: boolean
	latencyMs?: number
	// ── baileyrs additions: bridge surfaces these fields, upstream Baileys
	// today only carries the subset above. Kept optional + named after the
	// bridge fields so consumers using upstream's type don't break.

	/** ISO country code on `offer` (e.g. `"BR"`, `"US"`). */
	callerCountryCode?: string
	/** Device class string from the offer (e.g. `"web"`, `"mobile"`). */
	deviceClass?: string
	/** `true` for group-call invites the recipient can join late. */
	joinable?: boolean
	/** Codec names advertised on the offer (e.g. `["opus", "g722"]`). */
	audio?: string[]
	/** Total call duration in **seconds** — only on `terminate`. */
	duration?: number
	/** Active audio-stream duration in **seconds** — only on `terminate`. */
	audioDuration?: number
	/** Stanza-level `id` (distinct from `id`/`callId`). */
	stanzaId?: string
	/** Pushname on the call offer. */
	notify?: string
	/** Platform string from the offer (e.g. `"web"`, `"smbi"`). */
	platform?: string
	/** WhatsApp client version on the caller side. */
	version?: string
	/**
	 * Reject/terminate reason string from the bridge (e.g. `"timeout"`).
	 * A `terminate` carrying `"timeout"` surfaces as status `timeout`,
	 * matching upstream Baileys.
	 */
	reason?: string
	/**
	 * Camera rotation announced on the stanza's `<video>` child (`0..3`).
	 * Only an `offer` or `accept` carries one.
	 */
	videoOrientation?: number
}

/**
 * Encoded-audio codec promise for a call.
 *
 * The encoded grammar supplied by the local application. `mlow` is the
 * proprietary payload, `opus` is native 16 kHz Opus, and `opus-mlow` is CELT
 * Opus that the bridge rewrites to the MLOW escape.
 */
export type CallAudioFormat = 'mlow' | 'opus' | 'opus-mlow'

/**
 * One encoded audio packet for a live call, as the engine received it: the
 * codec payload plus its RTP metadata. The buffer is owned, not a borrowed
 * view, and it is shared between the call's listeners, so never modify it.
 * `codec` names the payload family; `format` is the actual per-frame format
 * reported by the bridge.
 */
export type CallAudioFrame = {
	callId: string
	data: Uint8Array
	codec: 'mlow' | 'opus'
	format: CallAudioFormat
	payloadType: number
	sequenceNumber: number
	timestamp: number
	marker: boolean
}

/** One decoded mono 16 kHz signed 16-bit PCM frame from a live call. */
export type CallPcmFrame = {
	callId: string
	data: Int16Array
}

/**
 * Lifecycle and media diagnostics for one live call. Only the encoded-audio
 * 1:1 subset crosses in this slice; group, reaction and RTCP events belong to
 * later slices.
 */
export type CallMediaEventKind =
	| 'relay-allocated'
	| 'relay-allocate-failed'
	| 'relay-allocate-timed-out'
	| 'media-setup-failed'
	| 'audio-codec-switched'
	| 'audio-codec-source-fixed'
	| 'video-upgrade-requested'
	| 'video-state-changed'
	| 'ended'

export type CallMediaEvent = {
	callId: string
	kind: CallMediaEventKind
	/** `relay-allocate-failed`: the STUN error code. */
	code?: number
	/** `media-setup-failed`: why the media plane never built. */
	detail?: string
	/** `audio-codec-switched`: the grammar in use before the switch. */
	from?: string
	/** `audio-codec-switched`: the grammar now in use. */
	to?: string
	/** `audio-codec-source-fixed`: what the application keeps sending. */
	sending?: string
	/** `audio-codec-source-fixed`: what the peer says it speaks. */
	peerExpects?: string
	/** `ended`: the call's final media counters, so forensics needs no follow-up read. */
	stats?: CallMediaStats
	/** `video-state-changed`, `video-upgrade-requested`: the wire number. */
	state?: number
}

/**
 * One encoded video access unit for a live call: an Annex-B H.264 payload with
 * its keyframe flag, clockwise rotation (0=0, 1=270, 2=180, 3=90 deg) and
 * 90 kHz RTP timestamp.
 */
export type CallVideoFrame = {
	callId: string
	data: Uint8Array
	keyframe: boolean
	orientation: number
	timestamp: number
}

/**
 * The core's direction-local video negotiation state for one live call.
 * `selfState` and `peerState` are the wire numbers from VideoState;
 * `upgradeTimeoutMs` is the remaining window before a pending request expires.
 */
export type CallVideoDiagnostics = {
	selfState: number
	peerState: number
	upgradeTimeoutMs: number
}

/**
 * How hard to ask the peer for a video keyframe. `coalesced` folds into an
 * existing in-flight request; `immediate` asks right away.
 */
export type CallKeyframeUrgency = 'coalesced' | 'immediate'

/**
 * Per-access-unit sink for one live call's peer video. Runs synchronously per
 * access unit; a returned promise is not observed.
 */
export type CallVideoSink = (frame: CallVideoFrame) => void

/**
 * An acquired-once encoded video writer for one live call. For camera pipelines
 * that push H.264 access units directly: resolve the client once, then send
 * synchronously with no per-packet async hop.
 */
export type CallVideoWriter = {
	/**
	 * Queue one H.264 access unit. True means accepted locally, false means
	 * shed under backpressure or closed.
	 */
	tryWrite(packet: Uint8Array): boolean
	/** Invalidate the writer without ending the call. */
	close(): void
}

/**
 * How ending a call through its handle went. The local side is down in every
 * case; this reports how much of the peer was told.
 */
export type CallEndResult =
	| { outcome: 'peer-notified' }
	| { outcome: 'partly-notified'; notified: number; unconfirmed: number }
	| { outcome: 'local-only'; failure: string }
	| { outcome: 'already-ended' }

/** One live call the bridge currently holds a handle for. */
export type ActiveCall = {
	callId: string
	peerJid: string
}

/**
 * Media counters for one call, mirroring the core's `CallMediaStats`.
 * All-zero until the media plane attaches, additive after that; sample twice
 * and subtract for a rate. Readable after the call ends.
 */
export type CallMediaStats = {
	rtpReceived: number
	rtpPayloadTypeUnexpected: number
	srtpUnprotectFailed: number
	sframeDecryptFailed: number
	audioFramesDecoded: number
	audioFramesDelivered: number
	audioFramesConcealed: number
	mlowOffPointDropped: number
	mlowInactiveOrSid: number
	foreignFramesDecoded: number
	audioFramesWithoutDecoder: number
	outboundFramesWithoutEncoder: number
	playoutTrimmedSamples: number
	inboundPipeDropped: number
	audioSinkDropped: number
	videoSinkDropped: number
	peerKeyframeRequests: number
	relayPacketUnclassified: number
	forwardingEnvelopeRejected: number
	codecSwitches: number
}

/**
 * Bridge pump depths for one call: packets queued per direction with the
 * capacity behind each. Counts, not milliseconds. The pacing signal the
 * shed count alone cannot give: a full outbound queue with no relay means
 * the media plane never came up, while a draining one means congestion.
 * Video depths ride along only when video is up.
 */
export type CallAudioBuffer = {
	outboundQueued: number
	outboundCapacity: number
	inboundQueued: number
	inboundCapacity: number
	videoOutboundQueued?: number
	videoInboundQueued?: number
}

/**
 * A pull source of encoded audio packets for one live call. `next()` resolves
 * with the next packet to push, or `null` when the source is spent — the pump
 * then stops, leaving the call itself up.
 *
 * `release` is the early-exit hook: the pump calls it when it stops before
 * the source is spent (stop, abort, call end, teardown) so generators run
 * their `finally` blocks and readers close. It is not called after a `null`
 * — a spent source has nothing left to release. The pump waits for it, the
 * way `for await...break` waits for `return()`: a release that never settles
 * holds `done` open, so it must settle.
 */
export type CallAudioPacketSource = {
	next(): Promise<Uint8Array | null>
	release?(): unknown
}

/**
 * What a pump accepts as its packet source: either a `next()` source or any
 * async iterable of packets — a generator works directly, no wrapper needed.
 */
export type CallAudioSourceInput = CallAudioPacketSource | AsyncIterable<Uint8Array>

/**
 * Incremental reader of complete encoded packets, one full packet per call.
 * The fixture helper reads the whole file up front; this is the streaming
 * counterpart with bounded memory: the open handle plus the caller's target.
 */
export type EncodedPacketReader = {
	/**
	 * Read exactly one packet into `target`, returning its size, or `null`
	 * at end of file. Never truncates: a short final chunk and a target too
	 * small for a packet both throw. The bytes stay valid until the next
	 * read, so a pump reuses one target across pulls — safe because the
	 * bridge push copies synchronously. Aborting the signal closes the
	 * reader, and every later call throws.
	 */
	readInto(target: Uint8Array, signal?: AbortSignal): Promise<number | null>
	/** Close the handle. Idempotent. */
	close(): Promise<void>
}

/**
 * Per-packet sink for one live call's encoded audio. Runs synchronously per
 * packet; a returned promise is not observed, so an async sink must catch its
 * own failures rather than leaking unhandled rejections.
 */
export type CallAudioSink = (frame: CallAudioFrame) => void

/** Per-frame sink for decoded mono 16 kHz signed 16-bit call audio. */
export type CallPcmSink = (frame: CallPcmFrame) => void

/** What one `startCallAudioPump` run moved. */
export type CallAudioPumpStats = {
	/** Packets the engine queue accepted. */
	pushed: number
	/** Packets shed under backpressure — the loss-tolerant answer, not an error. */
	shed: number
	/** Why the run ended. Produced once, with the totals. */
	stopReason: CallAudioStopReason
}

/**
 * Why a pump run ended. The first terminal cause wins: a user stop followed
 * by teardown still reports `stopped`.
 */
export type CallAudioStopReason = 'source-ended' | 'stopped' | 'aborted' | 'call-ended' | 'socket-closed'

/**
 * Pump pull pacing. `source` pulls as fast as the source yields — right for
 * live capture, where the microphone sets the cadence. `clock` paces pulls to
 * wall-clock deadlines, one packet per `packetDurationMs` — right for file
 * playback, where nothing else sets the pace and a full queue must not become
 * the only regulator. Late pulls skip the wait instead of sleeping to catch
 * up, and deadlines snap forward so one stall cannot spiral the schedule.
 */
export type CallAudioTiming = { mode: 'source' } | { mode: 'clock'; packetDurationMs: number }

/**
 * An acquired-once encoded-audio writer for one live call. For consumers with
 * their own encoder or capture that push outside the pump: resolve the client
 * once, then send synchronously with no per-packet async hop.
 */
export type CallAudioWriter = {
	/**
	 * Queue one packet. True means the engine queue accepted it locally, not
	 * that the peer will hear it. False means the packet was not queued —
	 * shed under backpressure, or the writer is closed. Never retains the
	 * caller buffer: the bridge copies it synchronously. Never allocates per
	 * call: the answer is the primitive. A malformed packet throws instead of
	 * answering false, and so does a call the bridge no longer holds. The
	 * optional promise declares the packet's grammar and is checked against
	 * the call's negotiated format, like `pushCallAudio`.
	 */
	tryWrite(packet: Uint8Array, audioFormat?: CallAudioFormat): boolean
	/**
	 * Invalidate the writer. Idempotent, and does not end the call. Ended
	 * calls and socket teardown invalidate it automatically.
	 */
	close(): void
}

/** Synchronous writer for 960-sample PCM16 call frames. */
export type CallPcmWriter = {
	/** Queue one 20 ms PCM16 frame. False means backpressure or a closed writer. */
	tryWrite(samples: Int16Array): boolean
	/** Invalidate the writer without ending the call. */
	close(): void
}
