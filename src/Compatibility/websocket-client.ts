import { EventEmitter } from 'node:events'
import { URL } from 'node:url'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { DEF_CALLBACK_PREFIX, DEF_TAG_PREFIX } from '../Defaults/index.ts'
import type { SocketConfig } from '../Types/index.ts'

type ReadyState = 0 | 1 | 2 | 3

/** Both settled phases carry the same promise, so a late caller awaits the real close. */
type CloseState =
	| { readonly phase: 'open' }
	| { readonly phase: 'closing'; readonly done: Promise<void> }
	| { readonly phase: 'closed'; readonly done: Promise<void> }
type EventListener = Parameters<EventEmitter['on']>[1]

const isRawNodeEventName = (eventName: string | symbol): boolean =>
	typeof eventName === 'string' && (eventName.startsWith(DEF_CALLBACK_PREFIX) || eventName.startsWith(DEF_TAG_PREFIX))

export const isRawNodeForwardingEnabled = (client: WebSocketClient) => client.hasRawNodeListeners

/** Public WebSocket-compatible facade over the socket owned by the native client. */
export class WebSocketClient extends EventEmitter {
	readonly url: URL
	readonly config: SocketConfig
	protected readonly socket: { readonly readyState: ReadyState }

	/**
	 * One value rather than a pair of booleans plus a promise that could
	 * disagree with them. `closing` carries the in-flight close so a second
	 * caller joins it instead of returning while the first `disconnect()` is
	 * still running — which is how teardown reached `free()` on a busy client.
	 */
	private closeState: CloseState = { phase: 'open' }
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
		return this.closeState.phase === 'closed'
	}

	get isClosing(): boolean {
		return this.closeState.phase === 'closing'
	}

	get isConnecting(): boolean {
		return !this.isOpen && this.closeState.phase === 'open'
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
		// A close in flight has already told the client to disconnect, which is
		// exactly what makes `isConnected()` false above. Reopening here would
		// clear the `closing` phase, and the next `close()` would start a second
		// disconnect against the same client while the first is still running.
		if (this.closeState.phase === 'closing') return
		this.closeState = { phase: 'open' }
		void client.connect().catch(error => this.emit('error', error))
	}

	/**
	 * Idempotent, and a second caller joins the first rather than returning
	 * while it is still going.
	 *
	 * The early return used to be bare: `void ws.close(); await sock.end()` saw
	 * the flag, returned immediately, and let teardown reach `free()` with the
	 * original `disconnect()` still in flight — the wasm heap corruption
	 * `bridge-free-safety.test.ts` documents. Awaiting a *second* `disconnect()`
	 * does not join the first one.
	 *
	 * The state is stored before `disconnect()` is called, and the work is
	 * deferred by a microtask to make that ordering hold: an inline async body
	 * runs eagerly to its first `await`, so `disconnect()` would be invoked
	 * while the state still said `open`, and anything it reaches synchronously
	 * that calls back into `close()` would issue a second one.
	 */
	async close(): Promise<void> {
		if (this.closeState.phase !== 'open') return this.closeState.done

		const done: Promise<void> = Promise.resolve().then(async () => {
			try {
				await this.getClient()?.disconnect()
			} finally {
				this.closeState = { phase: 'closed', done }
			}
		})
		this.closeState = { phase: 'closing', done }
		return done
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
		if (this.closeState.phase === 'closing') return 2
		if (this.closeState.phase === 'closed') return 3
		return 0
	}
}
