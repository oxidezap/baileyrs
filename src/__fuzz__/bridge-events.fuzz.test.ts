/**
 * Bridge anti-corruption layer and event buffer, fuzzed on sequences.
 *
 * `adaptBridgeEvent` is the only thing standing between a WASM runtime and every
 * consumer's `sock.ev.on(...)` handler. Its contract is that a shape it does not
 * recognise is *dropped* — returns null — and never thrown, because a throw here
 * takes down the socket's event loop rather than one event. That contract is
 * exactly the kind that unit tests confirm for the shapes somebody imagined.
 *
 * The event buffer is the other half: it consolidates events while a history sync
 * is in flight, and a bug there is silent by construction — a lost `messages.upsert`
 * looks like a message that never arrived. It is fuzzed differentially against
 * upstream's `makeEventBuffer` on the same emit/buffer/flush sequences, plus the
 * invariants that hold regardless of what upstream does.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adaptBridgeEvent, adaptBridgeMessageWire, KNOWN_BRIDGE_EVENT_TYPES } from '../Bridge/adapt.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import type { ILogger } from '../Utils/logger.ts'
import { compareOutcomes, equivalent, normalise, runOutcome, showOutcome } from './harness/compare.ts'
import type { Divergence } from './harness/divergence.ts'
import { fuzz } from './harness/runner.ts'
import type { Random } from './harness/random.ts'
import {
	BRIDGE_EVENT_TYPES,
	generateBridgeEvent,
	generateBridgeEventSequence,
	generateMessageWire,
	shapedBridgePayload,
	type BridgeEventCase
} from './generators/bridge-event.ts'
import { generateJid } from './generators/jid.ts'
import { generateNumber, generateString } from './generators/values.ts'

const upstream = (await import('baileys')) as unknown as {
	makeEventBuffer: (logger: unknown) => UpstreamBuffer
}

interface UpstreamBuffer {
	on(event: string, handler: (data: unknown) => void): void
	emit(event: string, data: unknown): boolean
	buffer(): void
	flush(): boolean
	process(handler: (events: Record<string, unknown>) => void): () => void
}

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as unknown as ILogger

/**
 * The canonical tag a bridge event type is expected to adapt to.
 *
 * A convention plus its exceptions, not a transcription of the adapter's own
 * dispatch: the convention is snake_case to camelCase, which holds for 47 of the
 * 58 declared types, and the eleven below are the real renames and merges — each
 * one a decision somebody made rather than a mechanical transformation. Changing
 * any of them has to be a deliberate edit here, which is the point.
 *
 * The last four were missed on the first pass because the fixed seed never drew
 * a payload that cleared their guards: all four returned `noop` on every run and
 * only a deep seed reached their success path. A sampled expectation table is
 * not a complete one — these were filled in from the adapter's declared returns
 * once the deep run proved sampling insufficient.
 */
const TAG_EXCEPTIONS: Readonly<Record<string, string>> = {
	// Three different bridge signals, one canonical call event.
	incoming_call: 'incomingCall',
	missed_call: 'incomingCall',
	call_ended_elsewhere: 'incomingCall',
	// A pairing code is shown to the user exactly as a QR is.
	pairing_code: 'qr',
	// Past tense on the wire, present tense in the canonical event.
	contact_updated: 'contactUpdate',
	// The `_update` suffix is dropped on the two label events.
	label_edit_update: 'labelEdit',
	label_association_update: 'labelAssociation',
	// Named after what the event *is* rather than after the wire signal that
	// carries it — verb first, and the `_update` suffix dropped again.
	delete_chat_update: 'chatDelete',
	clear_chat_update: 'chatClear',
	delete_message_for_me_update: 'messageDelete',
	// A changed contact number is how the runtime tells us about a LID mapping.
	contact_number_changed: 'lidMappingUpdate'
}

const camelCase = (value: string): string =>
	value.replaceAll(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase())

/**
 * The types whose adapter can only ever return `{ type: 'noop' }`.
 *
 * Derived from the adapter's declared returns, not from what a run happened to
 * produce: an entry whose body contains no `type:` literal other than `'noop'`
 * cannot surface anything, whatever payload it is given. Sampling got this
 * wrong once already — four types that only no-op'd on the fixed seed turned
 * out to have reachable success paths on a deep one — so this is read from the
 * source and then checked against eight seeds, where no member ever surfaced a
 * real event.
 */
const UNCONDITIONALLY_INERT: ReadonlySet<string> = new Set([
	'pairing_code_refresh',
	'pair_passkey_request',
	'pair_passkey_confirmation',
	'pair_passkey_error',
	'self_push_name_updated',
	'offline_sync_preview',
	'device_list_update',
	'identity_change',
	'business_status_update',
	'contact_sync_requested',
	'user_about_update',
	'user_status_mute_update'
])

/**
 * Types that *can* surface an event but whose guard this file does not reliably
 * clear.
 *
 * A gap here, not a decision in the adapter — which is why they are listed apart
 * from the set above rather than folded into it. Each needs a shaped payload
 * that satisfies its guard; until then `noop` has to be tolerated for them, or
 * the sweep fails on this file's shortcoming rather than on the library's
 * behaviour.
 *
 * The membership rule is "no-ops on at least one seed", not "no-ops on the
 * fixed seed". Four of these do surface on some seeds and not others, so a set
 * built from one run would have passed there and failed on the nightly's next
 * seed. Measured as the union across ten seeds, each run exactly as the target
 * runs it — the same cursor over the type list, the same 16 rounds.
 */
const NOT_YET_REACHABLE: ReadonlySet<string> = new Set([
	'clear_chat_update',
	'contact_number_changed',
	'delete_chat_update',
	'delete_message_for_me_update',
	'disappearing_mode_changed',
	'label_association_update',
	'label_edit_update',
	'newsletter_live_update'
])

/**
 * `noop` used to be allowed for every declared type, on the reasoning that the
 * collapse assertion after the sweep would catch an adapter that stopped
 * surfacing things. It does not: measured, one production event regressing to
 * `noop` takes the distinct-tag count from 34 to 33 and three take it to 31,
 * both far above the floor of 25. Losing a handful of events stayed green.
 *
 * So `noop` is now allowed only where it is the adapter's whole behaviour, or
 * where this file cannot yet reach the success path. A type outside both sets
 * that returns `noop` is an event that stopped being surfaced, and that should
 * be a deliberate edit here rather than a silent change.
 */
const allowedTags = (type: string): ReadonlySet<string> => {
	const canonical = TAG_EXCEPTIONS[type] ?? camelCase(type)
	return UNCONDITIONALLY_INERT.has(type) || NOT_YET_REACHABLE.has(type)
		? new Set([canonical, 'noop'])
		: new Set([canonical])
}

// ---------------------------------------------------------------------------
// The anti-corruption layer
// ---------------------------------------------------------------------------

describe('bridge event adaptation', () => {
	it('never throws, whatever the runtime sends', async () => {
		await fuzz<BridgeEventCase[]>({
			target: 'bridge:adapt-total',
			runs: 500,
			generate: random => generateBridgeEventSequence(random),
			check: sequence => {
				if (!Array.isArray(sequence)) return []
				const findings: Divergence[] = []
				for (const event of sequence) {
					let result: unknown
					try {
						result = adaptBridgeEvent(event as never, silentLogger)
					} catch (error) {
						findings.push({
							target: 'bridge:adapt-total',
							input: event,
							local: `<threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 160)}>`,
							upstream: '<null, or a canonical event>',
							detail: 'a malformed bridge event threw instead of being dropped'
						})
						continue
					}
					// `null` means "drop it"; anything else must be a tagged canonical
					// event, because `Socket/events.ts` switches on that tag.
					if (result === null) continue
					if (typeof result !== 'object' || typeof (result as { type?: unknown }).type !== 'string') {
						findings.push({
							target: 'bridge:adapt-total',
							input: event,
							local: result,
							upstream: '<null, or an object with a string `type`>',
							detail: 'the adapter returned something the event dispatcher cannot switch on'
						})
					}
				}
				return findings
			}
		})
	})

	it('drops every event type it does not declare', async () => {
		await fuzz<BridgeEventCase>({
			target: 'bridge:adapt-unknown',
			runs: 400,
			generate: random => ({
				type: random.weighted<string>([
					[4, generateString(random)],
					[2, `${random.pick(BRIDGE_EVENT_TYPES)}_v2`],
					[1, '__proto__'],
					[1, 'constructor'],
					[1, 'hasOwnProperty']
				]),
				data: generateBridgeEvent(random).data
			}),
			check: event => {
				if (typeof event?.type !== 'string') return []
				if (KNOWN_BRIDGE_EVENT_TYPES.has(event.type)) return []

				let result: unknown
				try {
					result = adaptBridgeEvent(event as never, silentLogger)
				} catch (error) {
					return {
						target: 'bridge:adapt-unknown',
						input: event,
						local: `<threw ${(error as Error)?.name}>`,
						upstream: 'null',
						detail: 'an unknown event type threw instead of being dropped'
					}
				}
				if (result === null) return []
				// `__proto__`, `constructor` and friends resolve on a plain object even
				// when nobody put them there — a lookup table indexed by an untrusted
				// string has to be immune to that.
				return {
					target: 'bridge:adapt-unknown',
					input: event,
					local: result,
					upstream: 'null',
					detail: 'an event type the table does not declare produced a canonical event'
				}
			}
		})
	})

	it('adapts deterministically', async () => {
		await fuzz<BridgeEventCase>({
			target: 'bridge:adapt-deterministic',
			runs: 400,
			generate: generateBridgeEvent,
			check: event => {
				// Throwing twice the same way is deterministic; that the throw happens at
				// all is bridge:adapt-total's subject, not this one's.
				const once = runOutcome(() => adaptBridgeEvent(structuredClone(event) as never, silentLogger))
				const twice = runOutcome(() => adaptBridgeEvent(structuredClone(event) as never, silentLogger))
				if (compareOutcomes(once, twice).same) return []
				return {
					target: 'bridge:adapt-deterministic',
					input: event,
					local: showOutcome(once),
					upstream: showOutcome(twice),
					detail: 'the same event adapted to two different results — the layer is carrying state'
				}
			}
		})
	})

	it('adapts every declared event type to the canonical event it belongs to', async () => {
		// Finite and exhaustive: the table declares these, so all of them are checked.
		let cursor = 0
		// Not throwing is a low bar: an adapter that returns `null` for every input
		// it is ever shown clears it, and so does one whose guard clause rejects a
		// payload the generator can never satisfy. Measured before this counter
		// existed, 22 of the 58 declared types adapted to `null` on every run — a
		// third of the table was declared covered while none of its mapping ran.
		// So the return value is recorded per type and asserted after the sweep.
		//
		// And counting a non-null result was itself too weak: an adapter that routed
		// `push_name_update` to a generic `{ type: 'message' }` incremented the same
		// counter, and neither the totality target (any object with a string tag) nor
		// the determinism target (the same wrong answer twice) could see it. So the
		// tag is checked against the one this type belongs to, and every tag observed
		// per type is recorded for the collapse checks below.
		const adapted = new Map(BRIDGE_EVENT_TYPES.map(type => [type, 0]))
		const tagsSeen = new Map<string, Set<string>>(BRIDGE_EVENT_TYPES.map(type => [type, new Set<string>()]))
		const report = await fuzz<{ type: string; data: unknown }>({
			target: 'bridge:adapt-coverage',
			// Sixteen tries per type, not eight: the shaped payload still fuzzes the
			// fields inside the shape, so a type gated on three of them at once needs
			// the headroom to clear the guard at least once on every seed.
			runs: BRIDGE_EVENT_TYPES.length * 16,
			exhaustive: true,
			shrinkFailures: false,
			generate: (random: Random) => {
				const type = BRIDGE_EVENT_TYPES[cursor++ % BRIDGE_EVENT_TYPES.length]!
				return { type, data: shapedBridgePayload(random, type) }
			},
			check: event => {
				let canonical: { type?: unknown } | null
				try {
					canonical = adaptBridgeEvent(event as never, silentLogger) as { type?: unknown } | null
				} catch (error) {
					return {
						target: 'bridge:adapt-coverage',
						input: event,
						local: `<threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: '<null, or a canonical event>',
						detail: 'a declared event type threw on a fuzzed payload'
					}
				}
				if (canonical == null) return []
				adapted.set(event.type, (adapted.get(event.type) ?? 0) + 1)
				const tag = String(canonical.type)
				tagsSeen.get(event.type)?.add(tag)
				if (allowedTags(event.type).has(tag)) return []
				return {
					target: 'bridge:adapt-coverage',
					input: event,
					local: tag,
					upstream: [...allowedTags(event.type)].join(' | '),
					detail: 'a declared event type adapted to a canonical event it does not belong to'
				}
			}
		})

		// Not when the target was filtered out. `FUZZ_ONLY=proto:` skips this sweep
		// entirely, and the counter would then report every declared type as inert —
		// a failure about a run that never happened.
		if (report.runs === 0) return

		// Asserted here rather than reported as a divergence: these are statements
		// about the *generator* and about the table as a whole, not about a
		// disagreement between two libraries, and no allowlist entry should be able
		// to excuse them.
		const inert = [...adapted].filter(([, count]) => count === 0).map(([type]) => type)
		assert.deepEqual(
			inert,
			[],
			`these declared event types adapted to null on every run — the generator never produces a payload their adapter accepts, so their mapping is untested:\n  ${inert.join('\n  ')}`
		)

		// One non-noop tag per type. The per-event check above allows `noop`
		// everywhere, because most of these types are deliberately inert; this stops
		// that allowance from hiding a tag that varies with the payload, which would
		// mean the routing depends on the data rather than on the event type.
		const unstable = [...tagsSeen]
			.map(([type, tags]) => [type, [...tags].filter(tag => tag !== 'noop')] as const)
			.filter(([, tags]) => tags.length > 1)
		assert.deepEqual(
			unstable.map(([type]) => type),
			[],
			`these types produced more than one canonical tag, so their routing depends on the payload rather than the type:\n  ${unstable.map(([type, tags]) => `${type} -> ${tags.join(' | ')}`).join('\n  ')}`
		)

		// And the table must not collapse. Since `noop` is allowed for every type, an
		// adapter that no-op'd everything would satisfy both checks above while
		// testing nothing. Measured at 34 distinct non-noop tags on the fixed seed;
		// the floor is well under that so an unlucky draw cannot trip it, but well
		// over what a collapse would leave.
		const distinct = new Set([...tagsSeen.values()].flatMap(tags => [...tags]).filter(tag => tag !== 'noop'))
		assert.ok(
			distinct.size >= 25,
			`only ${distinct.size} distinct canonical tags across the whole table — the adapter is collapsing event types onto a shared result`
		)
	})

	it('carries the message and its envelope through the message-wire adapter', async () => {
		// The result is inspected, not discarded. "Never throws" on its own is
		// cleared by an adapter that returns `null` for every input it is ever
		// shown, so a regression that dropped every valid message would have passed
		// all 400 cases. Nor is the envelope enough on its own: with only the tag,
		// chat and id checked, an adapter that replaced `messageProto` with `{}` —
		// losing the entire payload, which is the one thing this transport exists to
		// carry — still passed every case. So the payload is compared too.
		//
		// Across the sweep the adapter also has to accept *something*: measured at
		// 288 of 400 draws on the fixed seed, so a floor of one is a liveness check
		// with headroom rather than a threshold that flakes on an unlucky seed.
		let accepted = 0
		const report = await fuzz<Record<string, unknown>>({
			target: 'bridge:message-wire',
			runs: 400,
			generate: generateMessageWire,
			check: wire => {
				let canonical: ReturnType<typeof adaptBridgeMessageWire>
				try {
					canonical = adaptBridgeMessageWire(wire.message, wire.info as never, silentLogger)
				} catch (error) {
					return {
						target: 'bridge:message-wire',
						input: wire,
						local: `<threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: '<null, or a canonical message>',
						detail: 'a malformed message-wire payload threw instead of being dropped'
					}
				}
				// Dropping a payload is always allowed — the adapter's contract is
				// "null on unrecoverable shape mismatch", and the generator produces
				// plenty of those on purpose.
				if (canonical === null) return []
				accepted++
				const info = wire.info as Record<string, unknown>

				// Deep, not by reference: an adapter that copies the proto on its way
				// through is doing nothing wrong, and pinning identity would forbid it.
				// What must not change is the content — and `content` includes the
				// runtime type. `coerceScalars` defaults on, which exists so a Rust u64
				// can be compared against a protobufjs Long; here it meant a generated
				// `conversation: '0'` compared equal to an adapter that handed back
				// `conversation: 0`, which a consumer can tell apart with `typeof`,
				// `===` or arithmetic. Off, as the pure-helper differential has it, for
				// the same reason: this is a plain JavaScript value, not a value being
				// carried across two protobuf runtimes.
				const strict = { preservePresence: true, coerceScalars: false }
				if (!equivalent(canonical.messageProto, wire.message, strict)) {
					return {
						target: 'bridge:message-wire',
						input: wire,
						local: normalise(canonical.messageProto),
						upstream: normalise(wire.message),
						detail: 'the adapter accepted a message but did not carry its proto through unchanged'
					}
				}

				// The scalar envelope, but only where the input makes the expected value
				// unambiguous. Re-deriving `asString`/`asNumber` for a malformed input
				// would just restate the adapter's own coercion rules back at it, which
				// proves nothing; a plain string pushName or a finite timestamp has one
				// correct answer that does not depend on them.
				const envelope: Record<string, unknown> = { type: canonical.type, chatJid: canonical.chatJid, id: canonical.id }
				const expected: Record<string, unknown> = { type: 'message', chatJid: info.chat, id: info.id }
				if (typeof info.pushName === 'string') {
					envelope.pushName = canonical.pushName
					expected.pushName = info.pushName
				}
				if (typeof info.timestamp === 'number' && Number.isFinite(info.timestamp)) {
					envelope.timestamp = canonical.timestamp
					expected.timestamp = info.timestamp
				}
				if (typeof info.isFromMe === 'boolean') {
					envelope.isFromMe = canonical.isFromMe
					expected.isFromMe = info.isFromMe
				}
				if (equivalent(envelope, expected, strict)) return []
				return {
					target: 'bridge:message-wire',
					input: wire,
					local: envelope,
					upstream: expected,
					detail: 'the adapter accepted a message but changed its envelope'
				}
			}
		})

		// Asserted rather than reported, for the same reason as the coverage counter
		// above: this is a statement about the generator and the adapter's liveness,
		// and no allowlist entry should be able to excuse it. Skipped when FUZZ_ONLY
		// filtered the target out, since the counter would then be about a run that
		// never happened.
		if (report.runs === 0) return
		assert.ok(
			accepted > 0,
			`adaptBridgeMessageWire returned null on all ${report.runs} draws — either the generator stopped producing valid payloads or the adapter now drops everything`
		)
	})
})

// ---------------------------------------------------------------------------
// The event buffer
// ---------------------------------------------------------------------------

/** The events the buffer consolidates, plus one it must pass straight through. */
const EMITTABLE = [
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
	'groups.update',
	'connection.update'
] as const

type Step =
	| { readonly kind: 'emit'; readonly event: string; readonly data: unknown }
	| { readonly kind: 'buffer' }
	| { readonly kind: 'flush' }

const messageKey = (random: Random) => ({
	remoteJid: generateJid(random),
	id: random.pick(['A1', 'B2', 'C3', 'D4']),
	fromMe: random.bool(),
	participant: random.bool(0.3) ? generateJid(random) : undefined
})

/**
 * A four-entry jid pool for the history-set payloads.
 *
 * Small enough that two rows in one batch, or two batches before a flush,
 * collide often — which is what drives the merge and dedup branches. The
 * occasional draw from the full grammar keeps the hostile shapes reachable
 * without diluting the pool into uniqueness.
 */
const HISTORY_JIDS = [
	'15551234567@s.whatsapp.net',
	'15550000000@s.whatsapp.net',
	'120363000000000000@g.us',
	'100000000000000@lid'
] as const

const historyJid = (random: Random): string => (random.bool(0.9) ? random.pick(HISTORY_JIDS) : generateJid(random))

/**
 * The identities one generated sequence draws from.
 *
 * The same reasoning as `historyJid` one level up, applied across steps rather
 * than within one payload. The buffer's whole job is consolidation — absorbing a
 * pending `messages.update` into an upsert, attaching a reaction or a receipt to
 * a buffered message, folding a `chats.update` into a `chats.upsert` — and it
 * keys all of that on `${remoteJid},${id},${fromMe}`. With every payload drawing
 * a fresh independent key, none of those branches ran: measured over the fixed
 * `buffer:differential` stream, **zero** of 466 update/reaction/receipt events
 * shared a key with any preceding upsert in the same sequence.
 *
 * So a sequence picks from a handful of identities, and mostly reuses them. Not
 * always: a follow-up for a message nobody buffered is its own branch, and a
 * pool of one would collapse every event onto a single key and stop testing that
 * the buffer keeps distinct messages apart.
 */
interface StepPool {
	readonly keys: readonly Record<string, unknown>[]
	readonly chats: readonly string[]
}

const makeStepPool = (random: Random): StepPool => ({
	keys: Array.from({ length: random.int(2, 3) }, () => messageKey(random)),
	chats: Array.from({ length: random.int(2, 3) }, () => generateJid(random))
})

/** A key from the pool most of the time, a fresh one otherwise. */
const pooledKey = (random: Random, pool: StepPool): Record<string, unknown> =>
	random.bool(0.75) ? { ...random.pick([...pool.keys]) } : messageKey(random)

const pooledChat = (random: Random, pool: StepPool): string =>
	random.bool(0.75) ? random.pick([...pool.chats]) : generateJid(random)

const payloadFor = (random: Random, event: string, pool: StepPool): unknown => {
	switch (event) {
		// The buffer's largest stateful branch: it merges chats, contacts and
		// messages into `historySets` by id, folds later chat updates into entries
		// already there, and carries syncType/progress/isLatest across flushes.
		//
		// Ids come from `historyJid`, not `generateJid`, and that is the whole point.
		// The merge only runs when the same id shows up twice, and the full grammar
		// draws ~214 distinct values in 300 tries, so the fold would be reached by
		// coincidence at best. Its most common single value is the empty string,
		// which fails the other way round — every row collapses under the `''` key
		// and the dedup looks exercised while nothing distinct was ever merged.
		case 'messaging-history.set':
			return {
				chats: Array.from({ length: random.int(0, 3) }, () => ({
					id: historyJid(random),
					conversationTimestamp: generateNumber(random),
					unreadCount: random.int(0, 5),
					endOfHistoryTransferType: random.bool(0.3) ? random.int(0, 2) : undefined
				})),
				contacts: Array.from({ length: random.int(0, 3) }, () => ({
					id: historyJid(random),
					name: random.bool(0.5) ? generateString(random) : undefined,
					notify: random.bool(0.3) ? generateString(random) : undefined
				})),
				messages: Array.from({ length: random.int(0, 3) }, () => ({
					key: messageKey(random),
					messageTimestamp: generateNumber(random),
					message: { conversation: generateString(random) }
				})),
				pastParticipants: random.bool(0.25)
					? [{ groupJid: historyJid(random), pastParticipants: [{ userJid: historyJid(random), leaveReason: 0 }] }]
					: undefined,
				syncType: random.bool(0.5) ? random.int(0, 5) : undefined,
				progress: random.bool(0.5) ? random.int(0, 100) : undefined,
				chunkOrder: random.int(0, 3),
				isLatest: random.bool(),
				peerDataRequestSessionId: random.bool(0.3) ? generateString(random) : undefined
			}
		case 'chats.upsert':
			return [
				{ id: pooledChat(random, pool), conversationTimestamp: generateNumber(random), unreadCount: random.int(0, 5) }
			]
		case 'chats.update':
			return [{ id: pooledChat(random, pool), unreadCount: random.int(0, 5), name: generateString(random) }]
		case 'chats.delete':
			return [pooledChat(random, pool)]
		case 'contacts.upsert':
			return [{ id: pooledChat(random, pool), name: generateString(random) }]
		case 'contacts.update':
			return [{ id: pooledChat(random, pool), name: generateString(random) }]
		case 'messages.upsert':
			return {
				type: random.pick(['notify', 'append']),
				messages: [
					{
						key: pooledKey(random, pool),
						messageTimestamp: generateNumber(random),
						message: { conversation: generateString(random) }
					}
				]
			}
		case 'messages.update':
			return [{ key: pooledKey(random, pool), update: { status: random.int(0, 4) } }]
		case 'messages.delete':
			return random.bool(0.5) ? { keys: [pooledKey(random, pool)] } : { jid: pooledChat(random, pool), all: true }
		case 'messages.reaction':
			return [
				{
					key: pooledKey(random, pool),
					reaction: { text: random.pick(['👍', '❤️', '']), key: pooledKey(random, pool) }
				}
			]
		case 'message-receipt.update':
			return [
				{
					key: pooledKey(random, pool),
					receipt: { userJid: pooledChat(random, pool), readTimestamp: generateNumber(random) }
				}
			]
		case 'groups.update':
			return [{ id: pooledChat(random, pool), subject: generateString(random) }]
		default:
			return { connection: random.pick(['open', 'close', 'connecting']) }
	}
}

const generateSteps = (random: Random): Step[] => {
	const steps: Step[] = []
	// One pool per sequence, so the events within it can refer to the same
	// messages and chats — which is the only way the buffer's consolidation
	// branches are reached at all.
	const pool = makeStepPool(random)
	// Drawn once: in the loop condition the bound would be re-rolled every pass.
	const stepCount = random.int(2, 20)
	for (let index = 0; index < stepCount; index++) {
		steps.push(
			random.weighted<Step>([
				[
					6,
					(() => {
						const event = random.pick(EMITTABLE)
						return { kind: 'emit', event, data: payloadFor(random, event, pool) } as Step
					})()
				],
				[2, { kind: 'buffer' } as Step],
				[2, { kind: 'flush' } as Step]
			])
		)
	}
	return steps
}

/**
 * Runs a step list through an emitter and records everything observable: the
 * events it released, in order, and any step that threw.
 *
 * Throws are part of the observation rather than an error in the fuzzer, because
 * "baileyrs throws on a payload upstream absorbs" is precisely the kind of
 * difference worth reporting — and because shrinking will happily hand both
 * buffers a payload neither was built for, where agreeing to throw is the
 * correct answer.
 */
type Observation =
	| { readonly released: string; readonly data: unknown }
	| { readonly threw: string; readonly at: string }
	// `flush()` answers "was there anything to release", and callers branch on it.
	// Discarding it meant a buffer that returned the wrong boolean while releasing
	// the right events agreed with upstream on both targets — and the fixed
	// invariant below only covers one `chats.upsert` sequence, so any other
	// consolidation path returning `true` after it had already drained was
	// invisible.
	| { readonly flushed: boolean }
	// And the drain's cap is an observation too: without it, a buffer that
	// answered `true` forever left the loop at 100 with nothing recorded, which
	// reads exactly like one that drained cleanly.
	| { readonly drainedAfter: number; readonly exhausted: boolean }

const observe = (
	make: () => {
		on(event: string, handler: (data: unknown) => void): void
		emit(event: string, data: unknown): boolean
		buffer(): void
		flush(): boolean
	},
	steps: readonly Step[]
): Observation[] => {
	const emitter = make()
	const seen: Observation[] = []
	for (const event of EMITTABLE) emitter.on(event, data => seen.push({ released: event, data }))

	const guard = (label: string, work: () => void) => {
		try {
			work()
		} catch (error) {
			seen.push({ threw: (error as Error)?.name ?? 'Error', at: label })
		}
	}

	for (const step of steps) {
		if (step.kind === 'emit') guard(`emit ${step.event}`, () => emitter.emit(step.event, structuredClone(step.data)))
		else if (step.kind === 'buffer') guard('buffer', () => emitter.buffer())
		else {
			// Recorded in the stream, in order, so a wrong answer shows up as a
			// divergence at the step that produced it rather than not at all.
			guard('flush', () => seen.push({ flushed: emitter.flush() }))
		}
	}

	// Drain whatever is still buffered, so a sequence that ends mid-buffer is
	// compared on what it holds rather than on what it happened to have released.
	const cap = 100
	let drained = 0
	let exhausted = false
	for (; drained < cap; drained++) {
		let more = false
		guard('drain', () => {
			more = emitter.flush()
		})
		if (!more) {
			exhausted = true
			break
		}
	}
	seen.push({ drainedAfter: drained, exhausted })

	// Each buffer registers listeners, a history cache and up to two timers. The
	// differential and conservation targets build two per case across 300 cases
	// each, so releasing them keeps peak memory honest. `destroy` is not on the
	// upstream interface, hence the guarded call.
	;(emitter as { destroy?: () => void }).destroy?.()
	return seen
}

/**
 * Shrinking drops object keys, so it will propose an `emit` step with no event
 * name. That is not a smaller version of the failure — it is a different input
 * the property was never about — so it is rejected outright.
 */
const isSteps = (value: unknown): value is Step[] =>
	Array.isArray(value) &&
	value.every(step => {
		if (typeof step !== 'object' || step === null) return false
		const kind = (step as { kind?: unknown }).kind
		if (kind === 'buffer' || kind === 'flush') return true
		const event = (step as { event?: unknown }).event
		// The event name must be one this harness listens for, or 'never released'
		// would just mean 'nobody was listening'.
		return kind === 'emit' && typeof event === 'string' && (EMITTABLE as readonly string[]).includes(event)
	})

describe('event buffer', () => {
	it('releases the same events as upstream for the same sequence', async () => {
		await fuzz<Step[]>({
			target: 'buffer:differential',
			runs: 300,
			generate: generateSteps,
			check: steps => {
				if (!isSteps(steps)) return []

				const local = observe(() => makeEventBuffer(silentLogger), steps)
				const remote = observe(() => upstream.makeEventBuffer(silentLogger) as never, steps)

				// `preservePresence: true`, as the pure-helper and message-wire targets
				// already use. Without it, one buffer deleting an optional property and
				// the other leaving it holding `undefined` compare equal — and the
				// generated payloads are full of such fields (`participant`, `name`,
				// `notify`, the history-sync metadata). A consumer tells them apart with
				// `Object.keys`, spread or `in`, so a consolidation change that altered
				// the public event shape is a real difference, not a representation one.
				// `coerceScalars: false` alongside it. Coercion exists so a Rust u64 can be
				// compared against a protobufjs Long — these are plain event payloads, and
				// the generator emits numeric-looking strings on purpose, so folding
				// `conversation: '0'` together with the number `0` would hide a
				// consolidation that changed a text value's runtime type. A consumer sees
				// that difference through `typeof`, `===` and arithmetic.
				if (equivalent(local, remote, { preservePresence: true, coerceScalars: false })) return []
				return {
					target: 'buffer:differential',
					input: steps,
					local: normalise(local),
					upstream: normalise(remote),
					detail: 'the two buffers released different events for the same sequence'
				}
			}
		})
	})

	it('never releases fewer events than upstream', async () => {
		// Loss is the severe failure mode and it is silent by construction: a
		// `messages.upsert` that never arrives looks exactly like a message that was
		// never sent. Ordering differences are the differential target's subject —
		// this one only asks whether anything went missing.
		//
		// The comparison is against upstream rather than against the input, because
		// both libraries legitimately consolidate some payloads away entirely: a
		// `messages.delete` with no keys releases nothing on either side, and calling
		// that a loss would be wrong.
		await fuzz<Step[]>({
			target: 'buffer:conservation',
			runs: 300,
			generate: generateSteps,
			check: steps => {
				if (!isSteps(steps)) return []

				const count = (observations: readonly Observation[]) => {
					const tally = new Map<string, number>()
					for (const entry of observations) {
						if (!('released' in entry)) continue
						tally.set(entry.released, (tally.get(entry.released) ?? 0) + 1)
					}
					return tally
				}

				const local = count(observe(() => makeEventBuffer(silentLogger), steps))
				const remote = count(observe(() => upstream.makeEventBuffer(silentLogger) as never, steps))

				const missing = [...remote]
					.filter(([event, total]) => (local.get(event) ?? 0) < total)
					.map(([event, total]) => `${event} (${local.get(event) ?? 0} of ${total})`)
				if (missing.length === 0) return []

				return {
					target: 'buffer:conservation',
					input: steps,
					local: Object.fromEntries(local),
					upstream: Object.fromEntries(remote),
					detail: `released fewer events than upstream: ${missing.join(', ')}`
				}
			}
		})
	})

	it('has nothing left to release after a flush', () => {
		// A plain invariant, not a fuzz target: `flush` returning true forever would
		// make the drain loop in `observe` spin, so it is pinned separately and first.
		const buffer = makeEventBuffer(silentLogger)
		buffer.buffer()
		buffer.emit('chats.upsert', [{ id: '15551234567@s.whatsapp.net' }] as never)
		assert.equal(buffer.flush(), true, 'the first flush releases the buffered events')
		assert.equal(buffer.flush(), false, 'a second flush has nothing to release')
	})
})
