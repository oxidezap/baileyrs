/**
 * Cross-impl gap for `session`:
 *   • Bridge: store `session`, key `{user}[:dev]@{server}.{sig}`,
 *     value = protobuf `RecordStructure` (current + previous_sessions).
 *   • Upstream: store `session`, key `{signalUser}.{deviceId}`,
 *     value = JS object `{ _sessions: { [base64BaseKey]: SessionEntry }, version: 'v1' }`.
 *
 * Without conversion, upstream's `loadSession` either misses the key or
 * throws inside `SessionRecord.deserialize`, falling back to a fresh
 * PreKey signal handshake on every cross-impl swap. These tests pin
 * direct, no-re-handshake compatibility.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- libsignal lacks .d.ts
import SessionRecord from 'libsignal/src/session_record.js'
import { proto as bridgeProto } from 'whatsapp-rust-bridge/proto-types'
import { expect } from '../../__tests__/expect.ts'
import {
	BRIDGE_SESSION_KEY_LID,
	BRIDGE_SESSION_KEY_PN,
	BRIDGE_SESSION_KEY_PN_DEV,
	UPSTREAM_SESSION_KEY_LID,
	UPSTREAM_SESSION_KEY_PN,
	UPSTREAM_SESSION_KEY_PN_DEV,
	buildBridgeSessionBytes,
	fill,
	makeWrapped
} from './_legacy-store-fixtures.ts'

describe('wrap-legacy-store: session key-name translation', () => {
	test('LID → upstream `_1.deviceId`', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, buildBridgeSessionBytes())
		expect(keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID]).toBeDefined()
		expect(keys.raw['session']?.[BRIDGE_SESSION_KEY_LID]).toBeUndefined()
	})

	test('PN no-device → bare `{user}.{signalDev}`', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('session', BRIDGE_SESSION_KEY_PN, buildBridgeSessionBytes())
		expect(keys.raw['session']?.[UPSTREAM_SESSION_KEY_PN]).toBeDefined()
	})

	test('PN with JID device → device suffix preserved', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('session', BRIDGE_SESSION_KEY_PN_DEV, buildBridgeSessionBytes())
		expect(keys.raw['session']?.[UPSTREAM_SESSION_KEY_PN_DEV]).toBeDefined()
	})
})

describe('wrap-legacy-store: session value-byte translation', () => {
	test('bridge proto bytes load via upstream `SessionRecord.deserialize` as OPEN', async () => {
		const { wrapped, keys } = await makeWrapped()
		const aliceBaseKey = Buffer.from(fill(33, 100))
		const rootKey = Buffer.from(fill(32, 11))
		const remoteIdentity = Buffer.from(fill(33, 17))
		const senderRatchetPub = Buffer.from(fill(33, 23))
		const senderRatchetPriv = Buffer.from(fill(32, 29))

		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_LID,
			buildBridgeSessionBytes({
				rootKey: new Uint8Array(rootKey),
				aliceBaseKey: new Uint8Array(aliceBaseKey),
				remoteIdentity: new Uint8Array(remoteIdentity),
				senderRatchetPub: new Uint8Array(senderRatchetPub),
				senderRatchetPriv: new Uint8Array(senderRatchetPriv),
				remoteRegistrationId: 99,
				previousCounter: 4
			})
		)

		const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID]
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rec = (SessionRecord as any).deserialize(stored)
		expect(rec.haveOpenSession()).toBe(true)
		const open = rec.getOpenSession()
		expect(open.registrationId).toBe(99)
		expect(open.currentRatchet.previousCounter).toBe(4)
		expect(Buffer.from(open.currentRatchet.rootKey).equals(rootKey)).toBe(true)
		expect(Buffer.from(open.currentRatchet.ephemeralKeyPair.pubKey).equals(senderRatchetPub)).toBe(true)
		expect(Buffer.from(open.currentRatchet.ephemeralKeyPair.privKey).equals(senderRatchetPriv)).toBe(true)
		expect(Buffer.from(open.indexInfo.baseKey).equals(aliceBaseKey)).toBe(true)
		expect(Buffer.from(open.indexInfo.remoteIdentityKey).equals(remoteIdentity)).toBe(true)
		expect(open.indexInfo.closed).toBe(-1)
		expect(Object.keys(open._chains).length).toBeGreaterThanOrEqual(1)
	})

	test('upstream JS object → bridge GET produces valid proto with same fields', async () => {
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.alloc(33, 0xa0)
		const rootKey = Buffer.alloc(32, 0xb0)
		const remoteIdent = Buffer.alloc(33, 0xc0)
		const ephPub = Buffer.alloc(33, 0xd0)
		const ephPriv = Buffer.alloc(32, 0xe0)
		const lastRemoteEph = Buffer.alloc(33, 0xf0)

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 4242,
						currentRatchet: {
							ephemeralKeyPair: { pubKey: ephPub.toString('base64'), privKey: ephPriv.toString('base64') },
							lastRemoteEphemeralKey: lastRemoteEph.toString('base64'),
							previousCounter: 7,
							rootKey: rootKey.toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: 1,
							closed: -1,
							used: Date.now(),
							created: Date.now(),
							remoteIdentityKey: remoteIdent.toString('base64')
						},
						_chains: {}
					}
				},
				version: 'v1'
			}
		}

		const protoOut = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoOut)
		const cs = decoded.currentSession!
		expect(cs.remoteRegistrationId).toBe(4242)
		expect(cs.previousCounter).toBe(7)
		expect(Buffer.from(cs.rootKey!).equals(rootKey)).toBe(true)
		expect(Buffer.from(cs.aliceBaseKey!).equals(baseKey)).toBe(true)
		expect(Buffer.from(cs.remoteIdentityPublic!).equals(remoteIdent)).toBe(true)
		expect(Buffer.from(cs.senderChain!.senderRatchetKey!).equals(ephPub)).toBe(true)
		expect(Buffer.from(cs.senderChain!.senderRatchetKeyPrivate!).equals(ephPriv)).toBe(true)
	})

	test('round-trip: bridge SET → upstream loadSession → still open + same identity', async () => {
		const { wrapped, keys } = await makeWrapped()
		const remoteIdentity = Buffer.alloc(33, 0x11)
		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_PN,
			buildBridgeSessionBytes({ remoteIdentity: new Uint8Array(remoteIdentity), remoteRegistrationId: 7 })
		)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rec = (SessionRecord as any).deserialize(keys.raw['session']?.[UPSTREAM_SESSION_KEY_PN])
		const open = rec.getOpenSession()
		expect(open.registrationId).toBe(7)
		expect(Buffer.from(open.indexInfo.remoteIdentityKey).equals(remoteIdentity)).toBe(true)
	})
})

describe('wrap-legacy-store: session edge cases', () => {
	test('lastRemoteEphemeralKey does NOT collide with senderRatchetKey when receiverChains empty', async () => {
		// Regression: the converter previously used senderRatchetKey as a
		// placeholder, which made upstream's `maybeStepRatchet` close the
		// SENDER chain on the next peer ratchet (corrupting outbound
		// encryption). Now uses aliceBaseKey (when bob) or empty buffer.
		const { wrapped, keys } = await makeWrapped()
		const senderRatchetPub = fill(33, 2)
		const aliceBaseKey = fill(33, 7)
		const protoBytes = bridgeProto.RecordStructure.encode(
			bridgeProto.RecordStructure.create({
				currentSession: bridgeProto.SessionStructure.create({
					sessionVersion: 3,
					rootKey: fill(32, 1),
					previousCounter: 0,
					senderChain: {
						senderRatchetKey: senderRatchetPub,
						senderRatchetKeyPrivate: fill(32, 3),
						chainKey: { index: 0, key: fill(32, 4) },
						messageKeys: []
					},
					receiverChains: [],
					remoteIdentityPublic: fill(33, 8),
					remoteRegistrationId: 99,
					localRegistrationId: 11,
					aliceBaseKey,
					pendingPreKey: { preKeyId: 42, signedPreKeyId: 7, baseKey: aliceBaseKey }
				}),
				previousSessions: []
			})
		).finish()

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, protoBytes)
		const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as {
			_sessions: Record<string, { currentRatchet: { lastRemoteEphemeralKey: string } }>
		}
		const entry = Object.values(stored._sessions)[0]!
		expect(entry.currentRatchet.lastRemoteEphemeralKey).not.toBe(Buffer.from(senderRatchetPub).toString('base64'))
	})

	test('baseKeyType: pendingPreKey present → OURS (alice), absent → THEIRS (bob)', async () => {
		// Regression: previously set OURS whenever aliceBaseKey existed
		// (always), making upstream `getSession(byBaseKey)` throw.
		const baseKeyTypeFor = async (withPendingPreKey: boolean): Promise<number> => {
			const { wrapped, keys } = await makeWrapped()
			const aliceBaseKey = fill(33, 7)
			const session = bridgeProto.SessionStructure.create({
				sessionVersion: 3,
				rootKey: fill(32, 1),
				previousCounter: 0,
				senderChain: {
					senderRatchetKey: fill(33, 2),
					senderRatchetKeyPrivate: fill(32, 3),
					chainKey: { index: 0, key: fill(32, 4) },
					messageKeys: []
				},
				receiverChains: withPendingPreKey
					? []
					: [
							{
								senderRatchetKey: fill(33, 5),
								chainKey: { index: 1, key: fill(32, 6) },
								messageKeys: []
							}
						],
				remoteIdentityPublic: fill(33, 8),
				remoteRegistrationId: 1,
				aliceBaseKey,
				...(withPendingPreKey ? { pendingPreKey: { preKeyId: 1, signedPreKeyId: 2, baseKey: aliceBaseKey } } : {})
			})
			await wrapped.set(
				'session',
				BRIDGE_SESSION_KEY_PN,
				bridgeProto.RecordStructure.encode(
					bridgeProto.RecordStructure.create({ currentSession: session, previousSessions: [] })
				).finish()
			)
			const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_PN] as {
				_sessions: Record<string, { indexInfo: { baseKeyType: number } }>
			}
			return Object.values(stored._sessions)[0]!.indexInfo.baseKeyType
		}

		expect(await baseKeyTypeFor(true)).toBe(1) // OURS
		expect(await baseKeyTypeFor(false)).toBe(2) // THEIRS
	})

	test('multi-session: currentSession + previousSessions[] all land in upstream `_sessions`', async () => {
		const { wrapped, keys } = await makeWrapped()
		const mkSession = (rootSeed: number, baseKeySeed: number) =>
			bridgeProto.SessionStructure.create({
				sessionVersion: 3,
				rootKey: fill(32, rootSeed),
				previousCounter: 0,
				senderChain: {
					senderRatchetKey: fill(33, rootSeed * 3),
					senderRatchetKeyPrivate: fill(32, rootSeed * 5),
					chainKey: { index: 0, key: fill(32, rootSeed * 7) },
					messageKeys: []
				},
				receiverChains: [
					{
						senderRatchetKey: fill(33, rootSeed * 11),
						chainKey: { index: 1, key: fill(32, rootSeed * 13) },
						messageKeys: []
					}
				],
				remoteIdentityPublic: fill(33, 8),
				remoteRegistrationId: 1,
				aliceBaseKey: fill(33, baseKeySeed)
			})

		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_LID,
			bridgeProto.RecordStructure.encode(
				bridgeProto.RecordStructure.create({
					currentSession: mkSession(1, 100),
					previousSessions: [mkSession(2, 200), mkSession(3, 250)]
				})
			).finish()
		)
		const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as {
			_sessions: Record<string, { indexInfo: { closed: number; baseKey: string } }>
			version: string
		}
		expect(stored.version).toBe('v1')
		expect(Object.keys(stored._sessions).length).toBe(3)

		const open = Object.values(stored._sessions).filter(e => e.indexInfo.closed === -1)
		expect(open.length).toBe(1)
		expect(open[0]!.indexInfo.baseKey).toBe(Buffer.from(fill(33, 100)).toString('base64'))

		// Front of Rust's previous_sessions = newest archived → must get
		// the LARGER `closed` timestamp so upstream's removeOldSessions
		// evicts the oldest first.
		const closedEntries = Object.values(stored._sessions).filter(e => e.indexInfo.closed > 0)
		const newer = closedEntries.find(e => e.indexInfo.baseKey === Buffer.from(fill(33, 200)).toString('base64'))!
		const older = closedEntries.find(e => e.indexInfo.baseKey === Buffer.from(fill(33, 250)).toString('base64'))!
		expect(newer.indexInfo.closed).toBeGreaterThan(older.indexInfo.closed)
	})

	test('pendingPreKey round-trips with field rename `signedPreKeyId↔signedKeyId`', async () => {
		const { wrapped, keys } = await makeWrapped()
		const aliceBaseKey = fill(33, 7)
		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_LID,
			bridgeProto.RecordStructure.encode(
				bridgeProto.RecordStructure.create({
					currentSession: bridgeProto.SessionStructure.create({
						sessionVersion: 3,
						rootKey: fill(32, 1),
						previousCounter: 0,
						senderChain: {
							senderRatchetKey: fill(33, 2),
							senderRatchetKeyPrivate: fill(32, 3),
							chainKey: { index: 0, key: fill(32, 4) },
							messageKeys: []
						},
						receiverChains: [],
						remoteIdentityPublic: fill(33, 8),
						remoteRegistrationId: 1,
						aliceBaseKey,
						pendingPreKey: { preKeyId: 314, signedPreKeyId: 271, baseKey: aliceBaseKey }
					}),
					previousSessions: []
				})
			).finish()
		)
		const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as {
			_sessions: Record<string, { pendingPreKey?: { preKeyId?: number; signedKeyId?: number; baseKey?: string } }>
		}
		const entry = Object.values(stored._sessions)[0]!
		expect(entry.pendingPreKey!.preKeyId).toBe(314)
		expect(entry.pendingPreKey!.signedKeyId).toBe(271) // rename: signedPreKeyId → signedKeyId
		expect(entry.pendingPreKey!.baseKey).toBe(Buffer.from(aliceBaseKey).toString('base64'))

		const protoOut = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoOut)
		expect(decoded.currentSession?.pendingPreKey?.preKeyId).toBe(314)
		expect(decoded.currentSession?.pendingPreKey?.signedPreKeyId).toBe(271)
	})

	test('aliceBaseKey preserved on JS→bridge regardless of baseKeyType (bob-side restoration)', async () => {
		// Regression: previously dropped aliceBaseKey when baseKeyType=THEIRS,
		// breaking Rust's `find_matching_previous_session_index` lookup on
		// subsequent PreKeySignal arrivals.
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.alloc(33, 0xa0)
		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 4242,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: Buffer.alloc(33, 0xd0).toString('base64'),
								privKey: Buffer.alloc(32, 0xe0).toString('base64')
							},
							lastRemoteEphemeralKey: Buffer.alloc(33, 0xf0).toString('base64'),
							previousCounter: 0,
							rootKey: Buffer.alloc(32, 0xb0).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: 2, // THEIRS — we're bob
							closed: -1,
							used: Date.now(),
							created: Date.now(),
							remoteIdentityKey: Buffer.alloc(33, 0xc0).toString('base64')
						},
						_chains: {}
					}
				},
				version: 'v1'
			}
		}
		const protoOut = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoOut)
		expect(Buffer.from(decoded.currentSession!.aliceBaseKey!).equals(baseKey)).toBe(true)
	})
})
