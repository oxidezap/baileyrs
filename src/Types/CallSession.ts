import type {
	CallEndResult,
	CallKeyframeUrgency,
	CallMediaStats,
	CallVideoDiagnostics,
	CallVideoFrame,
	WACallEvent
} from './Call.ts'

export type CallMediaStreams<TInput, TOutput> = {
	input?: ReadableStream<TInput>
	output?: WritableStream<TOutput>
	dispose?: () => void | Promise<void>
}

export type CallPcmFormat = { sampleRate: 16000; channels: 1 }

export type CallSessionAudioMedia = CallMediaStreams<Int16Array, Int16Array> & {
	/** Defaults to 16 kHz mono. Int16 samples are never implicitly resampled. */
	format?: CallPcmFormat
}

export type CallSessionMedia = {
	audio?: CallSessionAudioMedia
	video?: (call: CallSession, signal: AbortSignal) => CallSessionVideoMedia | Promise<CallSessionVideoMedia>
}

export type CallSessionVideoMedia = CallMediaStreams<Uint8Array, CallVideoFrame> & {
	/** Produce an IDR when the peer or media backend requests one. */
	requestKeyframe?: () => void | Promise<void>
}

export type CallSessionOptions = {
	signal?: AbortSignal
	video?: boolean
	/** Created after call admission. Cancellation also disposes a factory that resolves late. */
	media?: (call: CallSession, signal: AbortSignal) => CallSessionMedia | Promise<CallSessionMedia>
}

export type CallSessionClose = {
	reason: 'local' | 'remote' | 'aborted' | 'socket-closed' | 'media-error'
	error?: unknown
}

export type CallSessionIoStats = {
	audioInputAccepted: number
	audioInputShed: number
	videoInputAccepted: number
	videoInputShed: number
	audioOutputDropped: number
	videoOutputDropped: number
}

export type CallAudioInputOptions = { signal?: AbortSignal; format?: CallPcmFormat }
export type CallAudioOutputOptions = {
	signal?: AbortSignal
	/** Cumulative frames dropped for this receiver, independent of other receivers. */
	onDrop?: (droppedFrames: number) => void
}

export interface CallSessionAudio {
	readonly format: Readonly<CallPcmFormat>
	/** Replaces the current input. EOF completes playback without ending the call. */
	play(input: ReadableStream<Int16Array>, options?: CallAudioInputOptions): Promise<void>
	stop(): Promise<void>
	/** Each receiver has an independent, bounded queue. Cancelling it leaves the call active. */
	receive(options?: CallAudioOutputOptions): ReadableStream<Int16Array>
}

export interface CallSession {
	readonly id: string
	readonly peer: string
	readonly lifecycle: 'open' | 'closing' | 'closed'
	readonly closed: Promise<CallSessionClose>
	readonly ready: Promise<void>
	readonly audio: CallSessionAudio
	/** Retries signaling after an incomplete hangup; successful termination is idempotent. */
	end(): Promise<CallEndResult>
	setMuted(muted: boolean): Promise<void>
	stats(): Promise<CallMediaStats & { io: CallSessionIoStats }>
	readonly video: {
		start(): Promise<void>
		accept(): Promise<void>
		stop(): Promise<void>
		resume(): Promise<void>
		retry(): Promise<void>
		requestKeyframe(urgency?: CallKeyframeUrgency): Promise<void>
		diagnostics(): Promise<CallVideoDiagnostics>
	}
	[Symbol.asyncDispose](): Promise<void>
}

export interface VoipApi {
	call(peer: string, options?: CallSessionOptions): Promise<CallSession>
	/** Accepts an offer; other event statuses reject at runtime. */
	accept(offer: WACallEvent, options?: CallSessionOptions): Promise<CallSession>
	get(id: string): CallSession | undefined
	readonly active: readonly CallSession[]
}
