import type { EventEmitter } from 'events'
import type { Contact, SocketConfig } from '../Types/index.ts'
import type { makeEventBuffer } from '../Utils/event-buffer.ts'
import type { ILogger } from '../Utils/logger.ts'
import type { ClientOperations } from './client-operations.ts'

/** Shared context passed to all Socket method factories */
export interface SocketContext extends ClientOperations {
	ev: ReturnType<typeof makeEventBuffer>
	logger: ILogger
	fullConfig: SocketConfig
	getUser: () => { id?: string; lid?: string } | undefined
	getMe: () => Contact | undefined
	setUser: (u: { id?: string; lid?: string }) => void
	/** Raw stanza EventEmitter for CB: pattern compat */
	ws: EventEmitter
	/**
	 * Where a failure goes when it has nowhere else to go: a dispatcher that
	 * threw, a wire batch that would not decode. Also what the socket exposes
	 * as `onUnexpectedError`, so the two are one reporter rather than two.
	 */
	reportUnexpectedError: (err: unknown, msg: string) => void
}

/** Convert a bridge Jid struct to a string */
export const jidStr = (jid: { user: string; server: string }): string => `${jid.user}@${jid.server}`
