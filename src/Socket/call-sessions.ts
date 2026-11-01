import { createCallMediaScope, closeCallMedia } from './call-media-streams.ts'
import type {
	CallSession,
	CallSessionClose,
	CallSessionMedia,
	CallSessionOptions,
	CallSessionVideoMedia,
	VoipApi
} from '../Types/CallSession.ts'
import type { CallEndResult, CallMediaEvent, CallPcmFrame, CallVideoFrame, WACallEvent } from '../Types/Call.ts'
import type { HostCallOperations } from '../host-types.ts'

// This port is checked against the socket at construction and keeps the controller host-neutral.
export type CallSessionOperations = Pick<
	HostCallOperations,
	| 'endCall'
	| 'terminateCall'
	| 'setCallMuted'
	| 'getCallMediaStats'
	| 'openCallPcmWriter'
	| 'openCallVideoWriter'
	| 'onCallPcm'
	| 'onCallVideo'
	| 'startCallVideo'
	| 'acceptCallVideo'
	| 'stopCallVideo'
	| 'resumeCallVideo'
	| 'retryCallVideoUpgrade'
	| 'requestCallKeyframe'
	| 'getCallVideoDiagnostics'
>

interface SessionEvents {
	on(event: 'call.media', listener: (event: CallMediaEvent) => void): unknown
	on(event: 'call', listener: (events: WACallEvent[]) => void): unknown
	off(event: 'call.media', listener: (event: CallMediaEvent) => void): unknown
	off(event: 'call', listener: (events: WACallEvent[]) => void): unknown
}

export interface CallSessionRuntime {
	events: SessionEvents
	start(peerOrId: string, incoming: boolean, video: boolean, signal: AbortSignal): Promise<string>
	isClosing(): boolean
	isTerminal(id: string): boolean
	onSocketEnd(handler: () => Promise<void>): void
	reportError(error: unknown, message: string): void
}

class VideoSetupCancelled extends DOMException {
	constructor() {
		super('Video setup cancelled', 'AbortError')
	}
}

const abortError = (): Error => new DOMException('Call operation aborted', 'AbortError')

const disposeUnusedMedia = (media: CallSessionMedia, reason: unknown): Promise<unknown>[] => {
	const tasks: Promise<unknown>[] = []
	const audio = media?.audio
	if (typeof audio?.dispose === 'function') tasks.push(Promise.resolve().then(() => audio.dispose?.()))
	for (const stream of [media?.audio?.input]) {
		if (stream && !stream.locked && typeof stream.cancel === 'function')
			tasks.push(Promise.resolve().then(() => stream.cancel(reason)))
	}
	for (const stream of [media?.audio?.output]) {
		if (stream && !stream.locked && typeof stream.abort === 'function')
			tasks.push(Promise.resolve().then(() => stream.abort(reason)))
	}
	return tasks
}

const validateChannels = (channels: CallSessionMedia['audio'] | CallSessionVideoMedia): void => {
	if (!channels || typeof channels !== 'object') throw new TypeError('media channels must be objects')
	if (channels.dispose !== undefined && typeof channels.dispose !== 'function')
		throw new TypeError('media dispose must be a function')
	if (
		channels.input !== undefined &&
		(!channels.input || typeof channels.input.getReader !== 'function' || channels.input.locked)
	)
		throw new TypeError('media input must be an unlocked ReadableStream')
	if (
		channels.output !== undefined &&
		(!channels.output || typeof channels.output.getWriter !== 'function' || channels.output.locked)
	)
		throw new TypeError('media output must be an unlocked WritableStream')
}

const validateMedia = (media: CallSessionMedia): void => {
	if (!media || typeof media !== 'object') throw new TypeError('media factory must return a media object')
	if (media.audio !== undefined) validateChannels(media.audio)
	if (media.video !== undefined && typeof media.video !== 'function')
		throw new TypeError('video media must be a factory')
}

export const createVoipApi = (operations: CallSessionOperations, runtime: CallSessionRuntime): VoipApi => {
	const sessions = new Map<
		string,
		{
			handle: CallSession
			finish(reason: CallSessionClose): Promise<void>
			stopVideo(): Promise<void>
			keyframe(): void
		}
	>()
	const pending = new Map<string, Promise<CallSession>>()
	const starting = new Set<AbortController>()
	let disposed = false
	let subscribed = false
	const onMedia = (event: CallMediaEvent) => {
		if (event.kind === 'video-keyframe-needed') sessions.get(event.callId)?.keyframe()
		if (event.kind === 'ended') void sessions.get(event.callId)?.finish({ reason: 'remote' })
		if (event.kind === 'video-state-changed' && event.state === 0) void sessions.get(event.callId)?.stopVideo()
	}
	const onCalls = (events: WACallEvent[]) => {
		for (const event of events) {
			if (
				runtime.isTerminal(event.id) ||
				event.status === 'terminate' ||
				event.status === 'reject' ||
				event.status === 'timeout'
			) {
				void sessions.get(event.id)?.finish({ reason: 'remote' })
			}
		}
	}
	const unsubscribeIdle = () => {
		if (!subscribed || sessions.size || starting.size) return
		runtime.events.off('call.media', onMedia)
		runtime.events.off('call', onCalls)
		subscribed = false
	}
	const subscribe = () => {
		if (subscribed) return
		runtime.events.on('call.media', onMedia)
		runtime.events.on('call', onCalls)
		subscribed = true
	}
	runtime.onSocketEnd(async () => {
		disposed = true
		const stopping = [...sessions.values()].map(session => session.finish({ reason: 'socket-closed' }))
		for (const controller of starting) controller.abort(new Error('Connection Closed'))
		await Promise.all(stopping)
		unsubscribeIdle()
	})

	const start = async (
		peerOrId: string,
		peer: string,
		incoming: boolean,
		options: CallSessionOptions,
		defaultVideo = false
	): Promise<CallSession> => {
		if (disposed || runtime.isClosing()) throw new Error('Connection Closed')
		if (typeof peerOrId !== 'string' || !peerOrId.length)
			throw new TypeError('call peer or id must be a non-empty string')
		if (options.video !== undefined && typeof options.video !== 'boolean')
			throw new TypeError('video must be a boolean')
		if (options.media !== undefined && typeof options.media !== 'function')
			throw new TypeError('media must be a factory')
		const withVideo = options.video ?? defaultVideo
		if (typeof withVideo !== 'boolean') throw new TypeError('video must be a boolean')
		options.signal?.throwIfAborted()
		const controller = new AbortController()
		const abort = () => controller.abort(options.signal?.reason ?? abortError())
		options.signal?.addEventListener('abort', abort, { once: true })
		starting.add(controller)
		subscribe()
		let adopted = false
		let detachAbort = () => options.signal?.removeEventListener('abort', abort)
		let cancelStart!: () => void
		const aborted = new Promise<never>((_resolve, reject) => {
			cancelStart = () => reject(controller.signal.reason ?? abortError())
			controller.signal.addEventListener('abort', cancelStart, { once: true })
		})
		let admittedId: string | undefined
		let retiring = false
		const retire = async (id: string): Promise<void> => {
			if (retiring || sessions.has(id)) return
			retiring = true
			try {
				await operations.terminateCall(id, peer)
			} catch (error) {
				if (!runtime.isClosing()) runtime.reportError(error, 'ending a cancelled call start')
			}
		}
		const launch = Promise.resolve().then(() => {
			controller.signal.throwIfAborted()
			return runtime.start(peerOrId, incoming, withVideo, controller.signal)
		})
		// Cancellation after native admission still owns the ID returned by that operation.
		void launch.then(
			id => {
				if (controller.signal.aborted) void retire(id)
			},
			() => undefined
		)

		try {
			const id = await Promise.race([launch, aborted])
			admittedId = id
			if (controller.signal.aborted) throw controller.signal.reason ?? abortError()
			if (runtime.isClosing() || runtime.isTerminal(id)) throw new Error('Call ended during startup')
			if (sessions.has(id)) throw new Error('Call is already managed')
			let lifecycle: CallSession['lifecycle'] = 'open'
			let resolveClosed!: (reason: CallSessionClose) => void
			const closed = new Promise<CallSessionClose>(resolve => {
				resolveClosed = resolve
			})
			const cleanup: Array<() => unknown> = []
			let finishing: Promise<void> | undefined
			let endPromise: Promise<CallEndResult> | undefined
			let closedBy: CallSessionClose['reason'] | undefined
			const finish = (reason: CallSessionClose): Promise<void> => {
				if (finishing) return finishing
				let settled!: () => void
				finishing = new Promise<void>(resolve => {
					settled = resolve
				})
				closedBy = reason.reason
				lifecycle = 'closing'
				detachAbort()
				controller.abort(reason.error ?? new Error(`Call ended: ${reason.reason}`))
				const tasks = cleanup.splice(0).map(stop => Promise.resolve().then(stop))
				const complete = () => {
					lifecycle = 'closed'
					sessions.delete(id)
					resolveClosed({ ...reason })
					unsubscribeIdle()
					settled()
				}
				void closeCallMedia(tasks, runtime.reportError).then(complete, error => {
					try {
						runtime.reportError(error, 'closing call session')
					} finally {
						complete()
					}
				})
				return finishing
			}
			const end = (): Promise<CallEndResult> => {
				if (endPromise) return endPromise
				if (closedBy === 'remote') return Promise.resolve({ outcome: 'already-ended' })
				if (closedBy === 'socket-closed') return Promise.reject(new Error('Connection Closed'))
				let resolveEnd!: (result: CallEndResult) => void
				let rejectEnd!: (error: unknown) => void
				const ending = new Promise<CallEndResult>((resolve, reject) => {
					resolveEnd = resolve
					rejectEnd = reject
				})
				endPromise = ending
				const stopping = finish({ reason: 'local' })
				const notify = async (): Promise<CallEndResult> => {
					try {
						const result = await operations.endCall(id)
						if (result.outcome === 'local-only' || result.outcome === 'partly-notified') {
							await operations.terminateCall(id, peer)
							return { outcome: 'peer-notified' }
						}
						return result
					} finally {
						await stopping
					}
				}
				void notify().then(resolveEnd, error => {
					if (endPromise === ending) endPromise = undefined
					rejectEnd(error)
				})
				return ending
			}

			const failed = (error: unknown) => {
				if (lifecycle !== 'open') return
				void finish({ reason: 'media-error', error })
				void end().catch(failure => runtime.reportError(failure, 'ending a failed media session'))
			}
			const io = {
				audioInputAccepted: 0,
				audioInputShed: 0,
				videoInputAccepted: 0,
				videoInputShed: 0,
				audioOutputDropped: 0,
				videoOutputDropped: 0
			}
			const requireOpen = <T>(operation: () => Promise<T>): Promise<T> =>
				lifecycle === 'open' ? operation() : Promise.reject(new Error('Call session is closed'))
			let nativeVideo = Promise.resolve()
			const videoOperation = (operation: () => Promise<void>): Promise<void> => {
				const result = nativeVideo.then(() => requireOpen(operation))
				nativeVideo = result.catch(() => undefined)
				return result
			}
			const handle: CallSession = {
				id,
				peer,
				get lifecycle() {
					return lifecycle
				},
				closed,
				end,
				setMuted: muted => requireOpen(() => operations.setCallMuted(id, muted)),
				stats: async () => ({ ...(await operations.getCallMediaStats(id)), io: { ...io } }),
				video: {
					start: () =>
						requireOpen(async () => {
							await enableVideo(() => operations.startCallVideo(id))
						}),
					accept: () =>
						requireOpen(async () => {
							await enableVideo(() => operations.acceptCallVideo(id))
						}),
					stop: () =>
						requireOpen(async () => {
							const stopping = videoOperation(() => operations.stopCallVideo(id))
							await Promise.all([stopVideoMedia(), stopping])
						}),
					resume: () =>
						requireOpen(async () => {
							await enableVideo(() => operations.resumeCallVideo(id))
						}),
					retry: () => requireOpen(() => videoOperation(() => operations.retryCallVideoUpgrade(id))),
					requestKeyframe: urgency => requireOpen(() => operations.requestCallKeyframe(id, urgency)),
					diagnostics: () => requireOpen(() => operations.getCallVideoDiagnostics(id))
				},
				async [Symbol.asyncDispose]() {
					if (closedBy === 'remote' || closedBy === 'socket-closed') await finishing
					else await end()
				}
			}
			sessions.set(id, {
				handle,
				finish,
				stopVideo: () => stopVideoMedia(),
				keyframe: () => {
					const scope = videoScope
					const request = requestEncoderKeyframe
					if (request && scope && !scope.signal.aborted)
						void Promise.resolve()
							.then(() => {
								if (!scope.signal.aborted) return request()
							})
							.catch(error => {
								if (!scope.signal.aborted) runtime.reportError(error, 'requesting encoder keyframe')
							})
				}
			})
			adopted = true
			const onAbort = () => {
				void finish({ reason: 'aborted', error: options.signal?.reason })
				void end().catch(error => {
					if (!runtime.isClosing()) runtime.reportError(error, 'ending an aborted call')
				})
			}
			controller.signal.addEventListener('abort', onAbort, { once: true })
			const detachStartingAbort = detachAbort
			detachAbort = () => {
				detachStartingAbort()
				controller.signal.removeEventListener('abort', onAbort)
			}

			const audioScope = createCallMediaScope(controller.signal, failed, runtime.reportError)
			cleanup.push(audioScope.close)
			let videoScope: ReturnType<typeof createCallMediaScope> | undefined
			let requestEncoderKeyframe: CallSessionVideoMedia['requestKeyframe']
			let videoFactory: CallSessionMedia['video']
			let videoSetup: Promise<void> | undefined
			let videoDesired = withVideo
			let videoGeneration = 0
			const stopVideoMedia = (): Promise<void> => {
				videoDesired = false
				requestEncoderKeyframe = undefined
				videoGeneration++
				const scope = videoScope
				videoScope = undefined
				videoSetup = undefined
				return scope?.close() ?? Promise.resolve()
			}
			const prepareVideo = (): Promise<void> => {
				if (!videoFactory || videoSetup) return videoSetup ?? Promise.resolve()
				const scope = createCallMediaScope(
					controller.signal,
					error => {
						if (videoScope !== scope) return
						const stopping = videoOperation(() => operations.stopCallVideo(id))
						void stopVideoMedia()
						void stopping.catch(failure => runtime.reportError(failure, 'stopping failed video'))
						runtime.reportError(error, 'video media failed')
					},
					runtime.reportError
				)
				videoScope = scope
				const creating = Promise.resolve().then(() => videoFactory!(handle, scope.signal))
				void creating.then(
					channels => scope.own(channels),
					() => undefined
				)
				videoSetup = (async () => {
					const channels = await scope.wait(creating)
					validateChannels(channels)
					if (channels.requestKeyframe !== undefined && typeof channels.requestKeyframe !== 'function')
						throw new TypeError('video requestKeyframe must be a function')
					requestEncoderKeyframe = channels.requestKeyframe?.bind(channels)
					if (channels.output)
						scope.output(
							channels.output,
							sink => operations.onCallVideo(id, sink),
							(frame: CallVideoFrame) => ({ ...frame, data: frame.data.slice() }),
							() => io.videoOutputDropped++
						)
					if (channels.input)
						await scope.input(
							channels.input,
							operations.openCallVideoWriter(id),
							() => io.videoInputAccepted++,
							() => io.videoInputShed++
						)
				})().catch(async error => {
					const cancelled = scope.signal.aborted
					if (videoScope === scope) {
						const stopping =
							!cancelled && lifecycle === 'open'
								? videoOperation(() => operations.stopCallVideo(id)).catch(failure =>
										runtime.reportError(failure, 'stopping failed video setup')
									)
								: Promise.resolve()
						await Promise.all([stopVideoMedia(), stopping])
					}
					if (cancelled) throw new VideoSetupCancelled()
					throw error
				})
				return videoSetup
			}
			const enableVideo = async (operation: () => Promise<void>): Promise<void> => {
				const generation = ++videoGeneration
				await videoOperation(() => {
					if (generation !== videoGeneration) throw new VideoSetupCancelled()
					return operation()
				})
				if (lifecycle !== 'open' || generation !== videoGeneration)
					throw new DOMException('Video operation cancelled', 'AbortError')
				videoDesired = true
				await prepareVideo()
			}
			cleanup.push(stopVideoMedia)

			if (options.media) {
				let media: CallSessionMedia
				let audioOwned = false
				let releasingFactory: Promise<void> | undefined
				const releaseFactory = (value: CallSessionMedia): Promise<void> => {
					if (audioOwned) return Promise.resolve()
					return (releasingFactory ??= closeCallMedia(
						disposeUnusedMedia(value, 'call ended during setup'),
						runtime.reportError
					))
				}
				const creating = Promise.resolve().then(() => options.media!(handle, controller.signal))
				void creating.then(
					late => {
						if (controller.signal.aborted) void releaseFactory(late)
					},
					() => undefined
				)
				try {
					media = await Promise.race([creating, aborted])
				} catch (error) {
					failed(error)
					throw error
				}
				if (lifecycle !== 'open' || runtime.isClosing()) {
					await releaseFactory(media)
					throw controller.signal.reason ?? new Error('Call ended during media setup')
				}
				cleanup.push(() => releaseFactory(media))
				try {
					validateMedia(media)
					if (media.audio) {
						audioScope.own(media.audio)
						audioOwned = true
						if (media.audio.output)
							audioScope.output(
								media.audio.output,
								sink => operations.onCallPcm(id, sink),
								(frame: CallPcmFrame) => frame.data.slice(),
								() => io.audioOutputDropped++
							)
						if (media.audio.input)
							await audioScope.input(
								media.audio.input,
								operations.openCallPcmWriter(id),
								() => io.audioInputAccepted++,
								() => io.audioInputShed++,
								60
							)
					}
					videoFactory = media.video?.bind(media)
					if (videoDesired)
						await prepareVideo().catch(error => {
							if (!(error instanceof VideoSetupCancelled) || lifecycle !== 'open') throw error
						})
				} catch (error) {
					failed(error)
					throw error
				}
			}

			return handle
		} finally {
			controller.signal.removeEventListener('abort', cancelStart)
			starting.delete(controller)
			if (!adopted) {
				detachAbort()
				controller.abort(abortError())
				if (admittedId !== undefined) void retire(admittedId)
			}
			unsubscribeIdle()
		}
	}
	return {
		call: (peer, options = {}) => start(peer, peer, false, options),
		accept(offer, options = {}) {
			if (
				!offer ||
				offer.status !== 'offer' ||
				typeof offer.id !== 'string' ||
				!offer.id ||
				typeof offer.chatId !== 'string' ||
				!offer.chatId
			)
				return Promise.reject(new TypeError('accept requires a call offer'))
			const current = pending.get(offer.id)
			if (current) return current
			const existing = sessions.get(offer.id)
			if (existing) return Promise.resolve(existing.handle)
			const operation = start(offer.id, offer.chatId, true, options, offer.isVideo ?? false)
			pending.set(offer.id, operation)
			void operation.finally(() => pending.delete(offer.id)).catch(() => undefined)
			return operation
		},
		get: id => sessions.get(id)?.handle,
		get active() {
			return [...sessions.values()].map(session => session.handle)
		}
	}
}
