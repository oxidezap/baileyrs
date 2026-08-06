/**
 * Cross-cutting `wrap-legacy-store` coverage:
 *   1. Hosted JID domains (`hosted` → `_128`, `hosted.lid` → `_129`).
 *   2. PreKey cross-impl (proto bytes ↔ {public, private}).
 *   3. Identity cross-impl (32 bytes ↔ 33 bytes with 0x05 prefix + key rewrite).
 *   4. Idempotent round-trip (write→read→write produces identical disk bytes).
 *   5. Skipped-message seeds delegated to the core's canonical derivation.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import SessionRecord from 'libsignal/src/session_record.js'
import { proto as bridgeProto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import { expect } from '../../__tests__/expect.ts'
import {
	BRIDGE_SESSION_KEY_LID,
	SAMPLE_GROUP,
	UPSTREAM_SESSION_KEY_LID,
	buildBridgeSenderKeyBytes,
	buildBridgeSessionBytes,
	fill,
	makeWrapped
} from './_legacy-store-fixtures.ts'

// whatsapp-rust local record fields: 100=reservation(32),
// 101=store incarnation(16 bytes). They are intentionally absent from the
// public WAProto schema and must survive the legacy adapter opaquely.
const LOCAL_RECORD_FIELDS = Buffer.from([0xa0, 0x06, 0x20, 0xaa, 0x06, 0x10, ...Array(16).fill(0x5a)])
const withLocalRecordFields = (record: Uint8Array) => Buffer.concat([Buffer.from(record), LOCAL_RECORD_FIELDS])

// ── 1. Hosted JID domains ───────────────────────────────────────────────

describe('wrap-legacy-store: hosted JID domain coverage', () => {
	test('hosted (domainType=128): sender_key key gets `_128` suffix', async () => {
		const { wrapped, keys } = await makeWrapped()
		const bridgeKey = `${SAMPLE_GROUP}:5599800000@hosted.0`
		const expected = `${SAMPLE_GROUP}::5599800000_128::0`
		await wrapped.set('sender_key', bridgeKey, buildBridgeSenderKeyBytes())
		expect(keys.raw['sender-key']?.[expected]).toBeDefined()
	})

	test('hosted.lid (domainType=129): sender_key key gets `_129` suffix', async () => {
		const { wrapped, keys } = await makeWrapped()
		const bridgeKey = `${SAMPLE_GROUP}:100000037037034@hosted.lid.0`
		const expected = `${SAMPLE_GROUP}::100000037037034_129::0`
		await wrapped.set('sender_key', bridgeKey, buildBridgeSenderKeyBytes())
		expect(keys.raw['sender-key']?.[expected]).toBeDefined()
	})

	test('hosted: session key uses JID device suffix (not signal device)', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('session', '5599800000:7@hosted.0', buildBridgeSessionBytes())
		expect(keys.raw['session']?.['5599800000_128.7']).toBeDefined()
	})

	test('hosted.lid: identity round-trips (32 → 33 bytes + key rewrite)', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw32 = fill(32, 0xab)
		await wrapped.set('identity', '100000037037034@hosted.lid.0', raw32)
		const stored = keys.raw['identity-key']?.['100000037037034_129.0'] as Buffer
		expect(stored.length).toBe(33)
		expect(stored[0]).toBe(0x05)
		expect(stored.subarray(1).equals(Buffer.from(raw32))).toBe(true)
	})
})

describe('wrap-legacy-store: device JID normalization', () => {
	test('bridge AD-JID domain bytes never leak into persisted creds JIDs', async () => {
		const { wrapped, creds } = await makeWrapped()
		const device = new TextEncoder().encode(
			JSON.stringify({
				pn: { user: '559980000003', server: 's.whatsapp.net', device: 87, agent: 0, integrator: 0 },
				lid: { user: '100000037037034', server: 'lid', device: 87, agent: 1, integrator: 0 }
			})
		)

		await wrapped.set('device', 'device', device)

		expect(creds.me?.id).toBe('559980000003:87@s.whatsapp.net')
		expect(creds.me?.lid).toBe('100000037037034:87@lid')
	})

	test('legacy `_1@lid` creds load into bridge JSON with a canonical zero agent', async () => {
		const { wrapped, creds } = await makeWrapped()
		await wrapped.set(
			'device',
			'device',
			new TextEncoder().encode(
				JSON.stringify({
					noise_key: Array(64).fill(1),
					identity_key: Array(64).fill(2)
				})
			)
		)
		creds.me = {
			id: '559980000003:87@s.whatsapp.net',
			lid: '100000037037034_1:87@lid'
		}

		const encoded = await wrapped.get('device', 'device')
		expect(encoded).not.toBe(null)
		const device = JSON.parse(new TextDecoder().decode(encoded!)) as { lid: { agent: number } }

		expect(device.lid.agent).toBe(0)
	})
})

// ── 2. PreKey cross-impl ────────────────────────────────────────────────

describe('wrap-legacy-store: prekey cross-impl', () => {
	test('upstream {public, private} → bridge GET returns proto bytes', async () => {
		const { wrapped, keys } = await makeWrapped()
		const pub = Buffer.from(fill(33, 0x10))
		const priv = Buffer.from(fill(32, 0x20))
		keys.raw['pre-key'] = { '42': { public: pub, private: priv } }
		const out = (await wrapped.get('prekey', '42')) as Uint8Array
		// 33 + 32 + ~6 bytes proto overhead.
		expect(out.length).toBeGreaterThan(60)
	})

	test('bridge proto bytes → upstream {public, private} on disk', async () => {
		const { wrapped, keys } = await makeWrapped()
		const pub = Buffer.from(fill(33, 0x10))
		const priv = Buffer.from(fill(32, 0x20))
		keys.raw['pre-key'] = { '42': { public: pub, private: priv } }
		const protoBytes = (await wrapped.get('prekey', '42')) as Uint8Array
		keys.raw['pre-key'] = {}
		await wrapped.set('prekey', '42', protoBytes)
		const stored = keys.raw['pre-key']?.['42'] as { public: Buffer; private: Buffer }
		expect(Buffer.from(stored.public).equals(pub)).toBe(true)
		expect(Buffer.from(stored.private).equals(priv)).toBe(true)
	})
})

// ── 3. Identity cross-impl ──────────────────────────────────────────────

describe('wrap-legacy-store: identity cross-impl', () => {
	test('bridge SET 32-byte → upstream-side 33-byte under signalUser key', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw32 = fill(32, 0xc0)
		await wrapped.set('identity', '559980000003@s.whatsapp.net.0', raw32)
		const stored = keys.raw['identity-key']?.['559980000003.0'] as Buffer
		expect(stored.length).toBe(33)
		expect(stored[0]).toBe(0x05)
		expect(stored.subarray(1).equals(Buffer.from(raw32))).toBe(true)
		expect(keys.raw['identity-key']?.['559980000003@s.whatsapp.net.0']).toBeUndefined()
	})

	test('upstream 33-byte → bridge GET returns 32-byte (prefix stripped)', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw32 = fill(32, 0xd0)
		keys.raw['identity-key'] = { '559980000003.0': Buffer.concat([Buffer.from([0x05]), Buffer.from(raw32)]) }
		const out = (await wrapped.get('identity', '559980000003@s.whatsapp.net.0')) as Uint8Array
		expect(out.length).toBe(32)
		expect(Buffer.from(out).equals(Buffer.from(raw32))).toBe(true)
	})

	test('LID identity round-trip preserves byte-for-byte', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw32 = fill(32, 0xe0)
		await wrapped.set('identity', '100000037037034@lid.0', raw32)
		expect(keys.raw['identity-key']?.['100000037037034_1.0']).toBeDefined()
		const out = (await wrapped.get('identity', '100000037037034@lid.0')) as Uint8Array
		expect(Buffer.from(out).equals(Buffer.from(raw32))).toBe(true)
	})
})

// ── 4. Idempotent round-trip ────────────────────────────────────────────

describe('wrap-legacy-store: idempotent round-trip', () => {
	test('sender_key: SET → GET → SET produces identical disk bytes', async () => {
		const { wrapped, keys } = await makeWrapped()
		const original = withLocalRecordFields(buildBridgeSenderKeyBytes({ keyId: 17, iteration: 5 }))
		const upstreamKey = `${SAMPLE_GROUP}::100000037037034_1::0`
		const bridgeKey = `${SAMPLE_GROUP}:100000037037034@lid.0`

		await wrapped.set('sender_key', bridgeKey, original)
		const first = keys.raw['sender-key']?.[upstreamKey] as Buffer
		const projected = JSON.parse(first.toString('utf-8')) as Array<{
			senderChainKey: { iteration: number }
		}>
		expect(projected[0]!.senderChainKey.iteration).toBe(32)

		const back = (await wrapped.get('sender_key', bridgeKey)) as Uint8Array
		expect(Buffer.from(back).subarray(-LOCAL_RECORD_FIELDS.length).equals(LOCAL_RECORD_FIELDS)).toBe(true)
		await wrapped.set('sender_key', bridgeKey, back)
		const second = keys.raw['sender-key']?.[upstreamKey] as Buffer

		expect(Buffer.compare(first, second)).toBe(0)
	})

	test('session: SET → GET → SET preserves baseKey set + open-status + identity', async () => {
		const { wrapped, keys } = await makeWrapped()
		const aliceBaseKey = Buffer.from(fill(33, 0x70))
		const original = withLocalRecordFields(
			buildBridgeSessionBytes({ rootSeed: 11, aliceBaseKey: new Uint8Array(aliceBaseKey) })
		)

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, original)
		const stored1 = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as {
			_sessions: Record<string, { _chains: Record<string, { chainType: number; chainKey: { counter: number } }> }>
		}
		const baseKeys1 = Object.keys(stored1._sessions).toSorted()
		const open = Object.values(stored1._sessions)[0]!
		const sender = Object.values(open._chains).find(chain => chain.chainType === 1)
		expect(sender!.chainKey.counter).toBe(31)

		const back = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		expect(Buffer.from(back).subarray(-LOCAL_RECORD_FIELDS.length).equals(LOCAL_RECORD_FIELDS)).toBe(true)
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, back)
		const stored2 = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as { _sessions: Record<string, unknown> }
		const baseKeys2 = Object.keys(stored2._sessions).toSorted()

		expect(baseKeys2).toEqual(baseKeys1)
		const rec = SessionRecord.deserialize(stored2)
		expect(rec.haveOpenSession()).toBe(true)
		expect(Buffer.from(rec.getOpenSession()!.indexInfo.baseKey).equals(aliceBaseKey)).toBe(true)
	})

	test('identity: SET → GET → SET produces byte-identical upstream blob', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw32 = fill(32, 0x55)
		await wrapped.set('identity', '100000037037034@lid.0', raw32)
		const first = keys.raw['identity-key']?.['100000037037034_1.0'] as Buffer
		const back = (await wrapped.get('identity', '100000037037034@lid.0')) as Uint8Array
		await wrapped.set('identity', '100000037037034@lid.0', back)
		const second = keys.raw['identity-key']?.['100000037037034_1.0'] as Buffer
		expect(Buffer.compare(first, second)).toBe(0)
	})
})

// ── 5. Sender key multi-state ───────────────────────────────────────────

describe('wrap-legacy-store: sender_key multi-state record', () => {
	test('multiple senderKeyStates round-trip individually', async () => {
		const { wrapped, keys } = await makeWrapped()
		const states = [1, 2, 3].map(seed => ({
			senderKeyId: seed * 100,
			senderChainKey: { iteration: seed, seed: fill(32, seed * 7) },
			senderSigningKey: { public: fill(33, seed * 11), private: fill(32, seed * 13) },
			senderMessageKeys: []
		}))
		const protoBytes = bridgeProto.SenderKeyRecordStructure.encode(
			bridgeProto.SenderKeyRecordStructure.create({ senderKeyStates: states })
		).finish()

		const bridgeKey = `${SAMPLE_GROUP}:100000037037034@lid.0`
		const upstreamKey = `${SAMPLE_GROUP}::100000037037034_1::0`
		await wrapped.set('sender_key', bridgeKey, protoBytes)
		const stored = keys.raw['sender-key']?.[upstreamKey] as Buffer
		const json = JSON.parse(stored.toString('utf-8')) as Array<{ senderKeyId: number }>
		// The two shapes order their states in opposite directions: the native
		// record keeps the current state first, upstream reads the last entry as
		// current. Writing the states out in the order they arrived would make the
		// old implementation send under `100` — the state the bridge holds as the
		// oldest. See `senderKeyToLegacy`.
		expect(json.length).toBe(3)
		expect(json.map(state => state.senderKeyId)).toEqual([300, 200, 100])

		// Read back via bridge GET — all 3 states preserved, in the order the
		// bridge handed them over, so the reversal above is symmetric.
		const protoBack = (await wrapped.get('sender_key', bridgeKey)) as Uint8Array
		const decoded = bridgeProto.SenderKeyRecordStructure.decode(protoBack)
		expect(decoded.senderKeyStates!.map(state => state.senderKeyId)).toEqual([100, 200, 300])
	})
})

// ── 6. Lid mapping edge cases ───────────────────────────────────────────

describe('wrap-legacy-store: lid_mapping edge cases', () => {
	test('unknown key prefix is rejected without writing an ambiguous legacy key', async () => {
		const { wrapped, keys } = await makeWrapped()
		await expect(wrapped.set('lid_mapping', 'weird:format', new TextEncoder().encode('value'))).rejects.toThrow(
			/LID mapping/
		)
		expect(keys.raw['lid-mapping']).toBeUndefined()
	})

	test('empty value on read returns null', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.raw['lid-mapping'] = { '559980000003': '' }
		const out = await wrapped.get('lid_mapping', 'pn:559980000003')
		expect(out).toBe(null)
	})
})

// ── 7. Identity edge cases ──────────────────────────────────────────────

describe('wrap-legacy-store: identity edge cases', () => {
	test('legacy 33-byte input from bridge → stored as-is (no double-prefix)', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw33 = Buffer.concat([Buffer.from([0x05]), Buffer.from(fill(32, 0xab))])
		await wrapped.set('identity', '100000037037034@lid.0', raw33)
		const stored = keys.raw['identity-key']?.['100000037037034_1.0'] as Buffer
		// Should NOT double-prefix; pass through 33-byte input verbatim.
		expect(stored.length).toBe(33)
		expect(stored[0]).toBe(0x05)
		expect(Buffer.compare(stored, raw33)).toBe(0)
	})

	test('upstream 32-byte stored input → bridge GET returns 32 bytes (no strip)', async () => {
		const { wrapped, keys } = await makeWrapped()
		// Some legacy upstream paths might write 32-byte directly.
		const raw32 = fill(32, 0xab)
		keys.raw['identity-key'] = { '100000037037034_1.0': Buffer.from(raw32) }
		const out = (await wrapped.get('identity', '100000037037034@lid.0')) as Uint8Array
		expect(out.length).toBe(32)
		expect(Buffer.from(out).equals(Buffer.from(raw32))).toBe(true)
	})

	test('GET on missing identity returns null (no exception)', async () => {
		const { wrapped } = await makeWrapped()
		const out = await wrapped.get('identity', '999999999999@lid.0')
		expect(out).toBe(null)
	})
})

// ── 8. Core-owned skipped-message derivation ───────────────────────────

describe('wrap-legacy-store: core-owned skipped-message derivation', () => {
	test('upstream messageKeys cache → bridge proto carries derived cipher/mac/iv', async () => {
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.from(fill(33, 0xa0))
		const senderRatchet = Buffer.from(fill(33, 0xb0))
		const peerRatchet = Buffer.from(fill(33, 0xc0))
		const skipSeed3 = Buffer.alloc(32, 0xd1)
		const skipSeed5 = Buffer.alloc(32, 0xd2)

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 1,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: senderRatchet.toString('base64'),
								privKey: Buffer.alloc(32, 0xb1).toString('base64')
							},
							lastRemoteEphemeralKey: peerRatchet.toString('base64'),
							previousCounter: 0,
							rootKey: Buffer.alloc(32, 0x01).toString('base64')
						},
						indexInfo: {
							baseKey: baseKey.toString('base64'),
							baseKeyType: 2,
							closed: -1,
							used: Date.now(),
							created: Date.now(),
							remoteIdentityKey: Buffer.from(fill(33, 0x02)).toString('base64')
						},
						_chains: {
							[senderRatchet.toString('base64')]: {
								chainKey: { counter: 0, key: Buffer.alloc(32, 0xb2).toString('base64') },
								chainType: 1,
								messageKeys: {}
							},
							[peerRatchet.toString('base64')]: {
								chainKey: { counter: 5, key: Buffer.alloc(32, 0xc1).toString('base64') },
								chainType: 2,
								messageKeys: { '3': skipSeed3.toString('base64'), '5': skipSeed5.toString('base64') }
							}
						}
					}
				},
				version: 'v1'
			}
		}

		const protoOut = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoOut)
		const recv = decoded.currentSession?.receiverChains?.[0]
		const mks = recv!.messageKeys ?? []
		expect(mks.length).toBe(2)

		// Fixed vectors keep the test independent without duplicating the
		// derivation algorithm in this package.
		const expected = {
			3: {
				cipher: '0486a5424aa9f1827b06f6e0a9b4e89556812974395d7b4ada46163a74d66cc3',
				mac: '21b9410a1c534cd9a8915ac18b40e522605360fc089eeeadaa8d50db605092e9',
				iv: 'effbd4ca570762d5a015327999ff77a2'
			},
			5: {
				cipher: '67cc072ba07fff4a99523e38324d5e1b97bdb5bd8c8cc7bfb627d44ab83c7179',
				mac: 'c19028710da3ea81abd6ecd1ec0cf6fbf3c80e0c5ab0654d1bee7307a5b00b81',
				iv: 'd0d01c002af2b5db9e7d549293d0623a'
			}
		} as const
		const byIndex = Object.fromEntries(mks.map(m => [m.index, m]))
		for (const index of [3, 5] as const) {
			expect(Buffer.from(byIndex[index]!.cipherKey!).toString('hex')).toBe(expected[index].cipher)
			expect(Buffer.from(byIndex[index]!.macKey!).toString('hex')).toBe(expected[index].mac)
			expect(Buffer.from(byIndex[index]!.iv!).toString('hex')).toBe(expected[index].iv)
		}
	})
})
