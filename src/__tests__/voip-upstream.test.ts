import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge/host'
import {
	createBaileysVoip,
	type BaileysCallControl,
	type BaileysVoipRuntime,
	type BaileysVoipSocket
} from '../Voip/baileys.ts'
import type { BinaryNode } from '../Types/BinaryNode.ts'
import type { CallEndResult, CallMediaStats, WACallEvent } from '../Types/Call.ts'

const peer = '222222222222222@lid',
	self = '111111111111111@lid'
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
const stats: CallMediaStats = {
	rtpReceived: 0,
	rtpPayloadTypeUnexpected: 0,
	srtpUnprotectFailed: 0,
	sframeDecryptFailed: 0,
	audioFramesDecoded: 0,
	audioFramesDelivered: 0,
	audioFramesConcealed: 0,
	mlowOffPointDropped: 0,
	mlowInactiveOrSid: 0,
	foreignFramesDecoded: 0,
	audioFramesWithoutDecoder: 0,
	outboundFramesWithoutEncoder: 0,
	playoutTrimmedSamples: 0,
	inboundPipeDropped: 0,
	audioSinkDropped: 0,
	videoSinkDropped: 0,
	peerKeyframeRequests: 0,
	relayPacketUnclassified: 0,
	forwardingEnvelopeRejected: 0,
	codecSwitches: 0
}
const input = (...chunks: Int16Array[]) =>
	new ReadableStream<Int16Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk)
			controller.close()
		}
	})
const raw = (id: string, action = 'offer', data?: Uint8Array): BinaryNode => ({
	tag: 'call',
	attrs: { id: `STANZA-${id}`, from: peer },
	content: [{ tag: action, attrs: { 'call-id': id, 'call-creator': peer }, ...(data ? { content: data } : {}) }]
})
const offer = (id: string): WACallEvent => ({
	id,
	from: peer,
	chatId: peer,
	status: 'offer',
	date: new Date(0),
	offline: false,
	isVideo: false,
	isGroup: false
})

const harness = () => {
	const ws = Object.assign(new EventEmitter(), { isOpen: true }),
		ev = new EventEmitter()
	ws.setMaxListeners(0)
	const errors: { error: unknown; message: string }[] = []
	const received: BinaryNode[] = [],
		sent: BinaryNode[] = [],
		encrypted: Uint8Array[] = [],
		frames: { samples: Int16Array; at: number }[] = []
	let callbacks!: Parameters<BaileysVoipRuntime['createCallControl']>[1]
	let host!: Parameters<BaileysVoipRuntime['createCallControl']>[0]
	let starts = 0,
		accepts = 0,
		handlesFreed = 0,
		disconnected = 0,
		freed = 0,
		enginesDisposed = 0
	let ingressGate: ReturnType<typeof deferred<void>> | undefined
	let engineGate: ReturnType<typeof deferred<void>> | undefined
	let failure: unknown
	let endResult: CallEndResult = { outcome: 'peer-notified' }
	let accepted = true,
		pushing = true
	const terminations: unknown[][] = []
	const jid = (value: string) => {
		const [user, server] = value.split('@')
		return { user, server, device: 0, agent: 0 }
	}
	const event = (id: string, action: string, creator = self) =>
		callbacks.onEvent({
			type: 'incoming_call',
			data: {
				from: jid(peer),
				timestamp: 1,
				offline: false,
				action: { type: action, call_id: id, call_creator: jid(creator), is_video: false }
			}
		} as unknown as WhatsAppEvent)
	const ready = (id: string) => {
		callbacks.onCallEvent({ kind: 'relay-allocated', callId: id })
		if (accepted) event(id, 'accept')
	}
	const control: BaileysCallControl = {
		async dialCallPcm(resolved) {
			starts++
			await host.prepareKeys(resolved, new Uint8Array([1, 2, 3]))
			const ack = host.watchAck(`REQUEST-${starts}`)
			await host.sendNode({ tag: 'call', attrs: { id: `REQUEST-${starts}`, to: resolved } })
			await ack.promise
			const callId = `CALL-${starts}`
			ready(callId)
			return {
				callId,
				free() {
					handlesFreed++
				}
			}
		},
		async acceptCallPcm(id) {
			accepts++
			ready(id)
			return {
				callId: id,
				free() {
					handlesFreed++
				}
			}
		},
		callPushPcm16(_id, samples) {
			assert.equal(freed, 0, 'no push after native free')
			frames.push({ samples: samples.slice(), at: performance.now() })
			return pushing
		},
		async endCall() {
			return endResult
		},
		async terminateCall(...args) {
			terminations.push(args)
			return { outcome: 'peer-notified' }
		},
		async setCallMuted() {},
		getCallMediaStats: () => stats,
		async receiveNode(node) {
			received.push(node)
			await ingressGate?.promise
			if (failure) throw failure
			const child = Array.isArray(node.content) ? node.content[0] : undefined
			if (node.tag === 'call' && child?.attrs['call-id'])
				event(child.attrs['call-id'], child.tag, child.attrs['call-creator'])
		},
		disconnect() {
			disconnected++
		},
		free() {
			freed++
		}
	}
	const runtime: BaileysVoipRuntime = {
		async loadEngine() {
			await engineGate?.promise
			return {
				voipBackend: { sendFrame: async frame => frame, setPushHandler() {} },
				dispose() {
					enginesDisposed++
				}
			}
		},
		async createCallControl(suppliedHost, suppliedCallbacks) {
			host = suppliedHost
			callbacks = suppliedCallbacks
			return control
		}
	}
	const socket: BaileysVoipSocket = {
		ws,
		ev,
		authState: {
			creds: { me: { id: '11111111111@s.whatsapp.net', lid: self }, account: {} },
			keys: { get: async () => ({}) }
		},
		signalRepository: {
			lidMapping: { getLIDForPN: async () => peer },
			getSessionInfo: async () => ({ baseKey: new Uint8Array([1]), registrationId: 7 }),
			async encryptMessage({ data }) {
				encrypted.push(data)
				return { type: 'msg', ciphertext: new Uint8Array([3]) }
			},
			decryptMessage: async ({ ciphertext }) => ciphertext
		},
		getUSyncDevices: async () => [{ jid: peer, device: 0 }],
		assertSessions: async () => true,
		generateMessageTag: () => 'HOST-REQUEST',
		async sendNode(node) {
			sent.push(node)
			ws.emit(`TAG:${node.attrs.id}`, { tag: 'ack', attrs: { id: node.attrs.id, class: 'call' } })
		}
	}
	const open = () =>
		createBaileysVoip(socket, {
			runtime,
			encodeDeviceIdentity: () => new Uint8Array([9]),
			reportError: (error, message) => errors.push({ error, message })
		})
	return {
		open,
		socket,
		ws,
		ev,
		errors,
		received,
		sent,
		encrypted,
		frames,
		terminations,
		runtime,
		control,
		event,
		ready,
		get callbacks() {
			return callbacks
		},
		counts: () => ({ starts, accepts, handlesFreed, disconnected, freed, enginesDisposed }),
		blockIngress() {
			return (ingressGate = deferred<void>())
		},
		blockEngine() {
			return (engineGate = deferred<void>())
		},
		failIngress(error: unknown) {
			failure = error
		},
		setEndResult(result: CallEndResult) {
			endResult = result
		},
		setAccepted(value: boolean) {
			accepted = value
		},
		setPushing(value: boolean) {
			pushing = value
		}
	}
}

describe('calling on an existing upstream Baileys socket', () => {
	it('refuses duplicate pending or active attachments before starting another engine', async () => {
		const h = harness(),
			gate = h.blockEngine(),
			initializing = h.open()
		let loads = 0
		const load = h.runtime.loadEngine
		h.runtime.loadEngine = (...args) => {
			loads++
			return load(...args)
		}
		await tick()
		await assert.rejects(h.open(), /already attached/)
		assert.equal(loads, 1)
		gate.resolve()
		const api = await initializing
		await assert.rejects(h.open(), /already attached/)
		assert.equal(loads, 1)
		assert.equal(h.ws.listenerCount('CB:call'), 1)
		await api.disconnect()
		const replacement = await h.open()
		assert.equal(loads, 2)
		assert.equal(h.ws.listenerCount('CB:call'), 1)
		await api.disconnect()
		await assert.rejects(h.open(), /already attached/, 'old cleanup must not release the replacement claim')
		await replacement.disconnect()
	})
	it('refuses sockets with an existing native calling API before loading any engine', async () => {
		const h = harness()
		const existing = { call() {} }
		Object.assign(h.socket, { voip: existing })
		h.runtime.loadEngine = async () => {
			throw new Error('must not load a second engine')
		}
		await assert.rejects(h.open(), /use its existing calling API/)
		assert.equal(Reflect.get(h.socket, 'voip'), existing)
		assert.equal(h.ws.listenerCount('CB:call'), 0)
		assert.equal(h.ev.listenerCount('connection.update'), 0)
	})
	it('releases its own socket claim after constructor failure and synchronous option validation', async () => {
		const h = harness(),
			create = h.runtime.createCallControl
		h.runtime.createCallControl = async () => {
			throw new Error('synthetic construction failure')
		}
		await assert.rejects(h.open(), /synthetic construction/)
		h.runtime.createCallControl = create
		await assert.rejects(
			createBaileysVoip(h.socket, {
				runtime: h.runtime,
				encodeDeviceIdentity: () => new Uint8Array([1]),
				ackTimeoutMs: -1
			}),
			/ackTimeoutMs/
		)
		const api = await h.open()
		assert.equal(h.ws.listenerCount('CB:call'), 1)
		await api.disconnect()
	})
	it('uses host encryption and the shared PCM session with EOF independent of call lifetime', async () => {
		const h = harness(),
			api = await h.open(),
			call = await api.call('22222222222@s.whatsapp.net')
		await call.ready
		await call.audio.play(input(new Int16Array(1024)))
		await call.audio.play(input(new Int16Array(960)))
		assert.equal(call.lifecycle, 'open')
		assert.equal(h.frames.length, 3)
		assert.ok(h.frames.every(frame => frame.samples.length === 960))
		assert.ok(h.frames[1]!.at - h.frames[0]!.at >= 45, 'shared pacing delays the split final frame')
		assert.equal(h.encrypted.length, 1)
		assert.equal(h.sent[0]!.attrs.to, peer)
		assert.equal(h.counts().handlesFreed, 1)
		await call.end()
		await api.disconnect()
		assert.deepEqual(h.counts(), {
			starts: 1,
			accepts: 0,
			handlesFreed: 1,
			disconnected: 1,
			freed: 1,
			enginesDisposed: 1
		})
	})
	it('waits for peer acceptance, preserves source cancellation and permits the next source', async () => {
		const h = harness()
		h.setAccepted(false)
		const api = await h.open(),
			call = await api.call(peer),
			abort = new AbortController()
		let pulled = false,
			cancelled = false
		const playing = call.audio.play(
			new ReadableStream(
				{
					pull() {
						pulled = true
					},
					cancel() {
						cancelled = true
					}
				},
				{ highWaterMark: 0 }
			),
			{ signal: abort.signal }
		)
		await tick()
		assert.equal(pulled, false)
		abort.abort()
		await assert.rejects(playing, { name: 'AbortError' })
		assert.equal(cancelled, true)
		h.event(call.id, 'accept')
		await call.ready
		await call.audio.play(input(new Int16Array(960)))
		assert.equal(h.frames.length, 1)
		assert.equal(call.lifecycle, 'open')
		await api.disconnect()
	})
	it('shares bounded receiver queues and reports backend shedding', async () => {
		const h = harness(),
			api = await h.open(),
			call = await api.call(peer)
		let dropped = 0
		const slow = call.audio.receive({
				onDrop: count => {
					dropped = count
				}
			}),
			fast = call.audio.receive().getReader()
		for (let index = 0; index < 100; index++) {
			const reading = fast.read()
			h.callbacks.onCallPcm({ callId: call.id, data: new Int16Array(960).fill(index) })
			assert.equal((await reading).value![0], index)
		}
		assert.equal(dropped, 99)
		await slow.cancel()
		await fast.cancel()
		fast.releaseLock()
		h.setPushing(false)
		await call.audio.play(input(new Int16Array(960)))
		assert.equal((await call.stats()).io.audioInputShed, 1)
		await api.disconnect()
	})
	it('serializes an early upstream offer before accepting without re-emitting upstream events or ACKs', async () => {
		const h = harness(),
			api = await h.open(),
			gate = h.blockIngress()
		let appCalls = 0
		const appListener = () => {
			appCalls++
		}
		h.ev.on('call', appListener)
		h.ws.emit('CB:call', raw('INCOMING'))
		h.ev.emit('call', [offer('INCOMING')])
		const answering = api.accept(offer('INCOMING'))
		await tick()
		assert.equal(h.counts().accepts, 0)
		gate.resolve()
		const call = await answering
		await call.ready
		assert.equal(h.counts().accepts, 1)
		assert.equal(appCalls, 1)
		assert.equal(h.sent.length, 0, 'generic ACK remains the existing socket handler responsibility')
		await api.disconnect()
		assert.deepEqual(h.ev.listeners('call'), [appListener])
	})
	it('snapshots raw nodes before asynchronous ingress and ignores ordinary messaging receipts', async () => {
		const h = harness(),
			api = await h.open(),
			payload = new Uint8Array([3, 4]),
			node = raw('SNAPSHOT', 'offer', payload)
		h.ws.emit('CB:call', node)
		node.attrs.from = 'mutated@lid'
		payload.fill(9)
		for (let index = 0; index < 1000; index++)
			h.ws.emit('CB:receipt', {
				tag: 'receipt',
				attrs: { id: String(index) },
				content: [{ tag: 'item', attrs: { id: 'MESSAGE' } }]
			})
		await tick()
		assert.equal(h.received.length, 1)
		assert.equal(h.received[0]!.attrs.from, peer)
		assert.deepEqual((h.received[0]!.content as BinaryNode[])[0]!.content, new Uint8Array([3, 4]))
		h.ws.emit('CB:receipt', {
			tag: 'receipt',
			attrs: { id: 'RECEIPT' },
			content: [{ tag: 'offer', attrs: { 'call-id': 'SNAPSHOT' } }]
		})
		await tick()
		assert.equal(h.received.length, 1)
		assert.equal(h.errors.length, 0)
		await api.disconnect()
	})
	it('keeps routing context for incomplete hangup and retries via the resolved signaling peer', async () => {
		const h = harness(),
			api = await h.open(),
			call = await api.call('22222222222@s.whatsapp.net')
		h.setEndResult({ outcome: 'local-only', failure: 'synthetic peer failure' })
		assert.deepEqual(await call.end(), { outcome: 'peer-notified' })
		assert.deepEqual(h.terminations, [[call.id, peer, self]])
		await api.disconnect()
	})
	it('reports rejected ingress observably while keeping supported calls available', async () => {
		const h = harness(),
			api = await h.open(),
			failure = new Error('synthetic unsupported signaling')
		h.failIngress(failure)
		h.ws.emit('CB:call', raw('UNSUPPORTED', 'video'))
		await tick()
		assert.equal(h.errors[0]!.error, failure)
		assert.equal(h.counts().freed, 0)
		const call = await api.call(peer)
		await call.ready
		await api.disconnect()
	})
	it('reports malformed media events without throwing or interrupting the call', async () => {
		const h = harness(),
			api = await h.open(),
			call = await api.call(peer)
		await call.ready
		const invalid = [null, undefined, {}, { kind: 'ended' }, { kind: 'ended', callId: 1 }]
		for (const event of invalid) assert.doesNotThrow(() => h.callbacks.onCallEvent(event as never))
		assert.equal(h.errors.filter(item => /malformed call media event/.test(String(item.error))).length, invalid.length)
		await call.end()
		await api.disconnect()
	})
	it('reclaims backend-only ended contexts across more than 256 calls', async () => {
		const h = harness(),
			api = await h.open()
		for (let i = 0; i < 258; i++) {
			const call = await api.call(peer)
			h.callbacks.onCallEvent({ kind: 'ended', callId: call.id })
			await call.closed
		}
		assert.equal(h.counts().starts, 258)
		await api.disconnect()
	})
	it('does not retain context when the backend ends before dial resolves', async () => {
		const h = harness(),
			original = h.control.dialCallPcm
		h.control.dialCallPcm = async (...args) => {
			const result = await original(...args)
			h.callbacks.onCallEvent({ kind: 'ended', callId: typeof result === 'string' ? result : result.callId })
			return result
		}
		const api = await h.open()
		for (let i = 0; i < 258; i++) await assert.rejects(api.call(peer), /ended/)
		assert.equal(h.counts().starts, 258)
		await api.disconnect()
	})
	it('retains incoming routing across ended during native hangup and retries failed signaling', async () => {
		const h = harness(),
			api = await h.open()
		h.setAccepted(false)
		h.event('RETRY-INCOMING', 'offer', peer)
		const call = await api.accept(offer('RETRY-INCOMING'))
		let nativeEnds = 0,
			fallbackEnds = 0
		h.control.endCall = async () => {
			nativeEnds++
			h.callbacks.onCallEvent({ kind: 'ended', callId: call.id })
			await tick()
			return { outcome: 'local-only', failure: 'peer unavailable' }
		}
		h.control.terminateCall = async (...args) => {
			h.terminations.push(args)
			if (++fallbackEnds === 1) throw new Error('fallback unavailable')
			return { outcome: 'peer-notified' }
		}
		await assert.rejects(call.end(), /fallback unavailable/)
		h.callbacks.onCallEvent({ kind: 'ended', callId: call.id })
		assert.deepEqual(await call.end(), { outcome: 'peer-notified' })
		assert.equal(nativeEnds, 1, 'incomplete native hangup must not masquerade as notified on retry')
		assert.deepEqual(h.terminations, [
			[call.id, peer, peer],
			[call.id, peer, peer]
		])
		await api.disconnect()
	})
	it('returns the shared rejected Promise for invalid accept input', async () => {
		const h = harness(),
			api = await h.open()
		let result!: Promise<unknown>
		assert.doesNotThrow(() => {
			result = api.accept(undefined as never)
		})
		assert.ok(result instanceof Promise)
		await assert.rejects(result)
		assert.equal(h.counts().accepts, 0)
		await api.disconnect()
	})
	it('rejects advanced capabilities before dialing or accepting', async () => {
		const h = harness(),
			api = await h.open()
		await assert.rejects(api.call('123@g.us'), /1:1 PCM/)
		await assert.rejects(api.call(peer, { video: true }), /1:1 PCM/)
		await assert.rejects(api.accept({ ...offer('VIDEO'), isVideo: true }), /1:1 PCM/)
		await assert.rejects(api.accept({ ...offer('GROUP'), isGroup: true }), /1:1 PCM/)
		const call = await api.call(peer)
		await assert.rejects(call.video.start(), /1:1 PCM/)
		assert.equal(h.counts().starts, 1)
		assert.equal(h.counts().accepts, 0)
		await api.disconnect()
	})
	it('caps ingress count, detaches only its listeners and waits before freeing active native work', async () => {
		const h = harness(),
			original = () => {}
		h.ws.on('CB:call', original)
		const api = await h.open(),
			gate = h.blockIngress()
		h.ws.emit('CB:call', raw('BLOCKED'))
		await tick()
		for (let index = 0; index < 64; index++) h.ws.emit('CB:call', raw(`QUEUED-${index}`))
		assert.ok(h.errors.some(item => /queue overflow/.test(String(item.error))))
		assert.deepEqual(h.ws.listeners('CB:call'), [original])
		assert.equal(h.counts().freed, 0)
		gate.resolve()
		await api.disconnect()
		assert.equal(h.received.length, 1)
		assert.equal(h.counts().freed, 1)
	})
	it('checks retained buffer size before cloning a tiny view over an oversized backing store', async () => {
		const h = harness(),
			api = await h.open()
		h.ws.emit('CB:call', raw('OVERSIZED', 'offer', new Uint8Array(new ArrayBuffer(1_048_577), 0, 1)))
		await api.disconnect()
		assert.ok(h.errors.some(item => /1 MiB/.test(String(item.error))))
		assert.equal(h.received.length, 0)
	})
	it('rejects shared backing stores that structuredClone cannot make immutable', async () => {
		const h = harness(),
			api = await h.open()
		h.ws.emit('CB:call', raw('SHARED', 'offer', new Uint8Array(new SharedArrayBuffer(4))))
		await api.disconnect()
		assert.ok(h.errors.some(item => /Shared call payload/.test(String(item.error))))
		assert.equal(h.received.length, 0)
	})
	it('caps queued payload bytes independently of message count', async () => {
		const h = harness(),
			api = await h.open(),
			gate = h.blockIngress()
		h.ws.emit('CB:call', raw('LARGE', 'offer', new Uint8Array(650_000)))
		await tick()
		for (let index = 0; index < 6; index++)
			h.ws.emit('CB:call', raw(`LARGE-${index}`, 'offer', new Uint8Array(650_000)))
		assert.ok(h.errors.some(item => /queue overflow/.test(String(item.error))))
		gate.resolve()
		await api.disconnect()
		assert.equal(h.received.length, 1)
	})
	it('closes media on socket termination without closing or replacing the upstream socket', async () => {
		const h = harness(),
			api = await h.open(),
			call = await api.call(peer)
		let cancelled = false
		const playing = call.audio.play(
			new ReadableStream<Int16Array>({
				pull() {
					return new Promise(() => {})
				},
				cancel() {
					cancelled = true
				}
			})
		)
		const observed = playing.catch(() => undefined)
		await tick()
		h.ev.emit('connection.update', { connection: 'close' })
		await api.disconnect()
		await observed
		assert.equal(cancelled, true)
		assert.equal((await call.closed).reason, 'socket-closed')
		assert.equal(h.ws.isOpen, true)
		assert.equal(h.ws.listenerCount('CB:call'), 0)
		assert.equal(h.ev.listenerCount('connection.update'), 0)
		assert.equal(h.counts().freed, 1)
		await api[Symbol.asyncDispose]()
		assert.equal(h.counts().freed, 1)
	})
	it('cleans late initialization resources after a socket close wins engine loading', async () => {
		const h = harness(),
			gate = h.blockEngine(),
			initializing = h.open()
		await tick()
		h.ev.emit('connection.update', { connection: 'close' })
		assert.equal(h.ws.listenerCount('CB:call'), 0)
		await assert.rejects(initializing, /closed during initialization/)
		assert.equal(h.counts().enginesDisposed, 0)
		gate.resolve()
		await tick()
		assert.equal(h.counts().enginesDisposed, 1)
		assert.equal(h.counts().freed, 0)
	})
	it('rejects promptly when construction is parked and disposes a late native result exactly once', async () => {
		const h = harness(),
			gate = deferred<void>(),
			entered = deferred<void>()
		const create = h.runtime.createCallControl
		h.runtime.createCallControl = async (...args) => {
			entered.resolve()
			await gate.promise
			return create(...args)
		}
		const initializing = h.open()
		await entered.promise
		h.ev.emit('connection.update', { connection: 'close' })
		await assert.rejects(initializing, /closed during initialization/)
		assert.equal(h.counts().freed, 0)
		assert.equal(h.counts().enginesDisposed, 0, 'pending constructor still owns the engine')
		assert.equal(h.ws.listenerCount('CB:call'), 0)
		gate.resolve()
		await tick()
		assert.equal(h.counts().disconnected, 1)
		assert.equal(h.counts().freed, 1)
		assert.equal(h.counts().enginesDisposed, 1)
	})
	it('reports asynchronous ingress failure by default without dumping the raw node', async context => {
		const logged: unknown[][] = []
		context.mock.method(console, 'error', (...args: unknown[]) => {
			logged.push(args)
		})
		const h = harness(),
			api = await createBaileysVoip(h.socket, { runtime: h.runtime, encodeDeviceIdentity: () => new Uint8Array([1]) })
		h.failIngress(new Error('synthetic private payload should not be logged'))
		h.ws.emit('CB:call', raw('ERROR'))
		await tick()
		assert.deepEqual(logged, [
			['Baileyrs calling integration error', { operation: 'processing upstream call signaling', name: 'Error' }]
		])
		await api.disconnect()
	})
	it('cleans listeners and loaded engine when native construction rejects', async () => {
		const h = harness(),
			failure = new Error('synthetic control constructor failed')
		h.runtime.createCallControl = async () => {
			throw failure
		}
		await assert.rejects(h.open(), error => error === failure)
		assert.equal(h.ws.listenerCount('CB:call'), 0)
		assert.equal(h.ev.listenerCount('connection.update'), 0)
		assert.equal(h.counts().enginesDisposed, 1)
	})
})
