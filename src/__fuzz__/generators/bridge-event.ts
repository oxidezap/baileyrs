/**
 * Bridge event generator.
 *
 * `src/Bridge/schema.ts` is an exhaustive table: one adapter entry per bridge
 * event variant, and the type system fails the build if a variant is missing. So
 * the list of event types is already enumerated for us — what is not enumerated
 * is what the *payloads* look like when the runtime sends something a little
 * different from what the `.d.ts` promised, which is the whole reason the
 * anti-corruption layer exists.
 *
 * The field-name pool is taken from the properties `schema.ts` actually reads, so
 * generated payloads hit real branches rather than being ignored wholesale. On
 * top of that, a third of them are deliberately wrong-shaped: a string where an
 * object belongs, a missing discriminator, a null where a list belongs.
 */

import { KNOWN_BRIDGE_EVENT_TYPES } from '../../Bridge/schema.ts'
import type { Random } from '../harness/random.ts'
import { generateJid, generateMaybeJid, JID_SERVERS } from './jid.ts'
import { generateAnyValue, generateNumber, generateString } from './values.ts'

export const BRIDGE_EVENT_TYPES: readonly string[] = [...KNOWN_BRIDGE_EVENT_TYPES].toSorted()

/** The properties the adapters read, so generated payloads reach real branches. */
const FIELD_NAMES = [
	'action',
	'timestamp',
	'jid',
	'from',
	'id',
	'lid',
	'code',
	'source',
	'info',
	'platform',
	'message',
	'error',
	'chat_jid',
	'tag',
	'stanza_id',
	'reason',
	'payload',
	'participant_jid',
	'offline',
	'messages',
	'message_ids',
	'message_id',
	'label_id',
	'from_me',
	'call_id',
	'business_name',
	'attrs',
	'version',
	'unavailable_type',
	'unavailable',
	'type',
	'state',
	'participant',
	'participants',
	'removed',
	'picture_id',
	'muted',
	'archived',
	'pinned',
	'starred',
	'expiration'
] as const

/** Discriminators the sync-action adapters switch on, in both casings seen in the wild. */
const ACTION_TYPES = [
	'add',
	'remove',
	'promote',
	'demote',
	'modify',
	'subject',
	'description',
	'announce',
	'not_announce',
	'notAnnounce',
	'Announce',
	'Promote',
	'locked',
	'unlocked',
	'ephemeral',
	'invite',
	'revoke_invite',
	'create',
	'delete',
	'link',
	'unlink',
	'unknown-action',
	''
] as const

const value = (random: Random, depth: number): unknown =>
	random.weighted<() => unknown>([
		// The struct form as well as the string one: `asJidString` only accepts the
		// struct, so a pool of strings alone leaves every JID-guarded branch dead.
		[4, () => bridgeJid(random)],
		[2, () => generateMaybeJid(random)],
		[3, () => generateNumber(random)],
		[3, () => random.bool()],
		[2, () => generateString(random)],
		[2, () => random.pick(ACTION_TYPES)],
		[2, () => undefined],
		[1, () => null],
		[depth > 0 ? 3 : 0, () => payload(random, depth - 1)],
		[depth > 0 ? 2 : 0, () => Array.from({ length: random.int(0, 3) }, () => payload(random, depth - 1))],
		[1, () => generateAnyValue(random)]
	])()

const payload = (random: Random, depth = 2): Record<string, unknown> => {
	const data: Record<string, unknown> = {}
	const keyCount = random.int(0, 6)
	for (let index = 0; index < keyCount; index++) {
		const key = random.pick(FIELD_NAMES)
		Object.defineProperty(data, key, {
			value: value(random, depth),
			enumerable: true,
			writable: true,
			configurable: true
		})
	}
	return data
}

/**
 * A JID the way the *bridge* serialises one: a struct, not a string.
 *
 * `asJidString` runs `isBridgeJid` first and wants `{ user: string, server:
 * string }`. Every JID this generator produced was a string, so every adapter
 * field that goes through `asJidString` read `undefined` — which is most of the
 * guard clauses in the table, and the reason those 22 types could never adapt to
 * anything. The string form is still drawn: `pair_success` deliberately accepts
 * both, and everywhere else it is the shape that has to be rejected.
 */
const validBridgeJid = (random: Random): Record<string, unknown> => {
	const [user, server] = generateJid(random).split('@')
	return {
		user: user ?? '',
		server: server ?? random.pick([...JID_SERVERS]),
		...(random.bool(0.3) ? { agent: random.int(0, 3) } : {}),
		...(random.bool(0.3) ? { device: random.int(0, 5) } : {})
	}
}

const bridgeJid = (random: Random): unknown =>
	random.weighted<() => unknown>([
		[8, () => validBridgeJid(random)],
		[2, () => generateJid(random)],
		[1, () => generateMaybeJid(random)],
		// Struct-shaped but not a JID: `user`/`server` of the wrong type must be rejected.
		[1, () => ({ user: generateNumber(random), server: random.pick([...JID_SERVERS]) })]
	])()

/**
 * A JID for a field an adapter *gates* on.
 *
 * `bridgeJid` mixes in the shapes that have to be rejected, which is right for
 * optional fields but wrong for a guard: `chat_presence` needs a valid `chat`
 * *and* `sender` *and* a canonical `state`, and at one-in-three each that clears
 * eight tries only nine times in ten. The rejected shapes still arrive here
 * through the generic payload, which every other bridge target draws from.
 */
const jidField = (random: Random): unknown => (random.bool(0.9) ? validBridgeJid(random) : bridgeJid(random))

const sourceBlock = (random: Random): Record<string, unknown> => ({
	chat: jidField(random),
	sender: jidField(random),
	is_group: random.bool(),
	is_from_me: random.bool(),
	sender_alt: random.bool(0.4) ? bridgeJid(random) : undefined,
	recipient_alt: random.bool(0.3) ? bridgeJid(random) : undefined
})

const infoBlock = (random: Random): Record<string, unknown> => ({
	id: generateString(random),
	source: sourceBlock(random),
	timestamp: generateNumber(random),
	push_name: random.bool(0.7) ? generateString(random) : undefined,
	is_offline: random.bool(0.3),
	edit: random.bool(0.3) ? random.pick(['1', '2', '7', '']) : undefined
})

const callAction = (random: Random): Record<string, unknown> => ({
	type: random.pick(['offer', 'pre_accept', 'preaccept', 'transport', 'relaylatency', 'accept', 'reject', 'terminate']),
	call_id: random.bool(0.9) ? generateString(random) : undefined,
	call_creator: random.bool(0.6) ? bridgeJid(random) : undefined,
	caller_pn: random.bool(0.5) ? bridgeJid(random) : undefined,
	is_video: random.bool(),
	joinable: random.bool(),
	audio: random.bool(0.4) ? [generateString(random)] : undefined,
	duration: random.bool(0.5) ? generateNumber(random) : undefined
})

const groupParticipant = (random: Random): Record<string, unknown> => ({
	jid: jidField(random),
	type: random.pick(['participant', 'admin', 'superadmin', 'other', '']),
	phone_number: random.bool(0.5) ? bridgeJid(random) : undefined,
	lid: random.bool(0.4) ? bridgeJid(random) : undefined,
	display_name: random.bool(0.4) ? generateString(random) : undefined,
	join_time: random.bool(0.4) ? generateNumber(random) : undefined
})

const groupAction = (random: Random): Record<string, unknown> => ({
	type: random.pick(ACTION_TYPES),
	participants: random.bool(0.6) ? Array.from({ length: random.int(0, 3) }, () => groupParticipant(random)) : undefined,
	subject: generateString(random),
	description: generateString(random),
	// `ephemeral` is dropped outright when this is absent, so it is usually present.
	expiration: random.bool(0.8) ? generateNumber(random) : undefined,
	code: generateString(random),
	mode: generateString(random),
	enabled: random.bool()
})

/**
 * Payloads shaped the way each adapter reads them.
 *
 * The generic `payload` above draws 0-6 keys out of forty flat names, so it
 * essentially never produces the *combination* an adapter needs — `from` and
 * `call_id` together, a nested `source: { chat, sender }`, an `action` object
 * with a discriminator. Measured against the declared table, 22 of the 58 event
 * types never once adapted to anything: every one of those runs returned `null`
 * and a coverage check that only watches for throws called that a pass.
 *
 * So each of those types gets the shape its adapter actually reads. Fields are
 * still fuzzed inside that shape — the point is to get past the guard clause and
 * into the mapping, not to hand the adapter a fixture it cannot fail on.
 */
const SHAPED: Record<string, (random: Random) => Record<string, unknown>> = {
	message: random => ({ info: infoBlock(random), message: { conversation: generateString(random) } }),
	undecryptable_message: random => ({
		info: infoBlock(random),
		is_unavailable: random.bool(),
		unavailable_type: random.bool(0.6) ? generateString(random) : undefined,
		decrypt_fail_mode: random.bool(0.5) ? generateString(random) : undefined
	}),
	receipt: random => ({
		source: sourceBlock(random),
		message_ids: random.bool(0.85) ? Array.from({ length: random.int(1, 3) }, () => generateString(random)) : [],
		timestamp: generateNumber(random),
		type: random.pick(['read', 'read-self', 'played', 'inactive', 'delivery', '', 'nonsense'])
	}),
	push_name_update: random => ({ jid: jidField(random), new_push_name: generateString(random) }),
	contact_update: random => ({
		jid: jidField(random),
		action: { fullName: generateString(random), first_name: generateString(random), username: generateString(random) }
	}),
	picture_update: random => ({
		jid: jidField(random),
		removed: random.bool(),
		author: random.bool(0.6) ? bridgeJid(random) : undefined,
		picture_id: generateString(random)
	}),
	presence: random => ({ from: jidField(random), unavailable: random.bool(), last_seen: generateNumber(random) }),
	chat_presence: random => ({
		source: sourceBlock(random),
		// Anything but these two drops the event, so they are the overwhelming draw.
		state: random.weighted<string>([
			[6, 'composing'],
			[6, 'paused'],
			[1, ''],
			[1, 'recording']
		]),
		media: random.pick(['audio', '', 'video'])
	}),
	group_update: random => ({
		group_jid: jidField(random),
		action: groupAction(random),
		notification_id: generateString(random),
		action_index: generateNumber(random),
		participant: random.bool(0.6) ? bridgeJid(random) : undefined,
		timestamp: generateNumber(random),
		is_lid_addressing_mode: random.bool()
	}),
	archive_update: random => ({ jid: jidField(random), action: { archived: random.bool() } }),
	pin_update: random => ({
		jid: jidField(random),
		timestamp: generateNumber(random),
		action: { pinned: random.bool() }
	}),
	mute_update: random => ({
		jid: jidField(random),
		timestamp: generateNumber(random),
		action: { muted: random.bool(), mute_end_timestamp: generateNumber(random) }
	}),
	star_update: random => ({
		chat_jid: jidField(random),
		message_id: generateString(random),
		from_me: random.bool(),
		participant_jid: random.bool(0.5) ? bridgeJid(random) : undefined,
		action: { starred: random.bool() }
	}),
	mark_chat_as_read_update: random => ({ jid: jidField(random), action: { read: random.bool() } }),
	incoming_call: random => ({
		from: jidField(random),
		action: callAction(random),
		timestamp: generateNumber(random),
		offline: random.bool(0.3)
	}),
	missed_call: random => ({
		from: jidField(random),
		call_id: generateString(random),
		timestamp: generateNumber(random),
		reason: random.pick(['offline', 'timeout', ''])
	}),
	call_ended_elsewhere: random => ({
		from: jidField(random),
		call_id: generateString(random),
		timestamp: generateNumber(random),
		outcome: random.pick(['accepted', 'rejected', ''])
	}),
	dirty_state: random => ({ dirty_type: generateString(random), timestamp: generateNumber(random) }),
	qr: random => ({ code: generateString(random) }),
	// The bridge serialises `pair_success.{id,lid}` as strings even though the
	// .d.ts types them as `Jid`, so both spellings have to be drawn here.
	pair_success: random => ({
		id: random.bool(0.6) ? generateJid(random) : bridgeJid(random),
		lid: random.bool(0.5) ? generateJid(random) : bridgeJid(random),
		platform: generateString(random),
		business_name: generateString(random)
	}),
	pairing_code: random => ({ code: generateString(random) }),
	server_ack: random => ({
		id: generateString(random),
		class: random.pick(['message', 'receipt', 'call', '']),
		from: bridgeJid(random),
		timestamp: generateNumber(random),
		error: random.bool(0.3) ? generateString(random) : undefined
	}),
	raw_node: random => ({ tag: generateString(random), attrs: payload(random, 0), content: generateAnyValue(random) }),
	mex_notification: random => ({
		op_name: generateString(random),
		from: random.bool(0.7) ? bridgeJid(random) : undefined,
		stanza_id: generateString(random),
		offline: random.bool(),
		payload: payload(random, 1)
	})
}

// `contact_updated` is the same adapter under the older spelling.
SHAPED.contact_updated = SHAPED.contact_update!

/**
 * The payload an adapter reads for `type`, or a generic one where none is declared.
 *
 * `Object.hasOwn`, not a bracket lookup. `SHAPED` is an object literal and so
 * inherits `Object.prototype`: `SHAPED['constructor']` is `Object` and returns
 * the `Random` itself, `SHAPED['toString']` returns the string `'[object
 * Undefined]'`, and `SHAPED['__proto__']` is not callable at all. Those three
 * names are exactly what `generateUnknownBridgeEvent` emits as event types, and
 * the registry already carries `bridge-adapter-prototype-chain-lookup` for this
 * class of defect in the adapter — the generator must not reproduce it.
 */
export const shapedBridgePayload = (random: Random, type: string): Record<string, unknown> =>
	(Object.hasOwn(SHAPED, type) ? SHAPED[type]! : payload)(random)

export interface BridgeEventCase {
	readonly type: string
	readonly data: unknown
}

/** A plausible-but-fuzzed event for a type the adapter table declares. */
export const generateKnownBridgeEvent = (random: Random): BridgeEventCase => {
	const type = random.pick(BRIDGE_EVENT_TYPES)
	return {
		type,
		// Thunks, so only the selected branch is built. Passing values would construct
		// every branch and draw from `random` for all of them, coupling the stream to
		// branches that are never used.
		data: random.weighted<() => unknown>([
			// The shape this type's adapter reads, so the mapping is reached and not
			// just its guard clause.
			[6, () => shapedBridgePayload(random, type)],
			[3, () => payload(random)],
			[1, () => undefined],
			[1, () => null],
			[1, () => generateString(random)],
			[1, () => []],
			[1, () => generateNumber(random)]
		])()
	}
}

/** An event the adapter table has never heard of: it must be dropped, not thrown on. */
export const generateUnknownBridgeEvent = (random: Random): BridgeEventCase => ({
	type: random.weighted<() => string>([
		[3, () => generateString(random)],
		[2, () => `${random.pick(BRIDGE_EVENT_TYPES)}_v2`],
		[1, () => ''],
		[1, () => '__proto__'],
		[1, () => 'constructor'],
		[1, () => 'toString']
	])(),
	data: payload(random)
})

export const generateBridgeEvent = (random: Random): BridgeEventCase =>
	random.bool(0.8) ? generateKnownBridgeEvent(random) : generateUnknownBridgeEvent(random)

/** A sequence, so ordering and accumulation bugs have somewhere to appear. */
export const generateBridgeEventSequence = (random: Random, max = 12): BridgeEventCase[] =>
	Array.from({ length: random.int(1, max) }, () => generateBridgeEvent(random))

/**
 * Message-wire payloads, adapted by their own entry point.
 *
 * `MessageWireInfo` is camelCase — `senderAlt`, `isFromMe`, `isViewOnce`,
 * `unavailableRequestId`. An earlier version of this generator used the
 * snake_case spelling the *event* payloads use, so every one of those adapter
 * branches read `undefined` and was never exercised at all.
 */
export const generateMessageWire = (random: Random): { info: Record<string, unknown>; message: unknown } => ({
	info: {
		id: generateString(random),
		chat: generateMaybeJid(random),
		sender: generateMaybeJid(random),
		// Strings, not the bridge JID struct. `adaptBridgeMessageWire` reads
		// `MessageWireInfo` with `asString`, so a struct here reads `undefined` and
		// `participantAlt`/`remoteJidAlt` are never computed — measured: a struct
		// yields `remoteJidAlt: undefined` where the string yields the JID. The
		// struct form belongs on the *event* payloads, which go through
		// `asJidString`; this is the other transport.
		senderAlt: random.bool(0.4) ? generateJid(random) : undefined,
		recipientAlt: random.bool(0.3) ? generateJid(random) : undefined,
		isFromMe: random.bool(),
		isGroup: random.bool(),
		pushName: random.bool(0.7) ? generateString(random) : undefined,
		timestamp: generateNumber(random),
		isViewOnce: random.bool(0.3),
		isOffline: random.bool(0.3),
		unavailableRequestId: random.bool(0.25) ? generateString(random) : undefined,
		edit: random.bool(0.25) ? random.pick(['1', '2', '7', '', 'x']) : undefined
	},
	message: random.bool(0.8) ? { conversation: generateString(random) } : generateAnyValue(random)
})
