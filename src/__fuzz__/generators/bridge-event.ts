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
import { generateJid, generateMaybeJid } from './jid.ts'
import { generateAnyValue, generateNumber, generateString } from './values.ts'

export const BRIDGE_EVENT_TYPES: readonly string[] = [...KNOWN_BRIDGE_EVENT_TYPES].sort()

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
		[4, () => generateMaybeJid(random)],
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
	for (let index = 0; index < random.int(0, 6); index++) {
		data[random.pick(FIELD_NAMES)] = value(random, depth)
	}
	return data
}

export interface BridgeEventCase {
	readonly type: string
	readonly data: unknown
}

/** A plausible-but-fuzzed event for a type the adapter table declares. */
export const generateKnownBridgeEvent = (random: Random): BridgeEventCase => ({
	type: random.pick(BRIDGE_EVENT_TYPES),
	data: random.weighted<unknown>([
		[6, payload(random)],
		[1, undefined],
		[1, null],
		[1, generateString(random)],
		[1, []],
		[1, generateNumber(random)]
	])
})

/** An event the adapter table has never heard of: it must be dropped, not thrown on. */
export const generateUnknownBridgeEvent = (random: Random): BridgeEventCase => ({
	type: random.weighted<string>([
		[3, generateString(random)],
		[2, `${random.pick(BRIDGE_EVENT_TYPES)}_v2`],
		[1, ''],
		[1, '__proto__'],
		[1, 'constructor'],
		[1, 'toString']
	]),
	data: payload(random)
})

export const generateBridgeEvent = (random: Random): BridgeEventCase =>
	random.bool(0.8) ? generateKnownBridgeEvent(random) : generateUnknownBridgeEvent(random)

/** A sequence, so ordering and accumulation bugs have somewhere to appear. */
export const generateBridgeEventSequence = (random: Random, max = 12): BridgeEventCase[] =>
	Array.from({ length: random.int(1, max) }, () => generateBridgeEvent(random))

/** Message-wire payloads, adapted by their own entry point. */
export const generateMessageWire = (random: Random): Record<string, unknown> => ({
	info: {
		id: generateString(random),
		chat: generateMaybeJid(random),
		sender: generateMaybeJid(random),
		sender_alt: random.bool(0.4) ? generateJid(random) : undefined,
		is_from_me: random.bool(),
		is_group: random.bool(),
		push_name: random.bool(0.7) ? generateString(random) : undefined,
		timestamp: generateNumber(random),
		type: random.bool(0.5) ? generateString(random) : undefined
	},
	message: random.bool(0.8) ? { conversation: generateString(random) } : (generateAnyValue(random) as never),
	...(random.bool(0.3) ? { unavailable: random.bool(), unavailable_type: generateString(random) } : {})
})
