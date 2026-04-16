import type { JsHttpClientConfig, JsTransportCallbacks, JsTransportHandle } from 'whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger'

interface TransportConfig {
	waWebSocketUrl: string | URL
	logger: ILogger
	/** RequestInit options passed to fetch() — use `dispatcher` for proxy/TLS config */
	options?: RequestInit
}

export const makeTransport = (config: TransportConfig): JsTransportCallbacks => {
	const { waWebSocketUrl, logger } = config
	let ws: WebSocket | undefined
	let handle: JsTransportHandle | undefined
	let disconnectTarget: WebSocket | undefined

	return {
		connect(h: JsTransportHandle) {
			handle = h
			const url = typeof waWebSocketUrl === 'string' ? waWebSocketUrl : waWebSocketUrl.toString()

			disconnectTarget = ws

			const newWs = new WebSocket(url)
			newWs.binaryType = 'arraybuffer'
			ws = newWs

			return new Promise<void>((resolve, reject) => {
				let settled = false

				newWs.onopen = () => {
					if (ws !== newWs) return
					settled = true
					handle?.onConnected()
					resolve()
				}

				newWs.onmessage = (event: MessageEvent) => {
					if (ws !== newWs) return
					const data = event.data as ArrayBuffer
					handle?.onData(new Uint8Array(data))
				}

				newWs.onclose = () => {
					if (ws !== newWs) return
					handle?.onDisconnected()
					if (!settled) {
						settled = true
						reject(new Error('WebSocket closed before open'))
					}
				}

				newWs.onerror = event => {
					if (ws !== newWs) return
					logger.error({ err: event }, 'WebSocket error')
					if (!settled) {
						settled = true
						reject(new Error('WebSocket connection failed'))
					}
				}
			})
		},
		send(data: Uint8Array) {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(data)
			}
		},
		disconnect() {
			const toClose = disconnectTarget ?? ws
			if (toClose) {
				// Fire onDisconnected BEFORE closing — the Rust engine's
				// read_messages_loop needs this event to exit and reconnect.
				handle?.onDisconnected()
				// Remove handlers to prevent double-fire from the close event
				toClose.onopen = null
				toClose.onmessage = null
				toClose.onclose = null
				toClose.onerror = null
				try {
					toClose.close()
				} catch {
					// already closed
				}
			}

			if (toClose === ws) ws = undefined
			disconnectTarget = undefined
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
