import EventEmitter from 'node:events'
import type { BaileysEventEmitter, BaileysEventMap } from '../Types/index'

/**
 * Simple event emitter with `process()` support for Baileys events.
 * The bridge handles event ordering internally — no buffering needed.
 */
export const makeEventBuffer = (): BaileysEventEmitter => {
	const ev = new EventEmitter()
	ev.setMaxListeners(100)

	const emitter = ev as unknown as BaileysEventEmitter

	emitter.process = handler => {
		const EVENTS: (keyof BaileysEventMap)[] = [
			'connection.update',
			'creds.update',
			'messaging-history.set',
			'chats.upsert',
			'chats.update',
			'chats.delete',
			'contacts.upsert',
			'contacts.update',
			'messages.upsert',
			'messages.update',
			'messages.delete',
			'messages.reaction',
			'message-receipt.update',
			'groups.upsert',
			'groups.update',
			'group-participants.update',
			'blocklist.set',
			'blocklist.update',
			'presence.update',
			'labels.edit',
			'labels.association'
		]

		for (const event of EVENTS) {
			ev.on(event, (data: unknown) => {
				void handler({ [event]: data } as Partial<BaileysEventMap>)
			})
		}
	}

	return emitter
}
