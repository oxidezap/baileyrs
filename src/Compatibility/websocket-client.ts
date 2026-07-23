import { EventEmitter } from 'node:events'
import { URL } from 'node:url'
import type { WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import { DEF_CALLBACK_PREFIX, DEF_TAG_PREFIX } from '../Defaults/index.ts'
import type { SocketConfig } from '../Types/index.ts'

type ReadyState = 0 | 1 | 2 | 3
type EventListener = Parameters<EventEmitter['on']>[1]

const isRawNodeEventName = (eventName: string | symbol): boolean =>
	typeof eventName === 'string' && (eventName.startsWith(DEF_CALLBACK_PREFIX) || eventName.startsWith(DEF_TAG_PREFIX))

export const isRawNodeForwardingEnabled = (client: WebSocketClient) => client.hasRawNodeListeners

/** Public WebSocket-compatible facade over the socket owned by the native client. */
export class WebSocketClient extends EventEmitter {
	readonly url: URL
	readonly config: SocketConfig
	protected readonly socket: { readonly readyState: ReadyState }

	private closing = false
	private closed = false
	private readonly getClient: () => WasmWhatsAppClient | undefined
	private listenerMutationDepth = 0

	constructor(url: string | URL, config: SocketConfig, getClient: () => WasmWhatsAppClient | undefined) {
		super()
		this.url = url instanceof URL ? url : new URL(url)
		this.config = config
		this.getClient = getClient
		this.setMaxListeners(0)
		this.socket = {} as { readonly readyState: ReadyState }
		Object.defineProperty(this.socket, 'readyState', {
			get: () => this.readyState,
			enumerable: true
		})
	}

	get isOpen(): boolean {
		return this.getClient()?.isConnected() ?? false
	}

	get isClosed(): boolean {
		return this.closed
	}

	get isClosing(): boolean {
		return this.closing
	}

	get isConnecting(): boolean {
		return !this.isOpen && !this.closing && !this.closed
	}

	get hasRawNodeListeners(): boolean {
		return this.eventNames().some(eventName => isRawNodeEventName(eventName))
	}

	private mutateListeners<T>(mutation: () => T): T {
		const outermost = this.listenerMutationDepth++ === 0
		const wasEnabled = outermost && this.hasRawNodeListeners
		try {
			return mutation()
		} finally {
			this.listenerMutationDepth--
			if (outermost) {
				const enabled = this.hasRawNodeListeners
				if (enabled !== wasEnabled) {
					try {
						this.getClient()?.setRawNodeForwarding(enabled)
					} catch {
						// The native handle may already have been freed during shutdown.
					}
				}
			}
		}
	}

	override on<_E extends string | symbol>(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.on(eventName, listener))
	}

	override addListener(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.addListener(eventName, listener))
	}

	override once(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.once(eventName, listener))
	}

	override prependListener(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.prependListener(eventName, listener))
	}

	override prependOnceListener(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.prependOnceListener(eventName, listener))
	}

	override removeListener(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.removeListener(eventName, listener))
	}

	override off(eventName: string | symbol, listener: EventListener): this {
		return this.mutateListeners(() => super.off(eventName, listener))
	}

	override removeAllListeners(eventName?: string | symbol): this {
		return this.mutateListeners(() =>
			eventName === undefined ? super.removeAllListeners() : super.removeAllListeners(eventName)
		)
	}

	connect(): void {
		const client = this.getClient()
		if (!client || client.isConnected()) return
		this.closed = false
		void client.connect().catch(error => this.emit('error', error))
	}

	async close(): Promise<void> {
		if (this.closing || this.closed) return
		this.closing = true
		try {
			await this.getClient()?.disconnect()
		} finally {
			this.closing = false
			this.closed = true
		}
	}

	send(str: string | Uint8Array, cb?: (err?: Error) => void): boolean {
		const client = this.getClient()
		if (!client) return false
		const bytes = typeof str === 'string' ? new TextEncoder().encode(str) : str
		void client.sendRawMessage(bytes).then(
			() => cb?.(),
			error => cb?.(error instanceof Error ? error : new Error(String(error)))
		)
		return true
	}

	private get readyState(): ReadyState {
		if (this.isOpen) return 1
		if (this.closing) return 2
		if (this.closed) return 3
		return 0
	}
}
