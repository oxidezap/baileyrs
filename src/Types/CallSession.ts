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

export type CallSessionMedia = {
	audio?: CallMediaStreams<Int16Array, Int16Array>
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

export interface CallSession {
	readonly id: string
	readonly peer: string
	readonly lifecycle: 'open' | 'closing' | 'closed'
	readonly closed: Promise<CallSessionClose>
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
