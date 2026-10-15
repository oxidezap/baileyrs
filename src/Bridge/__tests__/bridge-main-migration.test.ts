import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adaptBridgeEvent } from '../adapt.ts'
import type { WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge'

const jid = { user: '123', server: 's.whatsapp.net', device: 0, agent: 0, integrator: 0 }
const adapt = (event: unknown) => adaptBridgeEvent(event as WhatsAppEvent)

test('new activity values map to Baileys composing/audio/paused, old values are rejected', () => {
	for (const [input, state, media] of [
		['typing', 'composing', undefined],
		['recording_audio', 'composing', 'audio'],
		['idle', 'paused', undefined]
	]) {
		assert.deepEqual(adapt({ type: 'chat_presence', data: { source: { chat: jid, sender: jid }, state: input } }), {
			type: 'chatPresence',
			chatJid: '123@s.whatsapp.net',
			senderJid: '123@s.whatsapp.net',
			state,
			media
		})
	}
	for (const state of ['composing', 'paused', 'future'])
		assert.equal(adapt({ type: 'chat_presence', data: { source: { chat: jid, sender: jid }, state } }), null)
	assert.equal(adapt({ type: 'presence', data: { from: jid, status: 'unavailable' } })?.type, 'presence')
	assert.deepEqual(adapt({ type: 'presence', data: { from: jid, status: 'unavailable' } }), {
		type: 'presence',
		from: '123@s.whatsapp.net',
		unavailable: true,
		lastSeen: undefined
	})
})

test('label sublists retain unknown signed IDs, zero upserts, removal and epoch action time', () => {
	const base = { predefined_id: -97, chat_jid: jid, from_full_sync: false }
	assert.deepEqual(
		adapt({
			type: 'label_sublist_update',
			data: { ...base, change: { Upsert: { sub_list_id: 0 } }, action_timestamp: '1970-01-01T00:00:00Z' }
		}),
		{
			type: 'labelSublist',
			predefinedId: -97,
			chatJid: '123@s.whatsapp.net',
			change: 'upsert',
			subListId: 0,
			actionTimestamp: '1970-01-01T00:00:00Z',
			fromFullSync: false
		}
	)
	assert.deepEqual(adapt({ type: 'label_sublist_update', data: { ...base, change: 'Remove', from_full_sync: true } }), {
		type: 'labelSublist',
		predefinedId: -97,
		chatJid: '123@s.whatsapp.net',
		change: 'remove',
		fromFullSync: true
	})
	for (const change of [null, {}, { Upsert: {} }, 'Future'])
		assert.equal(adapt({ type: 'label_sublist_update', data: { ...base, change } }), null)
})

test('call control actions with absent timestamps remain observable', () => {
	const result = adapt({
		type: 'incoming_call',
		data: { from: jid, action: { type: 'Terminate', call_id: 'call1', call_creator: jid } }
	})
	assert.equal(result?.type, 'incomingCall')
	if (result?.type !== 'incomingCall') throw new Error('missing call event')
	assert.equal(result.timestamp, undefined)
	assert.equal(result.action.type, 'terminate')
})

test('global presence rejects absent, malformed and unknown statuses', () => {
	for (const status of [undefined, null, 0, true, {}, 'future', 'Available'])
		assert.equal(adapt({ type: 'presence', data: { from: jid, status } }), null)
	assert.deepEqual(adapt({ type: 'presence', data: { from: jid, status: 'available' } }), {
		type: 'presence',
		from: '123@s.whatsapp.net',
		unavailable: false,
		lastSeen: undefined
	})
})
