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

	it('accept keeps the entry: later live-call updates stay enriched and routable', () => {
		const cache: CallOfferCache = new Map()
		const emitted = driveCalls(cache, [offer('CALL-2'), update('CALL-2', 'accept'), update('CALL-2', 'transport')])
		expect(emitted.length).toBe(3)
		expect(emitted[1]?.[0]).toMatchObject({ status: 'accept', isVideo: true })
		expect(emitted[2]?.[0]).toMatchObject({ status: 'transport', isVideo: true })
		// Routing survives acceptance so a later terminateCall still uses the
		// remembered peer and call creator instead of doubling up callFrom.
		expect(cache.get('CALL-2')).toMatchObject({
			peer: '5511@s.whatsapp.net',
			callCreator: '5511@s.whatsapp.net'
		})
	})

	it('reject, timeout and terminate clear the entry', () => {
		const timeoutViaTerminate = update('CALL-timeout', 'terminate', { reason: 'timeout' })
		const cases = [update('CALL-reject', 'reject'), timeoutViaTerminate, update('CALL-terminate', 'terminate')]
		for (const terminal of cases) {
			const cache: CallOfferCache = new Map()
			const callId = (terminal.data as { action: { call_id: string } }).action.call_id
			driveCalls(cache, [offer(callId), terminal])
			expect(cache.size).toBe(0)
		}
	})

	it('an offer without callCreator still enriches later updates', () => {
		const noCreator = {
			type: 'incoming_call',
			data: {
				from: jid('5511'),
				stanza_id: 'STAN-9',
				timestamp: 1_730_000_000,
				offline: false,
				action: { type: 'offer', call_id: 'CALL-9', is_video: true, joinable: false, audio: [] }
			}
		}
		const emitted = driveCalls(new Map(), [noCreator, update('CALL-9', 'accept')])
		expect(emitted[1]?.[0]).toMatchObject({ status: 'accept', isVideo: true })
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

	it('an out-of-range video orientation is dropped, not emitted', () => {
		for (const bad of [4, 1.5, -1]) {
			const event = {
				type: 'incoming_call',
				data: {
					...(offer('CALL-7B').data as Record<string, unknown>),
					video_orientation: bad
				}
			}
			const emitted = driveCalls(new Map(), [event])
			expect(emitted[0]?.[0]?.videoOrientation).toBe(undefined)
		}
	})

	it('a call ended on another device clears the entry despite reading as accept', () => {
		const cache: CallOfferCache = new Map()
		const elsewhere = {
			type: 'call_ended_elsewhere',
			data: { from: jid('5511'), call_id: 'CALL-9B', timestamp: 1_730_000_100, outcome: 'accepted' }
		}
		const emitted = driveCalls(cache, [offer('CALL-9B'), elsewhere])
		expect(emitted[1]?.[0]).toMatchObject({ status: 'accept', isVideo: true })
		expect(cache.size).toBe(0)
	})

	it('a sparse missed call keeps the offer identity', () => {
		const cache: CallOfferCache = new Map()
		const missed = {
			type: 'missed_call',
			data: { from: jid('5511'), call_id: 'CALL-9C', timestamp: 1_730_000_100, reason: 'remote' }
		}
		const emitted = driveCalls(cache, [offer('CALL-9C'), missed])
		expect(emitted[1]?.[0]).toMatchObject({
			status: 'timeout',
			isVideo: true,
			callerPn: '5522@s.whatsapp.net',
			callCreator: '5511@s.whatsapp.net'
		})
	})

	it('an accept with no offer seen stays a bare accept', () => {
		const emitted = driveCalls(new Map(), [update('CALL-8', 'accept')])
		const call = emitted[0]?.[0] as BaileysEventMap['call'][number]
		expect(call.status).toBe('accept')
		expect(call.isVideo).toBe(undefined)
	})

	it('the offer audio list decides the accept promise (mlow vs opus)', () => {
		// The captain's real call negotiated Mlow while the example pushed
		// Opus, so every packet died in the engine. The caller must read the
		// offer's audio list: `mlow` in it means mlow, anything else (empty
		// included) keeps the opus promise ffmpeg encodes.
		const offeredFormat = (audio: string[] | undefined): 'mlow' | 'opus' =>
			(audio ?? []).includes('mlow') ? 'mlow' : 'opus'
		expect(offeredFormat(['mlow'])).toBe('mlow')
		expect(offeredFormat(['opus'])).toBe('opus')
		expect(offeredFormat([])).toBe('opus')
		expect(offeredFormat(undefined)).toBe('opus')
	})
})
