import { isJidGroup } from '../WABinary/jid-utils.ts'
import type { WACallEvent } from '../Types/Call.ts'
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
 *
 * Returns whether the update was terminal for this device (rejected, timed
 * out, terminated, or resolved elsewhere): the socket stops the call's media
 * registrations on true, since a terminal ringing call opens no media handle
 * and may never emit `call.media: ended` to sweep them.
 */
export const trackIncomingCall = (cache: CallOfferCache, event: IncomingCallEvent): boolean => {
	const { callId, callCreator, type } = event.action
	if (event.endedElsewhere === true || FORGET_CALL_TYPES.has(type)) {
		const snapshot = cache.get(callId)
		if (snapshot) enrichFromSnapshot(event, snapshot)
		cache.delete(callId)
		return true
	}
	if (type === 'offer') {
		cache.set(callId, {
			peer: event.from,
			callCreator,
			isVideo: event.action.isVideo,
			callerPn: event.action.callerPn,
			groupJid: event.action.groupJid
		})
		return false
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
	return false
}

/** Fill a sparse update from the remembered offer without overwriting it. */
const enrichFromSnapshot = (event: IncomingCallEvent, snapshot: CallOfferSnapshot): void => {
	event.action.isVideo ??= snapshot.isVideo
	event.action.callerPn ??= snapshot.callerPn
	event.action.groupJid ??= snapshot.groupJid
	event.action.callCreator ??= snapshot.callCreator
}

/** Project the same enriched call event for native and externally supplied sockets. */
export const toCallEvent = (evt: IncomingCallEvent): WACallEvent => {
	const isGroup = !!evt.action.groupJid || isJidGroup(evt.from)
	return {
		chatId: evt.from,
		from: evt.action.callCreator ?? evt.from,
		...(evt.action.callCreator ? { callCreator: evt.action.callCreator } : {}),
		id: evt.action.callId,
		// Upstream uses new Date(+attrs.t * 1000), including Invalid Date
		// when t is absent. Preserve that contract without inventing a time.
		date: new Date((evt.timestamp ?? Number.NaN) * 1000),
		status: evt.action.type,
		offline: evt.offline,
		isGroup,
		...(isGroup ? { groupJid: evt.action.groupJid ?? evt.from } : {}),
		...(evt.action.callerPn ? { callerPn: evt.action.callerPn } : {}),
		...(evt.action.isVideo !== undefined ? { isVideo: evt.action.isVideo } : {}),
		// Bridge auxiliary fields (offer-only / terminate-only / always)
		...(evt.action.callerCountryCode ? { callerCountryCode: evt.action.callerCountryCode } : {}),
		...(evt.action.deviceClass ? { deviceClass: evt.action.deviceClass } : {}),
		...(evt.action.joinable !== undefined ? { joinable: evt.action.joinable } : {}),
		...(evt.action.audio ? { audio: evt.action.audio } : {}),
		...(evt.action.duration !== undefined ? { duration: evt.action.duration } : {}),
		...(evt.action.audioDuration !== undefined ? { audioDuration: evt.action.audioDuration } : {}),
		...(evt.action.reason ? { reason: evt.action.reason } : {}),
		...(evt.videoOrientation !== undefined ? { videoOrientation: evt.videoOrientation } : {}),
		...(evt.stanzaId ? { stanzaId: evt.stanzaId } : {}),
		...(evt.notify ? { notify: evt.notify } : {}),
		...(evt.platform ? { platform: evt.platform } : {}),
		...(evt.version ? { version: evt.version } : {})
	}
}
