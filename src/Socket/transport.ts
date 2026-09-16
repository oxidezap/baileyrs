import type { JsHttpClientConfig, JsTransportCallbacks, JsTransportHandle } from '@oxidezap/whatsapp-rust-bridge'
import { DEFAULT_ORIGIN } from '../Defaults/index.ts'
import type { ILogger } from '../Utils/logger.ts'

interface TransportConfig {
	waWebSocketUrl: string | URL
	logger: ILogger
	/** RequestInit options passed to fetch() — use `dispatcher` for proxy/TLS config */
	options?: RequestInit
	/** Test-only opt-out of TLS verification, forwarded to the WS agent below. */
	dangerSkipCertChainVerify?: boolean
	/** Test-only WebSocket constructor, so unit tests observe the handshake options. */
	webSocketCtor?: typeof WebSocket
}

interface RuntimeUndici {
	Agent: new (options: unknown) => unknown
	WebSocket: typeof WebSocket
}

let defaultNodeDispatcher: unknown
/**
 * Resolve the undici module backing this runtime's WebSocket. `getBuiltinModule`
 * has no `undici` ID and always misses, so the transitive `import('undici')`
 * (undici v8 via link-preview-js) is the source on every Node.
 *
 * Both the Agent and the WebSocket class come from that one module, never
 * mixed with the global WebSocket: pairing a dispatcher built from one
 * undici major with a socket embedding another (npm v8 Agent with Node 24's
 * embedded v7 class) breaks close propagation — reproduced as a
 * run-completion hang where the server-side destroy is never observed.
 * A missing module means no dispatcher rather than a wrong one.
 */
const loadRuntimeUndici = async (): Promise<RuntimeUndici | undefined> => {
	const builtin = (
		typeof process !== 'undefined' ? (process as unknown as Record<string, unknown>).getBuiltinModule : undefined
	) as undefined | ((name: string) => unknown)
	if (typeof builtin === 'function') {
		try {
			const mod = builtin.call(process, 'undici') as RuntimeUndici | undefined
			if (mod?.Agent && mod?.WebSocket) return mod
		} catch {
			// Fall through to the npm copy below.
		}
	}
	try {
		const undici = (await import('undici')) as unknown as Partial<RuntimeUndici>
		if (!undici.Agent || !undici.WebSocket) return undefined
		return undici as RuntimeUndici
	} catch {
		return undefined
	}
}

const getDefaultDispatcher = async (undici: RuntimeUndici, insecure: boolean): Promise<unknown> => {
	if (defaultNodeDispatcher !== undefined && !insecure) return defaultNodeDispatcher
	try {
		// Node 22+ enables experimental WebSocket-over-HTTP/2 by default.
		// web.whatsapp.com does not support RFC 8441, so HTTP/2 handshakes
		// fail immediately with 400. Use an Agent with allowH2: false
		// unless the caller supplied their own dispatcher.
		// An undici Agent ignores NODE_TLS_REJECT_UNAUTHORIZED, which the
		// plain WebSocket path honoured: without this, pointing a socket at
		// a self-signed mock breaks the moment a dispatcher is set.
		const agent = new undici.Agent({
			allowH2: false,
			...(insecure ? { connect: { rejectUnauthorized: false } } : {})
		})
		// The insecure shape depends on the caller, so only the shared
		// secure one is cached: caching it would hand one test's opt-out
		// to every later socket in the process.
		if (!insecure) defaultNodeDispatcher = agent
		return agent
	} catch {
		if (!insecure) defaultNodeDispatcher = null
		return null
	}
}

/**
 * `WebSocket.send()` takes a `BufferSource`, which is `ArrayBufferView<ArrayBuffer>
 * | ArrayBuffer` — a `SharedArrayBuffer`-backed view is outside that contract.
 * The bridge hands us the wider `Uint8Array<ArrayBufferLike>`, so the backing
 * buffer has to be discriminated at runtime; this predicate is what carries that
 * runtime check into the type system.
 */
const isArrayBufferBacked = (data: Uint8Array): data is Uint8Array<ArrayBuffer> => data.buffer instanceof ArrayBuffer

/**
 * Narrows an outgoing frame to what `WebSocket.send()` accepts.
 *
 * The `ArrayBuffer` case returns the caller's view as-is. Rebuilding it — the
 * `new Uint8Array(data.buffer, data.byteOffset, data.byteLength)` this used to
 * do — produced a view over the same buffer at the same offset and length: an
 * allocation per outgoing frame that existed only to restate the type. It also
 * did not detach the view from WASM memory growth, so returning the original
 * gives the payload exactly the lifetime it had before; both are aliases of the
 * same linear memory, consumed synchronously by the `ws.send()` on the next line.
 *
 * The `SharedArrayBuffer` case still copies: that one is not a type formality,
 * the send API genuinely cannot take a view over shared memory.
 */
const asWebSocketPayload = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
	isArrayBufferBacked(data) ? data : new Uint8Array(data)

export const makeTransport = (config: TransportConfig): JsTransportCallbacks => {
	const { waWebSocketUrl, logger } = config
	let ws: WebSocket | undefined
	let handle: JsTransportHandle | undefined
	let disconnectTarget: WebSocket | undefined
	let connectionGeneration = 0
	const abortControllers = new WeakMap<WebSocket, AbortController>()

	return {
		async connect(h: JsTransportHandle) {
			const generation = ++connectionGeneration
			const url = typeof waWebSocketUrl === 'string' ? waWebSocketUrl : waWebSocketUrl.toString()

			const wsOptions: Record<string, unknown> = {}
			let WebSocketCtor: typeof WebSocket = WebSocket
			if (typeof process !== 'undefined' && process.versions?.node) {
				// Test-only paths (self-signed mock, NODE_TLS_REJECT_UNAUTHORIZED)
				// need the opt-out on the agent itself; callers keep passing
				// their own dispatcher first.
				const insecure = config.dangerSkipCertChainVerify === true || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
				const undici = await loadRuntimeUndici()
				const dispatcher = config.options?.dispatcher ?? (undici ? await getDefaultDispatcher(undici, insecure) : null)
				if (generation !== connectionGeneration) throw new Error('WebSocket connection superseded')
				if (dispatcher) wsOptions.dispatcher = dispatcher
				wsOptions.headers = { Origin: DEFAULT_ORIGIN }
				// Same-module socket for the Agent above, never the global
				// class: see loadRuntimeUndici for the cross-major breakage.
				if (undici) WebSocketCtor = undici.WebSocket
			}
			if (config.webSocketCtor) WebSocketCtor = config.webSocketCtor
			if (generation !== connectionGeneration) throw new Error('WebSocket connection superseded')
			handle = h
			disconnectTarget = ws

			const newWs =
				Object.keys(wsOptions).length > 0 ? new WebSocketCtor(url, wsOptions as never) : new WebSocketCtor(url)
			newWs.binaryType = 'arraybuffer'
			ws = newWs

			const ctrl = new AbortController()
			abortControllers.set(newWs, ctrl)
			const listenerOpts = { signal: ctrl.signal }

			return new Promise<void>((resolve, reject) => {
				let settled = false

				// Reject on abort. Without this, when `disconnect()` is called
				// between WS creation and the `open` event firing (common
				// during 515-driven reconnect bursts), `ctrl.abort()` removes
				// the open/close/error listeners that would settle this
				// promise — leaving it pending forever, until the Rust core's
				// 20s TRANSPORT_CONNECT_TIMEOUT trips and forces a retry.
				ctrl.signal.addEventListener('abort', () => {
					if (!settled) {
						settled = true
						reject(new Error('WebSocket aborted before open'))
					}
				})

				newWs.addEventListener(
					'open',
					() => {
						if (ws !== newWs) return
						settled = true
						handle?.onConnected()
						resolve()
					},
					listenerOpts
				)

				newWs.addEventListener(
					'message',
					(event: MessageEvent) => {
						if (ws !== newWs) return
						const data = event.data as ArrayBuffer
						handle?.onData(new Uint8Array(data))
					},
					listenerOpts
				)

				newWs.addEventListener(
					'close',
					() => {
						if (ws !== newWs) return
						handle?.onDisconnected()
						if (!settled) {
							settled = true
							reject(new Error('WebSocket closed before open'))
						}
					},
					listenerOpts
				)

				newWs.addEventListener(
					'error',
					event => {
						if (ws !== newWs) return
						logger.error({ err: event }, 'WebSocket error')
						if (!settled) {
							settled = true
							reject(new Error('WebSocket connection failed'))
						}
					},
					listenerOpts
				)
			})
		},
		send(data: Uint8Array) {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(asWebSocketPayload(data))
			}
		},
		// Zero-copy bridge capability for ArrayBuffer-backed views. SharedArrayBuffer
		// views are copied because the WebSocket BufferSource contract excludes them.
		// `WebSocket.send()` snapshots/enqueues synchronously; never retain this
		// WASM-backed view or cross an async boundary with it.
		sendBorrowed(data: Uint8Array) {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(asWebSocketPayload(data))
			}
		},
		async disconnect() {
			connectionGeneration++
			const toClose = disconnectTarget ?? ws
			if (toClose === ws) ws = undefined
			disconnectTarget = undefined

			if (!toClose) return

			// Fire onDisconnected BEFORE closing — the Rust engine's
			// read_messages_loop needs this event to exit and reconnect.
			handle?.onDisconnected()
			// Abort our listeners to prevent double-fire from the close event.
			abortControllers.get(toClose)?.abort()

			// Await the actual close before returning. Without this, the caller
			// (core's `connect_and_run` on a 515 reconnect path) can race-open a
			// brand-new WebSocket while the previous TCP connection is still in
			// CLOSING on the server side; some servers queue/reject the new
			// accept() until the old one is fully released, stalling reconnect
			// to the 20s connect-timeout ceiling.
			if (toClose.readyState === WebSocket.CLOSED) return

			const closed = new Promise<void>(resolve => {
				const done = () => resolve()
				toClose.addEventListener('close', done, { once: true })
			})
			try {
				toClose.close()
			} catch {
				// already closed
				return
			}
			// Bound the wait so a pathological close (e.g. half-open TCP peer
			// never acking FIN) can't hang shutdown beyond a short grace period.
			await Promise.race([closed, new Promise<void>(r => setTimeout(r, 500).unref())])
		}
	}
}

export const makeHttpClient = (config: TransportConfig): JsHttpClientConfig => ({
	async execute(url, method, headers, body) {
		const fetchOpts: RequestInit = { method, headers }
		if (body) fetchOpts.body = body as unknown as BodyInit
		if (config.options?.dispatcher) fetchOpts.dispatcher = config.options.dispatcher

		const resp = await fetch(url, fetchOpts)
		const buf = new Uint8Array(await resp.arrayBuffer())
		return { statusCode: resp.status, body: buf }
	}
})
