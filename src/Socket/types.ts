import type { EventEmitter } from 'events'
import type { WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import type { BaileysEventEmitter, SocketConfig } from '../Types/index'
import type { ILogger } from '../Utils/logger'

/** Shared context passed to all Socket method factories */
export interface SocketContext {
	ev: BaileysEventEmitter
	logger: ILogger
	fullConfig: SocketConfig
	getUser: () => { id?: string; lid?: string } | undefined
	setUser: (u: { id?: string; lid?: string }) => void
	/** Returns the bridge client, awaiting initialization if needed */
	getClient: () => Promise<WasmWhatsAppClient>
	/** Returns the bridge client synchronously, throws if not yet initialized */
	getClientSync: () => WasmWhatsAppClient
	/** Raw stanza EventEmitter for CB: pattern compat */
	ws: EventEmitter
}

/** Convert a bridge Jid struct to a string */
export const jidStr = (jid: { user: string; server: string }): string => `${jid.user}@${jid.server}`
