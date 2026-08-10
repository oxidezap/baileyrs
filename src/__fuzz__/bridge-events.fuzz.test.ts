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

	it('handles every declared event type without throwing', async () => {
		// Finite and exhaustive: the table declares these, so all of them are checked.
		let cursor = 0
		await fuzz<{ type: string; data: unknown }>({
			target: 'bridge:adapt-coverage',
			runs: BRIDGE_EVENT_TYPES.length * 8,
			exhaustive: true,
			shrinkFailures: false,
			generate: (random: Random) => ({
				type: BRIDGE_EVENT_TYPES[cursor++ % BRIDGE_EVENT_TYPES.length]!,
				data: generateBridgeEvent(random).data
			}),
			check: event => {
				try {
					adaptBridgeEvent(event as never, silentLogger)
					return []
				} catch (error) {
					return {
						target: 'bridge:adapt-coverage',
						input: event,
						local: `<threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: '<null, or a canonical event>',
						detail: 'a declared event type threw on a fuzzed payload'
					}
				}
			}
		})
	})

	it('never throws on a message-wire payload', async () => {
		await fuzz<Record<string, unknown>>({
			target: 'bridge:message-wire',
			runs: 400,
			generate: generateMessageWire,
			check: wire => {
				try {
					adaptBridgeMessageWire(wire.message, wire.info as never, silentLogger)
					return []
				} catch (error) {
					return {
						target: 'bridge:message-wire',
						input: wire,
						local: `<threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: '<null, or a canonical message>',
						detail: 'a malformed message-wire payload threw instead of being dropped'
					}
				}
			}
		})
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

const payloadFor = (random: Random, event: string): unknown => {
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
			return [{ id: generateJid(random), conversationTimestamp: generateNumber(random), unreadCount: random.int(0, 5) }]
		case 'chats.update':
			return [{ id: generateJid(random), unreadCount: random.int(0, 5), name: generateString(random) }]
		case 'chats.delete':
			return [generateJid(random)]
		case 'contacts.upsert':
			return [{ id: generateJid(random), name: generateString(random) }]
		case 'contacts.update':
			return [{ id: generateJid(random), name: generateString(random) }]
		case 'messages.upsert':
			return {
				type: random.pick(['notify', 'append']),
				messages: [
					{
						key: messageKey(random),
						messageTimestamp: generateNumber(random),
						message: { conversation: generateString(random) }
					}
				]
			}
		case 'messages.update':
			return [{ key: messageKey(random), update: { status: random.int(0, 4) } }]
		case 'messages.delete':
			return random.bool(0.5) ? { keys: [messageKey(random)] } : { jid: generateJid(random), all: true }
		case 'messages.reaction':
			return [{ key: messageKey(random), reaction: { text: random.pick(['👍', '❤️', '']), key: messageKey(random) } }]
		case 'message-receipt.update':
			return [
				{ key: messageKey(random), receipt: { userJid: generateJid(random), readTimestamp: generateNumber(random) } }
			]
		case 'groups.update':
			return [{ id: generateJid(random), subject: generateString(random) }]
		default:
			return { connection: random.pick(['open', 'close', 'connecting']) }
	}
}

const generateSteps = (random: Random): Step[] => {
	const steps: Step[] = []
	// Drawn once: in the loop condition the bound would be re-rolled every pass.
	const stepCount = random.int(2, 20)
	for (let index = 0; index < stepCount; index++) {
		steps.push(
			random.weighted<Step>([
				[
					6,
					(() => {
						const event = random.pick(EMITTABLE)
						return { kind: 'emit', event, data: payloadFor(random, event) } as Step
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
		else guard('flush', () => emitter.flush())
	}

	// Drain whatever is still buffered, so a sequence that ends mid-buffer is
	// compared on what it holds rather than on what it happened to have released.
	for (let drain = 0; drain < 100; drain++) {
		let more = false
		guard('drain', () => {
			more = emitter.flush()
		})
		if (!more) break
	}

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

				if (equivalent(local, remote)) return []
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
