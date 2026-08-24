/**
 * The native mirror has to survive the host's own serialization.
 *
 * `bridge-native-*` holds the core's exact bytes and is gated on a fingerprint
 * of the legacy projection beside it: taken from the live object when the
 * mirror is written, and from whatever the store hands back when it is read.
 * Every persisted store round-trips its values through JSON, so any difference
 * JSON erases makes those two disagree permanently — the mirror is rejected on
 * every read and the record rebuilt from a projection that cannot express the
 * core's local record fields.
 *
 * Reading back in process hides all of this, which is why every case here goes
 * through a store that serializes exactly like `useLegacyMultiFileAuthState`.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import { proto as bridgeProto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import { expect } from '../../__tests__/expect.ts'
import { decodeNativeEnvelope, envelopeMatchesLegacy } from '../../Compatibility/legacy-store/common.ts'
import type { AuthenticationState, SignalKeyStore } from '../../Types/index.ts'
import { BufferJSON, initAuthCreds } from '../generics.ts'
import { wrapLegacyStore } from '../wrap-legacy-store.ts'
import { BRIDGE_SESSION_KEY_LID, fill } from './_legacy-store-fixtures.ts'

/**
 * Models `useLegacyMultiFileAuthState`: every value crosses `BufferJSON` in
 * both directions, and `app-state-sync-key` is re-hydrated on read the way
 * that store does it. `disk` stays enumerable so a test can name the buckets.
 */
function jsonBackedStore() {
	const disk: Record<string, Record<string, string>> = {}
	// What the adapter handed to `keys.set`, before serialization. A host with
	// an in-memory store sees exactly this object, so it is the shape upstream
	// compatibility is judged on — and the only place an undefined-valued key
	// is still visible.
	const live: Record<string, Record<string, unknown>> = {}
	return {
		disk,
		live,
		async get(type: string, ids: string[]) {
			const bucket = disk[type] ?? {}
			return Object.fromEntries(
				ids.map(id => {
					const raw = bucket[id]
					if (raw === undefined) return [id, null]
					const value: unknown = JSON.parse(raw, BufferJSON.reviver)
					return [id, value]
				})
			)
		},
		async set(updates: Record<string, Record<string, unknown>>) {
			for (const [type, bucket] of Object.entries(updates)) {
				disk[type] ??= {}
				live[type] ??= {}
				for (const [id, value] of Object.entries(bucket ?? {})) {
					if (value == null) {
						delete disk[type]![id]
						delete live[type]![id]
					} else {
						live[type]![id] = value
						disk[type]![id] = JSON.stringify(value, BufferJSON.replacer)
					}
				}
			}
		}
	}
}

async function wrapJsonBacked() {
	const backing = jsonBackedStore()
	const state = {
		creds: initAuthCreds(),
		keys: backing as unknown as SignalKeyStore
	} as AuthenticationState
	return { backing, wrapped: await wrapLegacyStore(state, async () => {}) }
}

type Backing = Awaited<ReturnType<typeof wrapJsonBacked>>['backing']

/** The one mirror row and the one projection row, read the way the adapter reads them. */
async function mirrorAccepted(backing: Backing): Promise<boolean> {
	const nativeType = Object.keys(backing.disk).find(type => type.startsWith('bridge-native-'))
	const legacyType = Object.keys(backing.disk).find(type => !type.startsWith('bridge-'))
	if (!nativeType || !legacyType) throw new Error('expected both a mirror and a projection')
	const nativeId = Object.keys(backing.disk[nativeType]!)[0]!
	const legacyId = Object.keys(backing.disk[legacyType]!)[0]!
	const [nativeBucket, legacyBucket] = await Promise.all([
		backing.get(nativeType, [nativeId]),
		backing.get(legacyType, [legacyId])
	])
	const envelope = decodeNativeEnvelope(nativeBucket[nativeId])
	if (!envelope) throw new Error('expected a decodable mirror envelope')
	return envelopeMatchesLegacy(envelope, legacyBucket[legacyId])
}

async function projectionEntry(backing: Backing): Promise<Record<string, unknown>> {
	const legacyType = Object.keys(backing.disk).find(type => !type.startsWith('bridge-'))!
	const legacyId = Object.keys(backing.disk[legacyType]!)[0]!
	const bucket = await backing.get(legacyType, [legacyId])
	return bucket[legacyId] as Record<string, unknown>
}

/**
 * The projection as the adapter emitted it. Reading it back out of the store
 * would not do: JSON has already dropped every undefined-valued key by then,
 * which is exactly the difference these assertions exist to see.
 */
function liveProjectionEntry(backing: Backing): Record<string, unknown> {
	const legacyType = Object.keys(backing.live).find(type => !type.startsWith('bridge-'))!
	const legacyId = Object.keys(backing.live[legacyType]!)[0]!
	return backing.live[legacyType]![legacyId] as Record<string, unknown>
}

// ── Session records ─────────────────────────────────────────────────────

/**
 * whatsapp-rust writes two fields the WAProto schema has no room for:
 * 100, the sender-chain counter lease, and 101, the store incarnation that
 * says whether a reload is exact. Only the exact mirror can carry them.
 */
const counterLease = (reservation: number) =>
	Buffer.from([0xa0, 0x06, reservation, 0xaa, 0x06, 0x10, ...Array(16).fill(0x5a)])

type SessionShape = {
	senderChainIndex?: number
	reservation?: number
	receiverChainKey?: boolean
	pendingPreKey?: { signedPreKeyId: number; baseKey: Uint8Array; preKeyId?: number }
}

function buildSessionRecord(shape: SessionShape = {}): Uint8Array {
	const { senderChainIndex = 0, reservation, receiverChainKey = true, pendingPreKey } = shape
	const body = bridgeProto.RecordStructure.encode(
		bridgeProto.RecordStructure.create({
			currentSession: bridgeProto.SessionStructure.create({
				sessionVersion: 3,
				localIdentityPublic: fill(33, 9),
				remoteIdentityPublic: fill(33, 8),
				rootKey: fill(32, 1),
				previousCounter: 0,
				senderChain: {
					senderRatchetKey: fill(33, 2),
					senderRatchetKeyPrivate: fill(32, 3),
					chainKey: { index: senderChainIndex, key: fill(32, 4) }
				},
				receiverChains: [
					{
						senderRatchetKey: fill(33, 5),
						chainKey: receiverChainKey ? { index: 1, key: fill(32, 6) } : { index: 1 }
					}
				],
				aliceBaseKey: fill(33, 7),
				remoteRegistrationId: 1234,
				localRegistrationId: 5678,
				...(pendingPreKey ? { pendingPreKey } : {})
			})
		})
	).finish()
	return new Uint8Array(
		reservation === undefined ? body : Buffer.concat([Buffer.from(body), counterLease(reservation)])
	)
}

const senderChainIndexOf = (record: Uint8Array) =>
	bridgeProto.RecordStructure.decode(record).currentSession?.senderChain?.chainKey?.index ?? 0

describe('legacy-store mirror: survives the host serialization', () => {
	test('a session read back through a JSON store is the exact bytes that were written', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		const original = buildSessionRecord({ senderChainIndex: 7, reservation: 71 })

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, original)
		expect(await mirrorAccepted(backing)).toBe(true)

		const read = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		expect(Buffer.from(read).equals(Buffer.from(original))).toBe(true)
	})

	test("the core's local record fields (100, 101) reach the reader", async () => {
		const { wrapped } = await wrapJsonBacked()
		const lease = counterLease(71)
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, buildSessionRecord({ reservation: 71 }))

		const read = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		expect(Buffer.from(read).includes(lease)).toBe(true)
	})

	/**
	 * `chainKey.key` is emitted as `undefined` by upstream too
	 * (`key: c.chainKey.key && ...`), so the projection cannot stop producing
	 * it without diverging. Only `canonicalize` agreeing with JSON covers it —
	 * this is the case the projection-side change alone does not reach.
	 */
	test('a chain with no chainKey.key does not invalidate the mirror', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		const original = buildSessionRecord({ receiverChainKey: false, reservation: 71 })

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, original)
		const entry = (await projectionEntry(backing))._sessions as Record<
			string,
			{ _chains: Record<string, { chainKey: object }> }
		>
		const chains = Object.values(Object.values(entry)[0]!._chains)
		expect(chains.some(chain => !Object.hasOwn(chain.chainKey, 'key'))).toBe(true)

		expect(await mirrorAccepted(backing)).toBe(true)
		const read = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		expect(Buffer.from(read).equals(Buffer.from(original))).toBe(true)
	})

	test('a pending pre-key without a preKeyId does not invalidate the mirror', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		const original = buildSessionRecord({
			reservation: 71,
			pendingPreKey: { signedPreKeyId: 9, baseKey: fill(33, 7) }
		})

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, original)
		expect(await mirrorAccepted(backing)).toBe(true)
		const read = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		expect(Buffer.from(read).equals(Buffer.from(original))).toBe(true)
	})

	test('a tc_token with no senderTimestamp does not invalidate the mirror', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		const original = new TextEncoder().encode(
			JSON.stringify({ token: Array.from(fill(16, 17)), token_timestamp: 5, sender_timestamp: null })
		)

		await wrapped.set('tc_token', '5511999999999@s.whatsapp.net', original)
		expect(await mirrorAccepted(backing)).toBe(true)
	})
})

// ── What the rejection actually costs ───────────────────────────────────

describe('legacy-store mirror: the counter lease is not burned', () => {
	/**
	 * Field 100 is an exclusive upper bound on counters that may already have
	 * been published. A projection carries no such field, so `toLegacy` loads
	 * the record as a new incarnation and fast-forwards the sender chain to the
	 * ceiling — the conservative recovery, and correct in isolation. It is only
	 * correct to *serve* that rebuilt record when the mirror is genuinely gone:
	 * doing it on every read burns a whole reservation batch per message, which
	 * widens the gap a receiver has to jump and defeats the batching that makes
	 * one durable flush cover many sends.
	 */
	test('a message costs one counter, not a whole reservation batch', async () => {
		const { wrapped } = await wrapJsonBacked()
		const BATCH = 64
		const MESSAGES = 10

		let chainIndex = 0
		for (let message = 0; message < MESSAGES; message++) {
			// The core advances one counter and keeps its lease a batch ahead.
			chainIndex += 1
			await wrapped.set(
				'session',
				BRIDGE_SESSION_KEY_LID,
				buildSessionRecord({ senderChainIndex: chainIndex, reservation: chainIndex + BATCH })
			)
			const read = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
			chainIndex = senderChainIndexOf(read)
		}

		expect(chainIndex).toBe(MESSAGES)
	})

	test('a reader with no mirror still recovers conservatively', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, buildSessionRecord({ senderChainIndex: 5, reservation: 32 }))

		// Drop the mirror: the projection is all that is left, and it must not
		// hand back counters the lease had already covered.
		const nativeType = Object.keys(backing.disk).find(type => type.startsWith('bridge-native-'))!
		delete backing.disk[nativeType]

		const read = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		expect(senderChainIndexOf(read)).toBe(32)
	})
})

// ── The projection shape upstream produces ──────────────────────────────

describe('legacy-store projection: matches the shape upstream writes', () => {
	test('a session with no pending pre-key has no pendingPreKey key at all', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, buildSessionRecord())

		const sessions = liveProjectionEntry(backing)._sessions as Record<string, object>
		const entry = Object.values(sessions)[0]!
		expect(Object.hasOwn(entry, 'pendingPreKey')).toBe(false)
	})

	test('a pending pre-key without a preKeyId has no preKeyId key at all', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_LID,
			buildSessionRecord({ pendingPreKey: { signedPreKeyId: 9, baseKey: fill(33, 7) } })
		)

		const sessions = liveProjectionEntry(backing)._sessions as Record<string, { pendingPreKey: object }>
		const { pendingPreKey } = Object.values(sessions)[0]!
		expect(Object.hasOwn(pendingPreKey, 'signedKeyId')).toBe(true)
		expect(Object.hasOwn(pendingPreKey, 'preKeyId')).toBe(false)
	})

	test('a pending pre-key with a preKeyId still carries it', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_LID,
			buildSessionRecord({ pendingPreKey: { signedPreKeyId: 9, baseKey: fill(33, 7), preKeyId: 7 } })
		)

		const sessions = (await projectionEntry(backing))._sessions as Record<
			string,
			{ pendingPreKey: { preKeyId: number } }
		>
		expect(Object.values(sessions)[0]!.pendingPreKey.preKeyId).toBe(7)
	})

	test('a tc_token with no sender timestamp has no senderTimestamp key at all', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		await wrapped.set(
			'tc_token',
			'5511999999999@s.whatsapp.net',
			new TextEncoder().encode(
				JSON.stringify({ token: Array.from(fill(16, 17)), token_timestamp: 5, sender_timestamp: null })
			)
		)

		const token = liveProjectionEntry(backing)
		expect(Object.hasOwn(token, 'timestamp')).toBe(true)
		expect(Object.hasOwn(token, 'senderTimestamp')).toBe(false)
	})

	test('a tc_token with a sender timestamp still carries it', async () => {
		const { wrapped, backing } = await wrapJsonBacked()
		await wrapped.set(
			'tc_token',
			'5511999999999@s.whatsapp.net',
			new TextEncoder().encode(
				JSON.stringify({ token: Array.from(fill(16, 17)), token_timestamp: 5, sender_timestamp: 9 })
			)
		)

		expect(liveProjectionEntry(backing).senderTimestamp).toBe('9')
	})
})
