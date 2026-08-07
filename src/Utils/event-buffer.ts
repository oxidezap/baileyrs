import EventEmitter from 'node:events'
import type { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type {
	BaileysEvent,
	BaileysEventEmitter,
	BaileysEventMap,
	BufferedEventData,
	Chat,
	ChatUpdate,
	Contact,
	WAMessageKey
} from '../Types/index.ts'
import { WAMessageStatus } from '../Types/index.ts'
import { trimUndefined } from './generics.ts'
import type { ILogger } from './logger.ts'
import { updateMessageWithReaction, updateMessageWithReceipt } from './messages.ts'
import { isRealMessage, shouldIncrementChatUnread } from './process-message.ts'

const BUFFERABLE_EVENTS = [
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
	'groups.update'
] as const

type BufferableEvent = (typeof BUFFERABLE_EVENTS)[number]
type BaileysEventData = Partial<BaileysEventMap>
const BUFFERABLE_EVENT_SET = new Set<BaileysEvent>(BUFFERABLE_EVENTS)

type BaileysBufferableEventEmitter = BaileysEventEmitter & {
	process(handler: (events: BaileysEventData) => void | Promise<void>): () => void
	buffer(): void
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createBufferedFunction<A extends any[], T>(work: (...args: A) => Promise<T>): (...args: A) => Promise<T>
	flush(): boolean
	isBuffering(): boolean
	destroy(): void
}

const makeBufferData = (): BufferedEventData => ({
	historySets: {
		chats: {},
		messages: {},
		contacts: {},
		isLatest: false,
		empty: true
	},
	chatUpserts: {},
	chatUpdates: {},
	chatDeletes: new Set(),
	contactUpserts: {},
	contactUpdates: {},
	messageUpserts: {},
	messageUpdates: {},
	messageDeletes: {},
	messageReactions: {},
	messageReceipts: {},
	groupUpdates: {}
})

const stringifyMessageKey = (key: WAMessageKey) => `${key.remoteJid},${key.id},${key.fromMe ? '1' : '0'}`

const concatChats = <C extends Partial<Chat>>(left: C, right: Partial<Chat>): C => {
	if (right.unreadCount === null && (left.unreadCount ?? 0) < 0) {
		left.unreadCount = undefined
		right.unreadCount = undefined
	}
	const leftUnread = left.unreadCount
	const rightUnread = right.unreadCount
	if (typeof leftUnread === 'number' && typeof rightUnread === 'number') {
		right = { ...right }
		if (rightUnread >= 0) {
			right.unreadCount = Math.max(rightUnread, 0) + Math.max(leftUnread, 0)
		}
	}
	return Object.assign(left, right)
}

const mergePastParticipants = (
	existingEntries: proto.IPastParticipants[] | undefined,
	incomingEntries: proto.IPastParticipants[]
) => {
	const merged = new Map<string, proto.IPastParticipants>()
	const signature = (participant: proto.IPastParticipant) =>
		`${participant.userJid || ''}:${participant.leaveTs || ''}:${participant.leaveReason || ''}`
	const ingest = (entry: proto.IPastParticipants) => {
		const key = entry.groupJid ?? JSON.stringify(entry)
		const existing = merged.get(key)
		if (!existing) {
			merged.set(key, { ...entry, pastParticipants: [...(entry.pastParticipants || [])] })
			return
		}
		const seen = new Set((existing.pastParticipants || []).map(signature))
		for (const participant of entry.pastParticipants || []) {
			const value = signature(participant)
			if (!seen.has(value)) {
				existing.pastParticipants!.push(participant)
				seen.add(value)
			}
		}
	}
	for (const entry of existingEntries || []) ingest(entry)
	for (const entry of incomingEntries) ingest(entry)
	return [...merged.values()]
}

const append = (
	data: BufferedEventData,
	historyCache: Set<string>,
	event: BufferableEvent,
	eventData: BaileysEventMap[BufferableEvent],
	logger: ILogger
) => {
	const absorbChatUpdate = (existing: Chat) => {
		const id = existing.id || ''
		const update = data.chatUpdates[id]
		if (!update) return
		const matches = update.conditional ? update.conditional(data) : true
		if (matches) {
			delete update.conditional
			Object.assign(existing, concatChats(update as Chat, existing))
			delete data.chatUpdates[id]
		} else if (matches === false) {
			delete data.chatUpdates[id]
		}
	}

	switch (event) {
		case 'messaging-history.set': {
			const history = eventData as BaileysEventMap['messaging-history.set']
			for (const chat of history.chats) {
				const id = chat.id || ''
				const existing = data.historySets.chats[id]
				if (existing) existing.endOfHistoryTransferType = chat.endOfHistoryTransferType
				if (!existing && !historyCache.has(id)) {
					data.historySets.chats[id] = chat
					historyCache.add(id)
					absorbChatUpdate(chat)
				}
			}
			for (const contact of history.contacts) {
				const existing = data.historySets.contacts[contact.id]
				if (existing) Object.assign(existing, trimUndefined(contact))
				else {
					const cacheId = `c:${contact.id}`
					if (!historyCache.has(cacheId) || contact.notify || contact.name || contact.verifiedName) {
						data.historySets.contacts[contact.id] = contact
						historyCache.add(cacheId)
					}
				}
			}
			for (const message of history.messages) {
				const key = stringifyMessageKey(message.key)
				if (!data.historySets.messages[key] && !historyCache.has(key)) {
					data.historySets.messages[key] = message
					historyCache.add(key)
				}
			}
			data.historySets.empty = false
			data.historySets.syncType = history.syncType ?? undefined
			if (history.pastParticipants?.length) {
				data.historySets.pastParticipants = mergePastParticipants(
					data.historySets.pastParticipants,
					history.pastParticipants
				)
			}
			data.historySets.progress = history.progress
			data.historySets.chunkOrder = history.chunkOrder
			data.historySets.peerDataRequestSessionId = history.peerDataRequestSessionId ?? undefined
			data.historySets.isLatest = !!history.isLatest || data.historySets.isLatest
			break
		}
		case 'chats.upsert': {
			for (const chat of eventData as Chat[]) {
				const id = chat.id || ''
				let existing = data.chatUpserts[id] || data.historySets.chats[id]
				if (existing) concatChats(existing, chat)
				else {
					existing = chat
					data.chatUpserts[id] = existing
				}
				absorbChatUpdate(existing)
				data.chatDeletes.delete(id)
			}
			break
		}
		case 'chats.update': {
			for (const update of eventData as ChatUpdate[]) {
				const id = update.id || ''
				const matches = update.conditional ? update.conditional(data) : true
				if (matches) {
					delete update.conditional
					const existing = data.historySets.chats[id] || data.chatUpserts[id]
					if (existing) concatChats(existing, update)
					else data.chatUpdates[id] = concatChats(data.chatUpdates[id] || {}, update)
				} else if (matches === undefined) data.chatUpdates[id] = update
				data.chatDeletes.delete(id)
			}
			break
		}
		case 'chats.delete': {
			for (const id of eventData as string[]) {
				data.chatDeletes.add(id)
				delete data.chatUpdates[id]
				delete data.chatUpserts[id]
				delete data.historySets.chats[id]
			}
			break
		}
		case 'contacts.upsert': {
			for (const contact of eventData as Contact[]) {
				const existing = data.contactUpserts[contact.id] || data.historySets.contacts[contact.id]
				if (existing) Object.assign(existing, trimUndefined(contact))
				else data.contactUpserts[contact.id] = contact
				const pending = data.contactUpdates[contact.id]
				if (pending) {
					Object.assign(existing || contact, pending)
					delete data.contactUpdates[contact.id]
				}
			}
			break
		}
		case 'contacts.update': {
			for (const update of eventData as BaileysEventMap['contacts.update']) {
				const id = update.id || ''
				const existing = data.historySets.contacts[id] || data.contactUpserts[id]
				if (existing) Object.assign(existing, update)
				else data.contactUpdates[id] = Object.assign(data.contactUpdates[id] || {}, update)
			}
			break
		}
		case 'messages.upsert': {
			const { messages, type } = eventData as BaileysEventMap['messages.upsert']
			for (const message of messages) {
				const key = stringifyMessageKey(message.key)
				const existing = data.messageUpserts[key]?.message || data.historySets.messages[key]
				if (existing) message.messageTimestamp = existing.messageTimestamp
				const pending = data.messageUpdates[key]
				if (pending) {
					Object.assign(message, pending.update)
					delete data.messageUpdates[key]
				}
				if (data.historySets.messages[key]) data.historySets.messages[key] = message
				else {
					data.messageUpserts[key] = {
						message,
						type: type === 'notify' || data.messageUpserts[key]?.type === 'notify' ? 'notify' : type
					}
				}
			}
			break
		}
		case 'messages.update': {
			for (const update of eventData as BaileysEventMap['messages.update']) {
				const key = stringifyMessageKey(update.key)
				const existing = data.historySets.messages[key] || data.messageUpserts[key]?.message
				if (existing) {
					Object.assign(existing, update.update)
					if (update.update.status === WAMessageStatus.READ && !update.key.fromMe) {
						const chatId = existing.key.remoteJid || ''
						const chat = data.chatUpdates[chatId] || data.chatUpserts[chatId]
						if (
							isRealMessage(existing) &&
							shouldIncrementChatUnread(existing) &&
							typeof chat?.unreadCount === 'number' &&
							chat.unreadCount > 0
						) {
							chat.unreadCount -= 1
							if (chat.unreadCount === 0) delete chat.unreadCount
						}
					}
				} else {
					const pending = data.messageUpdates[key] || { key: update.key, update: {} }
					Object.assign(pending.update, update.update)
					data.messageUpdates[key] = pending
				}
			}
			break
		}
		case 'messages.delete': {
			const deletion = eventData as BaileysEventMap['messages.delete']
			if ('keys' in deletion) {
				for (const key of deletion.keys) {
					const value = stringifyMessageKey(key)
					data.messageDeletes[value] ||= key
					delete data.messageUpserts[value]
					delete data.messageUpdates[value]
				}
			}
			break
		}
		case 'messages.reaction': {
			for (const { key, reaction } of eventData as BaileysEventMap['messages.reaction']) {
				const value = stringifyMessageKey(key)
				const existing = data.messageUpserts[value]
				if (existing) updateMessageWithReaction(existing.message, reaction as proto.IReaction)
				else {
					data.messageReactions[value] ||= { key, reactions: [] }
					updateMessageWithReaction(data.messageReactions[value]!, reaction as proto.IReaction)
				}
			}
			break
		}
		case 'message-receipt.update': {
			for (const { key, receipt } of eventData as BaileysEventMap['message-receipt.update']) {
				const value = stringifyMessageKey(key)
				const existing = data.messageUpserts[value]
				if (existing) updateMessageWithReceipt(existing.message, receipt)
				else {
					data.messageReceipts[value] ||= { key, userReceipt: [] }
					updateMessageWithReceipt(data.messageReceipts[value]!, receipt)
				}
			}
			break
		}
		case 'groups.update': {
			for (const update of eventData as BaileysEventMap['groups.update']) {
				const id = update.id || ''
				data.groupUpdates[id] = Object.assign(data.groupUpdates[id] || {}, update)
			}
			break
		}
		default:
			logger.warn({ event }, 'event cannot be buffered')
	}
}

const consolidateEvents = (data: BufferedEventData): BaileysEventData => {
	const events: BaileysEventData = {}
	if (!data.historySets.empty) {
		events['messaging-history.set'] = {
			chats: Object.values(data.historySets.chats),
			messages: Object.values(data.historySets.messages),
			contacts: Object.values(data.historySets.contacts),
			pastParticipants: data.historySets.pastParticipants,
			syncType: data.historySets.syncType,
			progress: data.historySets.progress,
			isLatest: data.historySets.isLatest,
			chunkOrder: data.historySets.chunkOrder,
			peerDataRequestSessionId: data.historySets.peerDataRequestSessionId
		}
	}
	const assignArray = <K extends keyof BaileysEventMap>(event: K, values: BaileysEventMap[K]) => {
		if (Array.isArray(values) && values.length > 0) events[event] = values
	}
	assignArray('chats.upsert', Object.values(data.chatUpserts))
	assignArray('chats.update', Object.values(data.chatUpdates))
	assignArray('chats.delete', [...data.chatDeletes])
	assignArray('contacts.upsert', Object.values(data.contactUpserts))
	assignArray('contacts.update', Object.values(data.contactUpdates))
	assignArray('messages.update', Object.values(data.messageUpdates))
	assignArray('groups.update', Object.values(data.groupUpdates))

	const upserts = Object.values(data.messageUpserts)
	if (upserts.length) {
		events['messages.upsert'] = { messages: upserts.map(item => item.message), type: upserts[0]!.type }
	}
	const deleted = Object.values(data.messageDeletes)
	if (deleted.length) events['messages.delete'] = { keys: deleted }
	const reactions = Object.values(data.messageReactions).flatMap(({ key, reactions: values }) =>
		values.map(reaction => ({ key, reaction }))
	)
	if (reactions.length) events['messages.reaction'] = reactions
	const receipts = Object.values(data.messageReceipts).flatMap(({ key, userReceipt }) =>
		userReceipt.map(receipt => ({ key, receipt }))
	)
	if (receipts.length) events['message-receipt.update'] = receipts
	return events
}

/**
 * Upstream-compatible event buffer. Non-buffered events stay synchronous;
 * bufferable events are consolidated and released as one `process()` map.
 */
export const makeEventBuffer = (logger: ILogger): BaileysBufferableEventEmitter => {
	const ev = new EventEmitter()
	const historyCache = new Set<string>()
	let data = makeBufferData()
	let buffering = false
	let bufferCount = 0
	let bufferTimeout: ReturnType<typeof setTimeout> | undefined
	let flushPendingTimeout: ReturnType<typeof setTimeout> | undefined

	ev.on('event', (events: BaileysEventData) => {
		for (const event of Object.keys(events) as BaileysEvent[]) {
			if (event === 'connection.update') {
				// Delivered listener by listener, unlike every other event.
				// `EventEmitter.emit()` stops at the first listener that throws,
				// so one bad handler would keep the rest — including the app's
				// reconnect handler — from ever seeing a terminal `close`, and
				// the bot would stay offline. This is the lifecycle channel;
				// losing delivery here is the failure mode the socket's whole
				// close contract exists to prevent.
				for (const listener of ev.listeners(event)) {
					try {
						;(listener as (data: unknown) => void)(events[event])
					} catch (err) {
						logger.error({ err, event }, 'connection.update listener threw; continuing with the rest')
					}
				}
				continue
			}
			ev.emit(event, events[event])
		}
	})

	const flush = () => {
		if (!buffering) return false
		buffering = false
		bufferCount = 0
		if (bufferTimeout) clearTimeout(bufferTimeout)
		if (flushPendingTimeout) clearTimeout(flushPendingTimeout)
		bufferTimeout = undefined
		flushPendingTimeout = undefined
		if (historyCache.size > 10_000) historyCache.clear()

		const next = makeBufferData()
		let conditionalUpdates = 0
		for (const update of Object.values(data.chatUpdates)) {
			if (update.conditional && update.id) {
				next.chatUpdates[update.id] = update
				delete data.chatUpdates[update.id]
				conditionalUpdates += 1
			}
		}
		const consolidated = consolidateEvents(data)
		if (Object.keys(consolidated).length) ev.emit('event', consolidated)
		data = next
		logger.trace({ conditionalChatUpdatesLeft: conditionalUpdates }, 'released buffered events')
		return true
	}

	const buffer = () => {
		if (!buffering) {
			buffering = true
			bufferCount = 0
			if (bufferTimeout) clearTimeout(bufferTimeout)
			bufferTimeout = setTimeout(() => {
				if (buffering) {
					logger.warn('Buffer timeout reached, auto-flushing')
					flush()
				}
			}, 30_000)
			bufferTimeout.unref?.()
		}
		bufferCount += 1
	}

	return {
		process(handler) {
			const listener = (events: BaileysEventData) => {
				void handler(events)
			}
			ev.on('event', listener)
			return () => ev.off('event', listener)
		},
		emit(event, eventData) {
			if (event === 'messages.upsert') {
				const type = (eventData as BaileysEventMap['messages.upsert']).type
				const pending = Object.values(data.messageUpserts)
				if (pending.length && pending[0]!.type !== type) {
					ev.emit('event', {
						'messages.upsert': { messages: pending.map(item => item.message), type: pending[0]!.type }
					})
					data.messageUpserts = {}
				}
			}
			if (buffering && BUFFERABLE_EVENT_SET.has(event)) {
				append(data, historyCache, event as BufferableEvent, eventData as never, logger)
				return true
			}
			return ev.emit('event', { [event]: eventData })
		},
		on: (event, listener) => {
			ev.on(event, listener)
		},
		off: (event, listener) => {
			ev.off(event, listener)
		},
		removeAllListeners: event => {
			ev.removeAllListeners(event)
		},
		buffer,
		flush,
		isBuffering: () => buffering,
		createBufferedFunction(work) {
			return async (...args) => {
				buffer()
				try {
					return await work(...args)
				} finally {
					bufferCount = Math.max(0, bufferCount - 1)
					if (bufferCount === 0 && !flushPendingTimeout) {
						flushPendingTimeout = setTimeout(flush, 100)
						flushPendingTimeout.unref?.()
					}
				}
			}
		},
		destroy() {
			if (bufferTimeout) clearTimeout(bufferTimeout)
			if (flushPendingTimeout) clearTimeout(flushPendingTimeout)
			historyCache.clear()
			data = makeBufferData()
			buffering = false
			bufferCount = 0
			ev.removeAllListeners()
			logger.debug('Event buffer destroyed')
		}
	}
}
