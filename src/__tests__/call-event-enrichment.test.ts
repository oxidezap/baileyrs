import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { adaptBridgeEvent } from '../Bridge/adapt.ts'
import { makeEventHandler } from '../Socket/events.ts'
import { trackIncomingCall, type CallOfferCache } from '../Socket/call-offers.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BaileysEventMap, WACallEvent } from '../Types/index.ts'
import { expect } from './expect.ts'

const jid = (user: string, server = 's.whatsapp.net') => ({ user, server, agent: 0, device: 0, integrator: 0 })

const noopLogger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return noopLogger
	}
}

/**
 * Drive bridge events through the real adapter + dispatcher, with the offer
 * cache wired exactly as `Socket/index.ts` wires it. Returns every `call`
 * payload emitted, in order.
 */
const driveCalls = (cache: CallOfferCache, events: { type: string; data?: unknown }[]): WACallEvent[][] => {
	const ev = new EventEmitter()
	const ctx = {
		ev,
		logger: noopLogger,
		fullConfig: {},
		ws: new EventEmitter(),
		getUser: () => undefined,
		getMe: () => undefined,
		setUser: () => {},
		reportUnexpectedError: () => {},
		withClient: () => Promise.reject(new Error('not used'))
	} as unknown as SocketContext
	const captured: WACallEvent[][] = []
	ev.on('call', payload => captured.push(payload as WACallEvent[]))
	const onEvent = makeEventHandler(ctx, { onIncomingCall: event => trackIncomingCall(cache, event) })
	for (const event of events) onEvent(event as never)
	return captured
}

const offer = (callId: string, extraAction: Record<string, unknown> = {}) => ({
	type: 'incoming_call',
	data: {
		from: jid('5511'),
		stanza_id: 'STAN-1',
		timestamp: 1_730_000_000,
		offline: false,
		action: {
			type: 'offer',
			call_id: callId,
			call_creator: jid('5511'),
			caller_pn: jid('5522'),
			is_video: true,
			joinable: false,
			audio: [],
			...extraAction
		}
	}
})

const update = (callId: string, actionType: string, extraAction: Record<string, unknown> = {}) => ({
	type: 'incoming_call',
	data: {
		from: jid('5511'),
		stanza_id: 'STAN-2',
		timestamp: 1_730_000_100,
		offline: false,
		action: { type: actionType, call_id: callId, call_creator: jid('5511'), ...extraAction }
	}
})

describe('calls domain on the bridge preview (PR 115)', () => {
	it('the installed bridge exposes terminateCall next to rejectCall', () => {
		const proto = WasmWhatsAppClient.prototype as unknown as Record<string, unknown>
		expect(typeof proto.rejectCall).toBe('function')
		expect(typeof proto.terminateCall).toBe('function')
	})

	it('an accept following an offer carries the offer isVideo and callerPn', () => {
		const emitted = driveCalls(new Map(), [offer('CALL-1'), update('CALL-1', 'accept')])
		expect(emitted.length).toBe(2)
		expect(emitted[0]?.[0]).toMatchObject({ status: 'offer', isVideo: true, callerPn: '5522@s.whatsapp.net' })
		expect(emitted[1]?.[0]).toMatchObject({ status: 'accept', isVideo: true, callerPn: '5522@s.whatsapp.net' })
	})

	it('the terminal update clears the offer: a later update is no longer enriched', () => {
		const cache: CallOfferCache = new Map()
		const emitted = driveCalls(cache, [offer('CALL-2'), update('CALL-2', 'accept'), update('CALL-2', 'transport')])
		expect(emitted.length).toBe(3)
		expect(emitted[1]?.[0]).toMatchObject({ status: 'accept', isVideo: true })
		expect(emitted[2]?.[0]?.isVideo).toBe(undefined)
		// The non-terminal transport re-arms a bare routing entry for a later
		// reject, but the offer fields are gone with the terminal update.
		expect(cache.get('CALL-2')?.isVideo).toBe(undefined)
	})

	it('an explicit group_jid on the offer marks the call as a group call', () => {
		const emitted = driveCalls(new Map(), [
			offer('CALL-3', { group_jid: { user: '120363', server: 'g.us', agent: 0, device: 0, integrator: 0 } })
		])
		expect(emitted[0]?.[0]).toMatchObject({ isGroup: true, groupJid: '120363@g.us' })
	})

	it('a terminate with reason timeout surfaces as timeout and keeps the reason', () => {
		const emitted = driveCalls(new Map(), [offer('CALL-4'), update('CALL-4', 'terminate', { reason: 'timeout' })])
		expect(emitted[1]?.[0]).toMatchObject({ status: 'timeout', reason: 'timeout', isVideo: true })
	})

	it('a reject keeps its reason', () => {
		const canonical = adaptBridgeEvent(update('CALL-5', 'reject', { reason: 'rejected_elsewhere' }) as never)
		if (canonical?.type !== 'incomingCall' || canonical.action.type !== 'reject') throw new Error('narrowing')
		expect(canonical.action.reason).toBe('rejected_elsewhere')
	})

	it('offer_notice maps onto the offer status', () => {
		const canonical = adaptBridgeEvent(update('CALL-6', 'offer_notice', { is_video: true }) as never)
		if (canonical?.type !== 'incomingCall') throw new Error('narrowing')
		expect(canonical.action.type).toBe('offer')
	})

	it('video orientation on the offer reaches the call event', () => {
		const event = {
			type: 'incoming_call',
			data: {
				...(offer('CALL-7').data as Record<string, unknown>),
				video_orientation: 1
			}
		}
		const emitted = driveCalls(new Map(), [event])
		expect(emitted[0]?.[0]).toMatchObject({ videoOrientation: 1 })
	})

	it('an accept with no offer seen stays a bare accept', () => {
		const emitted = driveCalls(new Map(), [update('CALL-8', 'accept')])
		const call = emitted[0]?.[0] as BaileysEventMap['call'][number]
		expect(call.status).toBe('accept')
		expect(call.isVideo).toBe(undefined)
	})
})
