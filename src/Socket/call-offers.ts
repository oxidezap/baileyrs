import type { CanonicalEvent } from '../Bridge/index.ts'

export interface CallOfferSnapshot {
	peer: string
	callCreator: string
	isVideo?: boolean
	callerPn?: string
	groupJid?: string
}

export type CallOfferCache = Map<string, CallOfferSnapshot>

type IncomingCallEvent = Extract<CanonicalEvent, { type: 'incomingCall' }>

const TERMINAL_CALL_TYPES: ReadonlySet<string> = new Set(['reject', 'accept', 'timeout', 'terminate'])

/**
 * Track a call offer and enrich later updates from it, mirroring upstream
 * Baileys' `callOfferCache` handling in `messages-recv.js` `handleCall`.
 *
 * A raw `accept` carries no `isVideo`, so the offer snapshot fills it (plus
 * `callerPn`/`groupJid`) in place before the dispatcher builds the `call`
 * event. Terminal updates enrich first, then clear, so the terminal event
 * itself still carries the offer's fields. The same entry routes outbound
 * `rejectCall`/`terminateCall` to the stanza peer and call creator.
 */
export const trackIncomingCall = (cache: CallOfferCache, event: IncomingCallEvent): void => {
	const { callId, callCreator, type } = event.action
	if (TERMINAL_CALL_TYPES.has(type)) {
		const snapshot = cache.get(callId)
		if (snapshot) {
			event.action.isVideo ??= snapshot.isVideo
			event.action.callerPn ??= snapshot.callerPn
			event.action.groupJid ??= snapshot.groupJid
		}
		cache.delete(callId)
		return
	}
	if (type === 'offer') {
		if (callCreator) {
			cache.set(callId, {
				peer: event.from,
				callCreator,
				isVideo: event.action.isVideo,
				callerPn: event.action.callerPn,
				groupJid: event.action.groupJid
			})
		}
		return
	}
	const snapshot = cache.get(callId)
	if (snapshot) {
		event.action.isVideo ??= snapshot.isVideo
		event.action.callerPn ??= snapshot.callerPn
		event.action.groupJid ??= snapshot.groupJid
		if (callCreator) {
			snapshot.peer = event.from
			snapshot.callCreator = callCreator
		}
	} else if (callCreator) {
		cache.set(callId, { peer: event.from, callCreator })
	}
}
