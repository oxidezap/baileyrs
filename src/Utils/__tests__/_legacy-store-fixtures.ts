/**
 * Shared fixtures for `wrap-legacy-store` unit tests. The 4 sister test
 * files (sender-key / session / lid-mapping / coverage) all need the same
 * in-memory keys store + wrapped-store factory + byte-pattern generator.
 */

import { proto as bridgeProto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { AuthenticationState, SignalKeyStore, SignalKeyStoreWithTransaction } from '../../Types/index.ts'
import { initAuthCreds } from '../generics.ts'
import { wrapLegacyStore } from '../wrap-legacy-store.ts'

/** Heterogeneous values held by the in-memory keys store. The bridge writes
 *  raw `Buffer`s for Signal records, plain JS objects for sessions, and
 *  strings for lid_mapping — `unknown` keeps each test honest about which. */
export type MemKeysValue = Buffer | string | object | null

/** In-memory keys store mirroring upstream `useMultiFileAuthState`'s
 *  `keys.get(type, ids[])` / `keys.set({ [type]: { [id]: value } })`. */
export function makeMemKeys() {
	const data: Record<string, Record<string, MemKeysValue>> = {}
	return {
		raw: data,
		async get(type: string, ids: string[]): Promise<Record<string, MemKeysValue>> {
			const bucket = data[type] ?? {}
			const out: Record<string, MemKeysValue> = {}
			for (const id of ids) out[id] = bucket[id] ?? null
			return out
		},
		async set(updates: Record<string, Record<string, MemKeysValue>>): Promise<void> {
			for (const [type, bucket] of Object.entries(updates)) {
				data[type] ??= {}
				for (const [id, val] of Object.entries(bucket)) {
					if (val === null || val === undefined) delete data[type]![id]
					else data[type]![id] = val
				}
			}
		}
	}
}

/** Build a wrap-legacy-store wired to a fresh in-memory keys backend.
 *  The double-cast through `unknown` is intentional: the test's keys
 *  callback is heterogeneous (`MemKeysValue`) by design, but
 *  `AuthenticationState['keys']` is the strongly-typed `SignalKeyStore`
 *  union — they overlap structurally without sharing a parameterised type. */
export async function makeWrapped() {
	const creds = initAuthCreds()
	const keys = makeMemKeys()
	const state: AuthenticationState = {
		creds,
		keys: keys as unknown as SignalKeyStore | SignalKeyStoreWithTransaction
	}
	const wrapped = await wrapLegacyStore(state, async () => {})
	return { wrapped, keys, creds }
}

/** Deterministic byte-pattern generator. Distinct `(n, base)` pairs yield
 *  distinct buffers, so we can pinpoint which field round-tripped wrong. */
export const fill = (n: number, base: number) => {
	const value = new Uint8Array(n).map((_, index) => (index * base + base) & 0xff)
	if (n === 33) value[0] = 0x05
	return value
}

// ── Common LID/PN sample pairs ──
export const SAMPLE_GROUP = '120363012345678900@g.us'

// LID sender, no JID device (matches the mock server's default).
export const BRIDGE_SK_KEY_LID = `${SAMPLE_GROUP}:100000037037034@lid.0`
export const UPSTREAM_SK_KEY_LID = `${SAMPLE_GROUP}::100000037037034_1::0`

// PN sender on s.whatsapp.net with a JID device → exercises `user:device@server`.
export const BRIDGE_SK_KEY_PN_DEV = `${SAMPLE_GROUP}:559980000003:5@s.whatsapp.net.0`
export const UPSTREAM_SK_KEY_PN_DEV = `${SAMPLE_GROUP}::559980000003::5`

// Session keys (pairwise, no group prefix).
export const BRIDGE_SESSION_KEY_LID = '100000037037034@lid.0'
export const UPSTREAM_SESSION_KEY_LID = '100000037037034_1.0'
export const BRIDGE_SESSION_KEY_PN = '559980000003@s.whatsapp.net.0'
export const UPSTREAM_SESSION_KEY_PN = '559980000003.0'
export const BRIDGE_SESSION_KEY_PN_DEV = '559980000003:5@s.whatsapp.net.0'
export const UPSTREAM_SESSION_KEY_PN_DEV = '559980000003.5'

// ── Builders for realistic proto payloads ──

export interface BuildSenderKeyOpts {
	keyId?: number
	iteration?: number
	chainSeed?: Uint8Array
	signingPublic?: Uint8Array
	signingPrivate?: Uint8Array
}

/** Encode a `SenderKeyRecordStructure` with one populated state. */
export function buildBridgeSenderKeyBytes(opts: BuildSenderKeyOpts = {}): Uint8Array {
	const {
		keyId = 1,
		iteration = 0,
		chainSeed = fill(32, 1),
		signingPublic = fill(33, 2),
		signingPrivate = fill(32, 3)
	} = opts
	return bridgeProto.SenderKeyRecordStructure.encode(
		bridgeProto.SenderKeyRecordStructure.create({
			senderKeyStates: [
				{
					senderKeyId: keyId,
					senderChainKey: { iteration, seed: chainSeed },
					senderSigningKey: { public: signingPublic, private: signingPrivate },
					senderMessageKeys: []
				}
			]
		})
	).finish()
}

export interface BuildSessionOpts {
	rootKey?: Uint8Array
	rootSeed?: number
	previousCounter?: number
	senderRatchetPub?: Uint8Array
	senderRatchetPriv?: Uint8Array
	senderChainKey?: Uint8Array
	senderChainIndex?: number
	receiverRatchetPub?: Uint8Array
	receiverChainKey?: Uint8Array
	receiverChainIndex?: number
	aliceBaseKey?: Uint8Array
	remoteIdentity?: Uint8Array
	remoteRegistrationId?: number
	localRegistrationId?: number
}

/** Encode a `RecordStructure` with a single established `currentSession`
 *  (sender chain + one receiver chain). */
export function buildBridgeSessionBytes(opts: BuildSessionOpts = {}): Uint8Array {
	const {
		rootKey = fill(32, opts.rootSeed ?? 1),
		previousCounter = 0,
		senderRatchetPub = fill(33, 2),
		senderRatchetPriv = fill(32, 3),
		senderChainKey = fill(32, 4),
		senderChainIndex = 0,
		receiverRatchetPub = fill(33, 5),
		receiverChainKey = fill(32, 6),
		receiverChainIndex = 1,
		aliceBaseKey = fill(33, 7),
		remoteIdentity = fill(33, 8),
		remoteRegistrationId = 1234,
		localRegistrationId = 5678
	} = opts
	return bridgeProto.RecordStructure.encode(
		bridgeProto.RecordStructure.create({
			currentSession: bridgeProto.SessionStructure.create({
				sessionVersion: 3,
				localIdentityPublic: fill(33, 9),
				remoteIdentityPublic: remoteIdentity,
				rootKey,
				previousCounter,
				senderChain: {
					senderRatchetKey: senderRatchetPub,
					senderRatchetKeyPrivate: senderRatchetPriv,
					chainKey: { index: senderChainIndex, key: senderChainKey },
					messageKeys: []
				},
				receiverChains: [
					{
						senderRatchetKey: receiverRatchetPub,
						// The core's canonical persisted representation writes the
						// receiver-only private-key field as a present, empty byte slice.
						// Keep that exact wire sentinel in the shared fixture so every
						// session projection test exercises the real storage shape.
						senderRatchetKeyPrivate: new Uint8Array(),
						chainKey: { index: receiverChainIndex, key: receiverChainKey },
						messageKeys: []
					}
				],
				remoteRegistrationId,
				localRegistrationId,
				aliceBaseKey
			}),
			previousSessions: []
		})
	).finish()
}
