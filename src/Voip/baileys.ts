import EventEmitter from 'events'
import type { ClientExtensions, VoipRelayTransport, WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge/host'
import { adaptBridgeEvent } from '../Bridge/index.ts'
import { createVoipApi } from '../Socket/call-sessions.ts'
import { makeCallRelayTransport } from '../Socket/call-relay.ts'
import { trackIncomingCall, toCallEvent, type CallOfferCache } from '../Socket/call-offers.ts'
import {
	makeCallAudioMethods,
	makeCallMediaRouter,
	clearIncompleteEnd,
	parseCallEndResult,
	type CallAudioContext
} from '../Socket/calls-core.ts'
import type { BinaryNode } from '../Types/BinaryNode.ts'
import type {
	CallEndResult,
	CallMediaEvent,
	CallMediaStats,
	CallPcmFrame,
	CallRelayTransportProvider,
	WACallEvent
} from '../Types/Call.ts'
import type { CallSessionOperations, VoipApi } from '../Types/CallSession.ts'
import { isJidGroup } from '../WABinary/jid-utils.ts'
import { createBaileysCallHost, type BaileysCallHostOptions, type BaileysCallSocket } from './baileys-host.ts'

type CallStart = string | { readonly callId: string; free?(): void }
type MediaBackend = NonNullable<ClientExtensions['voipBackend']>

/** The standalone bridge control owns calls, never a second WhatsApp client. */
export interface BaileysCallControl {
	dialCallPcm(peer: string): Promise<CallStart>
	acceptCallPcm(id: string): Promise<CallStart>
	callPushPcm16(id: string, samples: Int16Array): boolean
	endCall(id: string): Promise<CallEndResult>
	terminateCall(id: string, peer: string, creator: string): Promise<CallEndResult>
	setCallMuted(id: string, muted: boolean): Promise<void>
	getCallMediaStats(id: string): CallMediaStats
	receiveNode(node: BinaryNode): Promise<void>
	disconnect(): void | Promise<void>
	free(): void
}

export interface BaileysVoipRuntime {
	loadEngine(transport: VoipRelayTransport): Promise<{ voipBackend: MediaBackend; dispose?(): void | Promise<void> }>
	createCallControl(
		host: ReturnType<typeof createBaileysCallHost>['host'],
		callbacks: {
			onEvent(event: WhatsAppEvent): void
			onCallPcm(frame: CallPcmFrame): void
			onCallEvent(event: CallMediaEvent): void
		},
		extensions: { voipBackend: MediaBackend }
	): Promise<BaileysCallControl>
}

export interface BaileysVoipSocket extends BaileysCallSocket {
	ev: {
		on(event: 'connection.update', handler: (update: { connection?: string }) => void): unknown
		off(event: 'connection.update', handler: (update: { connection?: string }) => void): unknown
	}
}

export interface BaileysVoipOptions extends BaileysCallHostOptions {
	runtime?: BaileysVoipRuntime
	createRelayProvider?: () => Promise<CallRelayTransportProvider>
	reportError?(error: unknown, message: string): void
}

export type BaileysVoip = VoipApi & {
	disconnect(): Promise<void>
	[Symbol.asyncDispose](): Promise<void>
}

const defaultRuntime: BaileysVoipRuntime = {
	async loadEngine(transport) {
		return (await import('@oxidezap/whatsapp-rust-bridge/voip')).loadVoip(transport)
	},
	async createCallControl(host, callbacks, extensions) {
		const bridge = await import('@oxidezap/whatsapp-rust-bridge')
		// Registry builds predating standalone control fail at capability admission.
		if (!('createCallControl' in bridge) || typeof bridge.createCallControl !== 'function')
			throw new Error('The installed bridge does not support standalone call control')
		return bridge.createCallControl(host, callbacks, extensions)
	}
}

const unsupported = async (): Promise<never> => {
	throw new Error('Upstream calling currently supports 1:1 PCM audio only')
}

/** Validate before cloning, including backing stores that structuredClone would retain in full. */
const snapshot = (input: unknown): { node: BinaryNode; bytes: number } => {
	let bytes = 0
	const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }]
	const seen = new Set<object>()
	while (stack.length) {
		const { value, depth } = stack.pop()!
		if (!value || typeof value !== 'object' || depth > 64 || seen.has(value)) throw new Error('Invalid raw call node')
		seen.add(value)
		const node = value as BinaryNode
		if (
			typeof node.tag !== 'string' ||
			!node.attrs ||
			typeof node.attrs !== 'object' ||
			Array.isArray(node.attrs) ||
			Object.keys(node).some(key => key !== 'tag' && key !== 'attrs' && key !== 'content')
		)
			throw new Error('Invalid raw call node')
		bytes += 64 + node.tag.length * 4
		for (const [key, attribute] of Object.entries(node.attrs)) {
			if (typeof attribute !== 'string') throw new Error('Invalid raw call attributes')
			bytes += 32 + (key.length + attribute.length) * 4
			if (bytes > 1_048_576) throw new Error('Raw call node exceeds 1 MiB')
		}
		if (typeof node.content === 'string') bytes += node.content.length * 4
		else if (node.content instanceof Uint8Array) {
			if (typeof SharedArrayBuffer !== 'undefined' && node.content.buffer instanceof SharedArrayBuffer)
				throw new Error('Shared call payload backing stores are unsupported')
			bytes += node.content.buffer.byteLength
		} else if (node.content !== undefined) {
			if (!Array.isArray(node.content) || Object.keys(node.content).length !== node.content.length)
				throw new Error('Invalid raw call children')
			bytes += node.content.length * 8
			if (bytes > 1_048_576) throw new Error('Raw call node exceeds 1 MiB')
			for (const child of node.content) stack.push({ value: child, depth: depth + 1 })
		}
		if (bytes > 1_048_576) throw new Error('Raw call node exceeds 1 MiB')
	}
	return { node: structuredClone(input) as BinaryNode, bytes }
}

const claimedHosts = new WeakSet<object>()

/** Attach calling to an already connected upstream socket. It retains connection and ACK ownership. */
export const createBaileysVoip = async (
	socket: BaileysVoipSocket,
	options: BaileysVoipOptions
): Promise<BaileysVoip> => {
	if (!socket.ws.isOpen) throw new Error('Call host connection closed')
	if ('voip' in socket && socket.voip !== undefined)
		throw new Error('Socket already provides voip; use its existing calling API')
	if (claimedHosts.has(socket)) throw new Error('Calling is already attached to this socket')
	claimedHosts.add(socket)
	let claimed = true
	const releaseClaim = () => {
		if (!claimed) return
		claimed = false
		claimedHosts.delete(socket)
	}
	try {
		const adapter = createBaileysCallHost(socket, options)
		const events = new EventEmitter()
		const contexts: CallOfferCache = new Map()
		const endHandlers: (() => Promise<void>)[] = []
		const activeOperations = new Set<Promise<unknown>>()
		const queue: { node: BinaryNode; bytes: number }[] = []
		let queuedBytes = 0
		let inFlight = false
		let closing = false
		let shutdown: Promise<void> | undefined
		let drain: Promise<void> | undefined
		let engine: Awaited<ReturnType<BaileysVoipRuntime['loadEngine']>> | undefined
		let control: BaileysCallControl | undefined
		const report = (error: unknown, message: string) => {
			try {
				if (options.reportError) options.reportError(error, message)
				else
					console.error('Baileyrs calling integration error', {
						operation: message,
						name: error instanceof Error ? error.name : 'Error'
					})
			} catch {
				/* diagnostics must not interrupt cleanup */
			}
		}
		const media = makeCallMediaRouter({
			emitMediaEvent: event => events.emit('call.media', event),
			reportError: report
		})
		const relay = makeCallRelayTransport(
			options.createRelayProvider ??
				(async () => (await import('../Runtime/node-call-relay.ts')).createNodeCallRelayProvider())
		)
		const runtime = options.runtime ?? defaultRuntime
		const boundedContexts = () => {
			if (contexts.size > 256) throw new Error('Too many retained call contexts')
		}
		const callbacks = {
			onEvent(raw: WhatsAppEvent) {
				if (closing) return
				try {
					const event = adaptBridgeEvent(raw)
					if (event?.type !== 'incomingCall') return
					if (trackIncomingCall(contexts, event)) media.stopCall(event.action.callId)
					boundedContexts()
					events.emit('call', [toCallEvent(event)])
				} catch (error) {
					fatal(error, 'processing standalone call event')
				}
			},
			onCallPcm(frame: CallPcmFrame) {
				if (!closing) media.routePcmFrame(frame)
			},
			onCallEvent(event: CallMediaEvent) {
				if (!closing) media.routeMediaEvent(event)
			}
		}
		let rejectClosed!: (error: Error) => void
		const closed = new Promise<never>((_resolve, reject) => {
			rejectClosed = reject
		})
		void closed.catch(() => undefined)
		const disposeEngine = async () => {
			const loaded = engine
			engine = undefined
			try {
				await loaded?.dispose?.()
			} catch (error) {
				report(error, 'disposing call engine')
			}
		}
		const nativeReady = Promise.resolve().then(async () => {
			if (closing) throw new Error('Calling integration closed during initialization')
			engine = await runtime.loadEngine(relay.transport)
			if (closing) {
				await disposeEngine()
				throw new Error('Calling integration closed during initialization')
			}
			let created: BaileysCallControl
			try {
				created = await runtime.createCallControl(adapter.host, callbacks, { voipBackend: engine.voipBackend })
			} catch (error) {
				await disposeEngine()
				throw error
			}
			if (closing) {
				try {
					await created.disconnect()
				} finally {
					try {
						created.free()
					} finally {
						await disposeEngine()
					}
				}
				throw new Error('Calling integration closed during initialization')
			}
			control = created
			return created
		})
		const controlReady = Promise.race([nativeReady, closed])
		void controlReady.catch(() => undefined)
		const ctx: CallAudioContext = {
			async withClient(operation) {
				if (closing) throw new Error('Calling integration closed')
				const native = await controlReady
				if (closing) throw new Error('Calling integration closed')
				const pending = Promise.resolve().then(() => operation(native))
				activeOperations.add(pending)
				try {
					return await pending
				} finally {
					activeOperations.delete(pending)
				}
			},
			isClosing: () => closing,
			reportUnexpectedError: report
		}
		const confirmedEnd = (id: string) => {
			contexts.delete(id)
			clearIncompleteEnd(ctx, id)
		}
		const methods = makeCallAudioMethods(ctx, media, { onCallEnded: confirmedEnd })
		const operations: CallSessionOperations = {
			...methods,
			async terminateCall(id, peer) {
				const remembered = contexts.get(id)
				const creator = remembered?.callCreator ?? adapter.host.ownLid()
				if (!creator) throw new Error('Call creator is unavailable for termination')
				try {
					const result = parseCallEndResult(
						await ctx.withClient(client =>
							(client as BaileysCallControl).terminateCall(id, remembered?.peer ?? peer, creator)
						)
					)
					if (!result || (result.outcome !== 'peer-notified' && result.outcome !== 'already-ended'))
						throw new Error('Call termination was not confirmed')
					confirmedEnd(id)
				} finally {
					media.stopCall(id)
				}
			},
			openCallVideoWriter: unsupported,
			onCallVideo: () => {
				throw new Error('Upstream calling currently supports 1:1 PCM audio only')
			},
			startCallVideo: unsupported,
			acceptCallVideo: unsupported,
			stopCallVideo: unsupported,
			resumeCallVideo: unsupported,
			retryCallVideoUpgrade: unsupported,
			requestCallKeyframe: unsupported,
			getCallVideoDiagnostics: unsupported
		}
		const voip = createVoipApi(operations, {
			events,
			async start(peerOrId, incoming, video, signal) {
				if (video || (!incoming && isJidGroup(peerOrId))) return unsupported()
				if (!incoming && contexts.size >= 256) throw new Error('Too many retained call contexts')
				for (;;) {
					const pending = drain
					if (!pending) break
					await pending
				}
				signal.throwIfAborted()
				const calls = makeCallAudioMethods(ctx, media, {}, signal)
				if (incoming) {
					const context = contexts.get(peerOrId)
					if (context?.isVideo || context?.groupJid || isJidGroup(context?.peer)) return unsupported()
					return calls.acceptCallPcm(peerOrId)
				}
				const resolvedPeer = await adapter.host.resolvePeer(peerOrId)
				signal.throwIfAborted()
				const id = await calls.dialCallPcm(resolvedPeer)
				if (closing) throw new Error('Calling integration closed')
				if (!contexts.has(id)) contexts.set(id, { peer: resolvedPeer, callCreator: adapter.host.ownLid() })
				if (contexts.size > 256) {
					const error = new Error('Too many retained call contexts')
					fatal(error, 'admitting standalone call')
					throw error
				}
				return id
			},
			isClosing: () => closing,
			isTerminal: id => media.isTerminalCall?.(id) ?? false,
			onSocketEnd: handler => endHandlers.push(handler),
			reportError: report
		})
		function fatal(error: unknown, message: string) {
			report(error, message)
			void disconnect().catch(failure => report(failure, 'closing calling integration'))
		}
		function pump() {
			if (drain || closing) return
			drain = (async () => {
				while (queue.length) {
					if (closing) break
					const next = queue.shift()!
					inFlight = true
					try {
						const native = await controlReady
						if (!closing) await native.receiveNode(next.node)
					} catch (error) {
						if (!closing) report(error, 'processing upstream call signaling')
					} finally {
						queuedBytes -= next.bytes
						inFlight = false
					}
				}
			})().finally(() => {
				drain = undefined
				if (queue.length && !closing) pump()
			})
		}
		const onRaw = (...args: unknown[]) => {
			if (closing) return
			try {
				const next = snapshot(args[0])
				if (queue.length + Number(inFlight) >= 64 || queuedBytes + next.bytes > 4_194_304)
					throw new Error('Upstream call signaling queue overflow')
				queuedBytes += next.bytes
				queue.push(next)
				pump()
			} catch (error) {
				fatal(error, 'admitting upstream call signaling')
			}
		}
		const onConnection = (update: { connection?: string }) => {
			if (update.connection === 'close')
				void disconnect().catch(error => report(error, 'closing disconnected calling integration'))
		}
		socket.ws.on('CB:call', onRaw)
		socket.ev.on('connection.update', onConnection)
		function disconnect(): Promise<void> {
			if (shutdown) return shutdown
			closing = true
			rejectClosed(new Error('Calling integration closed during initialization'))
			socket.ws.off('CB:call', onRaw)
			socket.ev.off('connection.update', onConnection)
			for (const item of queue.splice(0)) queuedBytes -= item.bytes
			adapter.dispose()
			shutdown = Promise.resolve()
				.then(async () => {
					try {
						await control?.disconnect()
					} catch (error) {
						report(error, 'disconnecting standalone call control')
					}
					await Promise.allSettled(endHandlers.map(handler => handler()))
					await media.drainAll()
					await Promise.allSettled([...activeOperations, ...(drain ? [drain] : [])])
					try {
						await relay.closeAll()
					} catch (error) {
						report(error, 'closing call relay transport')
					}
					if (control) {
						try {
							control.free()
						} finally {
							control = undefined
							await disposeEngine()
						}
					}
					contexts.clear()
					events.removeAllListeners()
				})
				.finally(releaseClaim)
			return shutdown
		}
		try {
			await controlReady
			if (closing) throw new Error('Calling integration closed during initialization')
			const call = voip.call
			const accept = voip.accept
			return Object.assign(voip, {
				call: (peer: string, mediaOptions?: Parameters<VoipApi['call']>[1]) =>
					isJidGroup(peer) ? unsupported() : call(peer, mediaOptions),
				accept: (offer: WACallEvent, mediaOptions?: Parameters<VoipApi['accept']>[1]) =>
					offer.isGroup || offer.isVideo ? unsupported() : accept(offer, mediaOptions),
				disconnect,
				[Symbol.asyncDispose]: disconnect
			})
		} catch (error) {
			await disconnect()
			throw error
		}
	} catch (error) {
		releaseClaim()
		throw error
	}
}
