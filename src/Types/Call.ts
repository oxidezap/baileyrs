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
 * A promise about the bytes pushed through `pushCallAudio`, and what the call
 * negotiates against: answering an offer that only speaks the other codec
 * fails naming `audioFormat` so the caller can retry with the other one.
 * `opus` is the in-profile escape on the same 16 kHz clock as `mlow`, not
 * native RFC 7587 Opus. Spelled after the bridge `CallAudioFormat`.
 */
export type CallAudioFormat = 'mlow' | 'opus'

/** One decoded audio packet for a live call, as the engine received it. */
export type CallAudioFrame = {
	callId: string
	data: Uint8Array
	codec: 'mlow' | 'opus'
	payloadType: number
	sequenceNumber: number
	timestamp: number
	marker: boolean
}

/**
 * Lifecycle and media diagnostics for one live call. Only the encoded-audio
 * 1:1 subset crosses in this slice; group, video, reaction and RTCP events
 * belong to later slices.
 */
export type CallMediaEventKind =
	| 'relay-allocated'
	| 'relay-allocate-failed'
	| 'relay-allocate-timed-out'
	| 'media-setup-failed'
	| 'audio-codec-switched'
	| 'audio-codec-source-fixed'
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
 * A pull source of encoded audio packets for one live call. `next()` resolves
 * with the next packet to push, or `null` when the source is spent — the pump
 * then stops, leaving the call itself up.
 */
export type CallAudioPacketSource = {
	next(): Promise<Uint8Array | null>
}

/**
 * What a pump accepts as its packet source: either a `next()` source or any
 * async iterable of packets — a generator works directly, no wrapper needed.
 */
export type CallAudioSourceInput = CallAudioPacketSource | AsyncIterable<Uint8Array>

/** Per-packet sink for one live call's decoded audio. */
export type CallAudioSink = (frame: CallAudioFrame) => void

/** What one `startCallAudioPump` run moved. */
export type CallAudioPumpStats = {
	/** Packets the engine queue accepted. */
	pushed: number
	/** Packets shed under backpressure — the loss-tolerant answer, not an error. */
	shed: number
}
