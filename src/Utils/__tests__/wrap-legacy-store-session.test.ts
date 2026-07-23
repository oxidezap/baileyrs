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
import { LegacySession, SignalKeyLength, TimeValue } from '../../Compatibility/legacy-store/constants.ts'

const legacyChain = (seed: number, chainType: number, counter = TimeValue.UNKNOWN_SECONDS) => ({
	chainKey: {
		counter,
		key: Buffer.alloc(SignalKeyLength.CURVE_PRIVATE, seed).toString('base64')
	},
	chainType,
	messageKeys: {}
})

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
		const rec = SessionRecord.deserialize(stored)
		expect(rec.haveOpenSession()).toBe(true)
		const open = rec.getOpenSession()!
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
		const baseKey = Buffer.from(fill(33, 0xa0))
		const rootKey = Buffer.alloc(32, 0xb0)
		const remoteIdent = Buffer.from(fill(33, 0xc0))
		const ephPub = Buffer.from(fill(33, 0xd0))
		const ephPriv = Buffer.alloc(32, 0xe0)
		const lastRemoteEph = Buffer.from(fill(33, 0xf0))

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
						_chains: {
							[ephPub.toString('base64')]: legacyChain(0x44, LegacySession.CHAIN_SENDING)
						}
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

	// Upstream's own converter applies Math.max(previousCounter, 0), so a
	// never-used sending chain persists -1; the core owns the floor to 0.
	test('never-used sending chain (previousCounter=-1) imports as canonical 0', async () => {
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.from(fill(33, 0x61))
		const ephPub = Buffer.from(fill(33, 0x62))

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 4242,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: ephPub.toString('base64'),
								privKey: Buffer.alloc(32, 0x63).toString('base64')
							},
							lastRemoteEphemeralKey: baseKey.toString('base64'),
							previousCounter: -1,
							rootKey: Buffer.alloc(32, 0x64).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: LegacySession.BASE_KEY_THEIRS,
							closed: LegacySession.OPEN,
							used: TimeValue.UNKNOWN_MILLISECONDS,
							created: TimeValue.UNKNOWN_MILLISECONDS,
							remoteIdentityKey: Buffer.from(fill(33, 0x65)).toString('base64')
						},
						_chains: {
							[ephPub.toString('base64')]: legacyChain(0x66, LegacySession.CHAIN_SENDING)
						}
					}
				},
				version: LegacySession.VERSION
			}
		}

		const protoOut = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoOut)
		expect(decoded.currentSession!.previousCounter).toBe(0)
	})

	test('previousCounter below -1 fails with the typed core range error', async () => {
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.from(fill(33, 0x71))
		const ephPub = Buffer.from(fill(33, 0x72))

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 42,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: ephPub.toString('base64'),
								privKey: Buffer.alloc(32, 0x73).toString('base64')
							},
							lastRemoteEphemeralKey: baseKey.toString('base64'),
							previousCounter: -2,
							rootKey: Buffer.alloc(32, 0x74).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: LegacySession.BASE_KEY_THEIRS,
							closed: LegacySession.OPEN,
							used: TimeValue.UNKNOWN_MILLISECONDS,
							created: TimeValue.UNKNOWN_MILLISECONDS,
							remoteIdentityKey: Buffer.from(fill(33, 0x75)).toString('base64')
						},
						_chains: {
							[ephPub.toString('base64')]: legacyChain(0x76, LegacySession.CHAIN_SENDING)
						}
					}
				},
				version: LegacySession.VERSION
			}
		}

		await expect(wrapped.get('session', BRIDGE_SESSION_KEY_LID)).rejects.toThrow(/legacy chain counter -2/)
	})

	test('rejects a legacy session whose current ratchet has no matching sender chain', async () => {
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.from(fill(33, 0x31))
		const senderRatchet = Buffer.from(fill(33, 0x32))
		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 42,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: senderRatchet.toString('base64'),
								privKey: Buffer.alloc(32, 0x33).toString('base64')
							},
							lastRemoteEphemeralKey: Buffer.from(fill(33, 0x34)).toString('base64'),
							previousCounter: 0,
							rootKey: Buffer.alloc(32, 0x35).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: LegacySession.BASE_KEY_THEIRS,
							closed: LegacySession.OPEN,
							used: TimeValue.UNKNOWN_MILLISECONDS,
							created: TimeValue.UNKNOWN_MILLISECONDS,
							remoteIdentityKey: Buffer.from(fill(33, 0x36)).toString('base64')
						},
						_chains: {}
					}
				},
				version: LegacySession.VERSION
			}
		}

		await expect(wrapped.get('session', BRIDGE_SESSION_KEY_LID)).rejects.toThrow(
			/legacy session 0 has no sending chain/
		)
	})

	test('round-trip: bridge SET → upstream loadSession → still open + same identity', async () => {
		const { wrapped, keys } = await makeWrapped()
		const remoteIdentity = Buffer.from(fill(33, 0x11))
		await wrapped.set(
			'session',
			BRIDGE_SESSION_KEY_PN,
			buildBridgeSessionBytes({ remoteIdentity: new Uint8Array(remoteIdentity), remoteRegistrationId: 7 })
		)
		const rec = SessionRecord.deserialize(keys.raw['session']?.[UPSTREAM_SESSION_KEY_PN])
		const open = rec.getOpenSession()!
		expect(open.registrationId).toBe(7)
		expect(Buffer.from(open.indexInfo.remoteIdentityKey).equals(remoteIdentity)).toBe(true)
	})
})

describe('wrap-legacy-store: session edge cases', () => {
	test('accepts the canonical empty private-key sentinel on receiver chains', async () => {
		const { wrapped, keys } = await makeWrapped()

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, buildBridgeSessionBytes())

		const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID]
		const record = SessionRecord.deserialize(stored)
		expect(record.haveOpenSession()).toBe(true)
	})

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
					localIdentityPublic: fill(33, 9),
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

	test('legacy import preserves receiver-chain chronology instead of sorting ratchet keys', async () => {
		// Rust libsignal appends receiver chains and evicts from the front.
		// Choose keys whose lexical order is the inverse of their insertion
		// order so this catches an accidental canonical sort in the codec.
		const { wrapped, keys } = await makeWrapped()
		const curveKey = (value: number): Buffer =>
			Buffer.concat([
				Buffer.from([SignalKeyLength.CURVE_PUBLIC_PREFIX]),
				Buffer.alloc(SignalKeyLength.CURVE_PRIVATE, value)
			])
		const senderRatchet = curveKey(0x10)
		const olderReceiver = curveKey(0x40)
		const activeReceiver = curveKey(0x20)
		const olderKey = olderReceiver.toString('base64')
		const activeKey = activeReceiver.toString('base64')
		expect(olderKey.localeCompare(activeKey)).toBeGreaterThan(0)

		const baseKey = curveKey(0x50)
		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 42,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: senderRatchet.toString('base64'),
								privKey: Buffer.alloc(SignalKeyLength.CURVE_PRIVATE, 0x60).toString('base64')
							},
							lastRemoteEphemeralKey: activeKey,
							previousCounter: TimeValue.UNKNOWN_SECONDS,
							rootKey: Buffer.alloc(SignalKeyLength.CURVE_PRIVATE, 0x70).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: LegacySession.BASE_KEY_THEIRS,
							closed: LegacySession.OPEN,
							used: TimeValue.UNKNOWN_MILLISECONDS,
							created: TimeValue.UNKNOWN_MILLISECONDS,
							remoteIdentityKey: curveKey(0x80).toString('base64')
						},
						_chains: {
							[senderRatchet.toString('base64')]: legacyChain(0x01, LegacySession.CHAIN_SENDING),
							[olderKey]: legacyChain(0x02, LegacySession.CHAIN_RECEIVING),
							[activeKey]: legacyChain(0x03, LegacySession.CHAIN_RECEIVING)
						}
					}
				},
				version: LegacySession.VERSION
			}
		}

		const protoOut = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoOut)
		const receiverOrder = (decoded.currentSession?.receiverChains ?? []).map(receiver =>
			Buffer.from(receiver.senderRatchetKey ?? []).toString('base64')
		)
		expect(receiverOrder).toEqual([olderKey, activeKey])
	})

	test('baseKeyType: pendingPreKey present → OURS (alice), absent → THEIRS (bob)', async () => {
		// Regression: previously set OURS whenever aliceBaseKey existed
		// (always), making upstream `getSession(byBaseKey)` throw.
		const baseKeyTypeFor = async (withPendingPreKey: boolean): Promise<number> => {
			const { wrapped, keys } = await makeWrapped()
			const aliceBaseKey = fill(33, 7)
			const session = bridgeProto.SessionStructure.create({
				sessionVersion: 3,
				localIdentityPublic: fill(33, 9),
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
				localRegistrationId: 2,
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
				localIdentityPublic: fill(33, 9),
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
				localRegistrationId: 2,
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
						localIdentityPublic: fill(33, 9),
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
						localRegistrationId: 2,
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
		const baseKey = Buffer.from(fill(33, 0xa0))
		const senderRatchet = Buffer.from(fill(33, 0xd0))
		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 4242,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: senderRatchet.toString('base64'),
								privKey: Buffer.alloc(32, 0xe0).toString('base64')
							},
							lastRemoteEphemeralKey: Buffer.from(fill(33, 0xf0)).toString('base64'),
							previousCounter: 0,
							rootKey: Buffer.alloc(32, 0xb0).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: 2, // THEIRS — we're bob
							closed: -1,
							used: Date.now(),
							created: Date.now(),
							remoteIdentityKey: Buffer.from(fill(33, 0xc0)).toString('base64')
						},
						_chains: {
							[senderRatchet.toString('base64')]: legacyChain(0x33, LegacySession.CHAIN_SENDING)
						}
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
