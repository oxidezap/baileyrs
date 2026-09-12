import type { CanonicalEvent } from '../Bridge/index.ts'

export interface CallOfferSnapshot {
	peer: string
	callCreator?: string
	isVideo?: boolean
	callerPn?: string
	groupJid?: string
}

export type CallOfferCache = Map<string, CallOfferSnapshot>

type IncomingCallEvent = Extract<CanonicalEvent, { type: 'incomingCall' }>

// Updates after which no live call can remain: the entry is enriched, then
// dropped. `accept` is deliberately absent: the call is live from here, and
// `terminateCall` still needs the peer and call creator to route the hangup.
const FORGET_CALL_TYPES: ReadonlySet<string> = new Set(['reject', 'timeout', 'terminate'])

/**
 * Track a call offer and enrich later updates from it, mirroring upstream
 * Baileys' `callOfferCache` handling in `messages-recv.js` `handleCall`.
 *
 * A raw `accept` carries no `isVideo`, so the offer snapshot fills it (plus
 * `callerPn`/`groupJid`/`callCreator`) in place before the dispatcher builds
 * the `call` event. Truly terminal updates enrich first, then clear, so the
 * terminal event itself still carries the offer's fields. `accept` keeps the
 * entry: unlike upstream, this socket can still hang the call up afterwards,
 * and `terminateCall` routes from the remembered peer and call creator. The
 * exception is an update resolved on another device (`endedElsewhere`):
 * this device owns no live call, so its entry is dropped even when the
 * action reads as `accept`. The same entry routes outbound
 * `rejectCall`/`terminateCall` to the stanza peer and call creator.
 *
 * The offer snapshot is stored even when the offer carries no `callCreator`
 * (the field is optional on the bridge): enrichment must not depend on
 * routing metadata being present.
 */
export const trackIncomingCall = (cache: CallOfferCache, event: IncomingCallEvent): void => {
	const { callId, callCreator, type } = event.action
	if (event.endedElsewhere === true || FORGET_CALL_TYPES.has(type)) {
		const snapshot = cache.get(callId)
		if (snapshot) enrichFromSnapshot(event, snapshot)
		cache.delete(callId)
		return
	}
	if (type === 'offer') {
		cache.set(callId, {
			peer: event.from,
			callCreator,
			isVideo: event.action.isVideo,
			callerPn: event.action.callerPn,
			groupJid: event.action.groupJid
		})
		return
	}
	const snapshot = cache.get(callId)
	if (snapshot) {
		enrichFromSnapshot(event, snapshot)
		if (callCreator) {
			snapshot.peer = event.from
			snapshot.callCreator = callCreator
		}
	} else if (callCreator) {
		cache.set(callId, { peer: event.from, callCreator })
	}
}

/** Fill a sparse update from the remembered offer without overwriting it. */
const enrichFromSnapshot = (event: IncomingCallEvent, snapshot: CallOfferSnapshot): void => {
	event.action.isVideo ??= snapshot.isVideo
	event.action.callerPn ??= snapshot.callerPn
	event.action.groupJid ??= snapshot.groupJid
	event.action.callCreator ??= snapshot.callCreator
}
