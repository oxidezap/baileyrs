import { makeEventBuffer as makeUpstreamEventBuffer } from 'baileys/lib/Utils/event-buffer.js'
import { describe, it } from 'node:test'
import type { BaileysEventMap } from '../Types/index.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import logger from '../Utils/logger.ts'
import { expect } from './expect.ts'

describe('event buffer — upstream process() contract', () => {
	it('observes every event without a hand-maintained allow-list', () => {
		const ev = makeEventBuffer(logger)
		const processed: (keyof BaileysEventMap)[] = []
		ev.process(events => {
			processed.push(...(Object.keys(events) as (keyof BaileysEventMap)[]))
		})

		ev.emit('group.join-request', {
			id: '120@g.us',
			author: '1@lid',
			participant: '2@lid',
			action: 'created',
			method: 'invite_link'
		})
		ev.emit('group.member-tag.update', {
			groupId: '120@g.us',
			participant: '2@lid',
			label: 'mod'
		})

		expect(processed).toEqual(['group.join-request', 'group.member-tag.update'])
	})

	it('returns an unsubscribe function and stops delivery after cleanup', () => {
		const ev = makeEventBuffer(logger)
		let calls = 0
		const unsubscribe = ev.process(() => {
			calls += 1
		})

		expect(typeof unsubscribe).toBe('function')
		ev.emit('groups.update', [{ id: '120@g.us' }])
		unsubscribe()
		ev.emit('groups.update', [{ id: '120@g.us', subject: 'ignored' }])
		expect(calls).toBe(1)
	})

	it('delivers direct listeners before the process map, like upstream', () => {
		const ev = makeEventBuffer(logger)
		const order: string[] = []
		ev.on('groups.update', () => {
			order.push('direct')
		})
		ev.process(() => {
			order.push('process')
		})
		ev.emit('groups.update', [{ id: '120@g.us' }])
		expect(order).toEqual(['direct', 'process'])
	})

	it('defers and consolidates bufferable events until flush', () => {
		const ev = makeEventBuffer(logger)
		const direct: BaileysEventMap['groups.update'][] = []
		const processed: Partial<BaileysEventMap>[] = []
		ev.on('groups.update', update => direct.push(update))
		ev.process(events => {
			processed.push(events)
		})

		ev.buffer()
		expect(ev.isBuffering()).toBe(true)
		ev.emit('groups.update', [{ id: '120@g.us', subject: 'A' }])
		ev.emit('groups.update', [{ id: '120@g.us', restrict: true }])
		expect(direct).toEqual([])
		expect(processed).toEqual([])

		expect(ev.flush()).toBe(true)
		expect(ev.flush()).toBe(false)
		expect(direct).toEqual([[{ id: '120@g.us', subject: 'A', restrict: true }]])
		expect(processed).toHaveLength(1)
		expect(processed[0]?.['groups.update']).toEqual([{ id: '120@g.us', subject: 'A', restrict: true }])
	})

	it('createBufferedFunction owns the buffer lifecycle and destroy clears listeners', async () => {
		const ev = makeEventBuffer(logger)
		let calls = 0
		ev.on('chats.upsert', () => {
			calls += 1
		})
		const work = ev.createBufferedFunction(async (id: string) => {
			expect(ev.isBuffering()).toBe(true)
			ev.emit('chats.upsert', [{ id }])
			return id
		})

		expect(await work('5511@s.whatsapp.net')).toBe('5511@s.whatsapp.net')
		expect(calls).toBe(0)
		expect(ev.flush()).toBe(true)
		expect(calls).toBe(1)
		ev.destroy()
		expect(ev.isBuffering()).toBe(false)
		ev.emit('chats.upsert', [{ id: 'ignored@s.whatsapp.net' }])
		expect(calls).toBe(1)
	})

	it('merges past-participant history entries without duplicates', () => {
		const ev = makeEventBuffer(logger)
		const sets: BaileysEventMap['messaging-history.set'][] = []
		ev.on('messaging-history.set', data => sets.push(data))
		ev.buffer()
		const empty = { chats: [], contacts: [], messages: [] }
		ev.emit('messaging-history.set', {
			...empty,
			pastParticipants: [{ groupJid: '120@g.us', pastParticipants: [{ userJid: '1@lid', leaveTs: 10 }] }]
		})
		ev.emit('messaging-history.set', {
			...empty,
			pastParticipants: [
				{
					groupJid: '120@g.us',
					pastParticipants: [
						{ userJid: '1@lid', leaveTs: 10 },
						{ userJid: '2@lid', leaveTs: 20 }
					]
				}
			]
		})
		ev.flush()
		expect(sets[0]?.pastParticipants?.[0]?.pastParticipants?.map(item => item.userJid)).toEqual(['1@lid', '2@lid'])
	})
	/**
	 * An id-less chat is not the history set's id-less chat.
	 *
	 * Upstream guards the history-set lookup with `id &&`, so a `chats.upsert`
	 * carrying no id starts its own entry. This port had dropped that guard, and
	 * the two folded together: their unread counts summed and the upsert was never
	 * released on its own. Found by the buffer differential once history rows drew
	 * from the same identity pool as live traffic, which is the only way the two
	 * ever met.
	 */
	it('keeps an id-less chats.upsert out of a buffered history set', () => {
		const ev = makeEventBuffer(logger)
		const upserts: unknown[] = []
		const sets: BaileysEventMap['messaging-history.set'][] = []
		ev.on('chats.upsert', chats => upserts.push(...chats))
		ev.on('messaging-history.set', set => sets.push(set))

		ev.buffer()
		ev.emit('messaging-history.set', {
			chats: [{ id: '', conversationTimestamp: 737, unreadCount: 4 } as never],
			contacts: [],
			messages: [],
			isLatest: false,
			syncType: undefined,
			progress: undefined,
			peerDataRequestSessionId: undefined
		} as never)
		ev.emit('chats.upsert', [{ id: '', conversationTimestamp: -918, unreadCount: 5 } as never])
		ev.flush()

		// The history chat keeps its own values...
		expect(sets[0]?.chats?.[0]?.unreadCount).toEqual(4)
		expect(sets[0]?.chats?.[0]?.conversationTimestamp).toEqual(737)
		// ...and the upsert is released separately rather than summed into it.
		expect(upserts.length).toEqual(1)
	})
	/**
	 * Consolidation accumulates; it does not keep only the first update.
	 *
	 * Upstream guards its whole group merge with `if (!data.groupUpdates[id])`,
	 * which makes the merge unreachable: only the first update for an id survives
	 * and every later one is discarded, disjoint fields included. This buffer
	 * merges, like its own chat and message branches do. Pinned because it is a
	 * deliberate divergence — a future "align with upstream" would silently drop
	 * updates a consumer sent.
	 */
	it('merges every groups.update for an id, rather than keeping only the first', () => {
		const ev = makeEventBuffer(logger)
		const released: BaileysEventMap['groups.update'] = []
		ev.on('groups.update', updates => released.push(...updates))

		ev.buffer()
		ev.emit('groups.update', [{ id: '120@g.us', subject: 'first' }])
		ev.emit('groups.update', [{ id: '120@g.us', announce: true }])
		ev.emit('groups.update', [{ id: '120@g.us', subject: 'second' }])
		ev.flush()

		expect(released.length).toEqual(1)
		// The later subject wins...
		expect(released[0]?.subject).toEqual('second')
		// ...and the field that only the middle update carried is still there.
		expect(released[0]?.announce).toEqual(true)
	})

	/**
	 * A flush walks `Object.keys()` of the consolidated map, so the order that
	 * `consolidateEvents` writes its keys is the order a `process()` handler
	 * iterates and the order the individual events reach `.on()` listeners. The
	 * expectation below is read from upstream at run time rather than written out
	 * by hand: a hardcoded list would go stale the moment upstream reorders, and
	 * would then assert compatibility with a version nobody runs.
	 */
	it('releases the consolidated kinds in upstream’s order', () => {
		// Distinct message ids per kind on purpose: a reaction or receipt whose key
		// matches a buffered upsert is folded into that message instead of landing
		// in its own bucket, and the kind would never appear in the map.
		const seed = (ev: ReturnType<typeof makeEventBuffer>) => {
			const key = (id: string) => ({ remoteJid: '1@s.whatsapp.net', id, fromMe: false })
			ev.buffer()
			ev.emit('messages.upsert', { messages: [{ key: key('A'), message: {} } as never], type: 'notify' })
			ev.emit('message-receipt.update', [{ key: key('E'), receipt: { userJid: '2@s.whatsapp.net', readTimestamp: 5 } }])
			ev.emit('contacts.upsert', [{ id: '2@s.whatsapp.net', name: 'x' }])
			ev.emit('contacts.update', [{ id: '3@s.whatsapp.net', name: 'y' }])
			ev.emit('groups.update', [{ id: '120@g.us', subject: 's' }])
			ev.emit('chats.upsert', [{ id: '9@s.whatsapp.net', conversationTimestamp: 1, unreadCount: 1 }])
			ev.emit('chats.update', [{ id: '8@s.whatsapp.net', unreadCount: 1 }])
			ev.emit('chats.delete', ['7@s.whatsapp.net'])
			ev.emit('messages.update', [{ key: key('B'), update: { status: 3 } }])
			ev.emit('messages.delete', { keys: [key('C')] })
			ev.emit('messages.reaction', [{ key: key('D'), reaction: { text: '\u{1f44d}', key: key('D') } }])
			ev.flush()
		}
		const orderOf = (make: typeof makeEventBuffer) => {
			const ev = make(logger)
			let keys: string[] = []
			ev.process(events => {
				keys = Object.keys(events)
			})
			seed(ev)
			return keys
		}

		const upstream = orderOf(makeUpstreamEventBuffer as unknown as typeof makeEventBuffer)
		// The seed has to actually exercise every kind, or the order it pins is
		// only the order of whatever happened to survive consolidation.
		expect(upstream.length).toEqual(11)
		expect(orderOf(makeEventBuffer)).toEqual(upstream)
	})
})
