/**
 * Shared fixtures for `wrap-legacy-store` unit tests. The 4 sister test
 * files (sender-key / session / lid-mapping / coverage) all need the same
 * in-memory keys store + wrapped-store factory + byte-pattern generator.
 */

import { proto as bridgeProto } from 'whatsapp-rust-bridge/proto-types'
import { initAuthCreds } from '../generics.ts'
import { wrapLegacyStore } from '../wrap-legacy-store.ts'

/** In-memory keys store mirroring upstream `useMultiFileAuthState`'s
 *  `keys.get(type, ids[])` / `keys.set({ [type]: { [id]: value } })`. */
export function makeMemKeys() {
	const data: Record<string, Record<string, unknown>> = {}
	return {
		raw: data,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors upstream surface
		async get(type: string, ids: string[]): Promise<Record<string, any>> {
			const bucket = data[type] ?? {}
			const out: Record<string, unknown> = {}
			for (const id of ids) out[id] = bucket[id] ?? null
			return out
		},
		async set(updates: Record<string, Record<string, unknown>>): Promise<void> {
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

/** Build a wrap-legacy-store wired to a fresh in-memory keys backend. */
export async function makeWrapped() {
	const creds = initAuthCreds()
	const keys = makeMemKeys()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal AuthenticationState surface
	const wrapped = await wrapLegacyStore({ creds, keys: keys as any }, async () => {})
	return { wrapped, keys, creds }
}

/** Deterministic byte-pattern generator. Distinct `(n, base)` pairs yield
 *  distinct buffers, so we can pinpoint which field round-tripped wrong. */
export const fill = (n: number, base: number) => new Uint8Array(n).map((_, i) => (i * base + base) & 0xff)

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
