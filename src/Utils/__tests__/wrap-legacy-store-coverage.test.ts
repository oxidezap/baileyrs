/**
 * Cross-cutting `wrap-legacy-store` coverage:
 *   1. Hosted JID domains (`hosted` → `_2`, `hosted.lid` → `_3`).
 *   2. PreKey cross-impl (proto bytes ↔ {public, private}).
 *   3. Identity cross-impl (32 bytes ↔ 33 bytes with 0x05 prefix + key rewrite).
 *   4. Idempotent round-trip (write→read→write produces identical disk bytes).
 *   5. messageKeys cache JS→Rust HKDF derivation (Finding 2 partial fix).
 */

import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- libsignal lacks .d.ts
import SessionRecord from 'libsignal/src/session_record.js'
import { proto as bridgeProto } from 'whatsapp-rust-bridge/proto-types'
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

// ── 1. Hosted JID domains ───────────────────────────────────────────────

describe('wrap-legacy-store: hosted JID domain coverage', () => {
	test('hosted (domainType=2): sender_key key gets `_2` suffix', async () => {
		const { wrapped, keys } = await makeWrapped()
		const bridgeKey = `${SAMPLE_GROUP}:5599800000@hosted.0`
		const expected = `${SAMPLE_GROUP}::5599800000_2::0`
		await wrapped.set('sender_key', bridgeKey, buildBridgeSenderKeyBytes())
		expect(keys.raw['sender-key']?.[expected]).toBeDefined()
	})

	test('hosted.lid (domainType=3): sender_key key gets `_3` suffix', async () => {
		const { wrapped, keys } = await makeWrapped()
		const bridgeKey = `${SAMPLE_GROUP}:100000037037034@hosted.lid.0`
		const expected = `${SAMPLE_GROUP}::100000037037034_3::0`
		await wrapped.set('sender_key', bridgeKey, buildBridgeSenderKeyBytes())
		expect(keys.raw['sender-key']?.[expected]).toBeDefined()
	})

	test('hosted: session key uses JID device suffix (not signal device)', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('session', '5599800000:7@hosted.0', buildBridgeSessionBytes())
		expect(keys.raw['session']?.['5599800000_2.7']).toBeDefined()
	})

	test('hosted.lid: identity round-trips (32 → 33 bytes + key rewrite)', async () => {
		const { wrapped, keys } = await makeWrapped()
		const raw32 = fill(32, 0xab)
		await wrapped.set('identity', '100000037037034@hosted.lid.0', raw32)
		const stored = keys.raw['identity-key']?.['100000037037034_3.0'] as Buffer
		expect(stored.length).toBe(33)
		expect(stored[0]).toBe(0x05)
		expect(stored.subarray(1).equals(Buffer.from(raw32))).toBe(true)
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
		const original = buildBridgeSenderKeyBytes({ keyId: 17, iteration: 5 })
		const upstreamKey = `${SAMPLE_GROUP}::100000037037034_1::0`
		const bridgeKey = `${SAMPLE_GROUP}:100000037037034@lid.0`

		await wrapped.set('sender_key', bridgeKey, original)
		const first = keys.raw['sender-key']?.[upstreamKey] as Buffer

		const back = (await wrapped.get('sender_key', bridgeKey)) as Uint8Array
		await wrapped.set('sender_key', bridgeKey, back)
		const second = keys.raw['sender-key']?.[upstreamKey] as Buffer

		expect(Buffer.compare(first, second)).toBe(0)
	})

	test('session: SET → GET → SET preserves baseKey set + open-status + identity', async () => {
		const { wrapped, keys } = await makeWrapped()
		const aliceBaseKey = Buffer.from(fill(33, 0x70))
		const original = buildBridgeSessionBytes({ rootSeed: 11, aliceBaseKey: new Uint8Array(aliceBaseKey) })

		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, original)
		const stored1 = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as { _sessions: Record<string, unknown> }
		// eslint-disable-next-line unicorn/no-array-sort, eslint-plugin-unicorn/no-useless-spread
		const baseKeys1 = Object.keys(stored1._sessions).slice().sort()

		const back = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, back)
		const stored2 = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID] as { _sessions: Record<string, unknown> }
		// eslint-disable-next-line unicorn/no-array-sort
		const baseKeys2 = Object.keys(stored2._sessions).slice().sort()

		expect(baseKeys2).toEqual(baseKeys1)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rec = (SessionRecord as any).deserialize(stored2)
		expect(rec.haveOpenSession()).toBe(true)
		expect(Buffer.from(rec.getOpenSession().indexInfo.baseKey).equals(aliceBaseKey)).toBe(true)
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const stored = keys.raw['sender-key']?.[upstreamKey] as any
		const json = JSON.parse(Buffer.from(stored).toString('utf-8'))
		expect(json.length).toBe(3)
		expect(json[0].senderKeyId).toBe(100)
		expect(json[1].senderKeyId).toBe(200)
		expect(json[2].senderKeyId).toBe(300)

		// Read back via bridge GET — all 3 states preserved.
		const protoBack = (await wrapped.get('sender_key', bridgeKey)) as Uint8Array
		const decoded = bridgeProto.SenderKeyRecordStructure.decode(protoBack)
		expect(decoded.senderKeyStates!.length).toBe(3)
		// eslint-disable-next-line unicorn/no-array-sort
		const ids = decoded.senderKeyStates!.map(s => s.senderKeyId).slice().sort((a, b) => a! - b!)
		expect(ids).toEqual([100, 200, 300])
	})
})

// ── 6. Lid mapping edge cases ───────────────────────────────────────────

describe('wrap-legacy-store: lid_mapping edge cases', () => {
	test('unknown key prefix → warns + null on read, passthrough on write', async () => {
		const { wrapped, keys } = await makeWrapped()
		// Bridge would never write/read like this, but verify it doesn't crash.
		await wrapped.set('lid_mapping', 'weird:format', new TextEncoder().encode('value'))
		// On unknown prefix, fromBridge returns Buffer.from(value) as fallback.
		expect(keys.raw['lid-mapping']?.['weird:format']).toBeDefined()
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

// ── 8. messageKeys cache derivation (JS → Rust via HKDF) ────────────────

describe('wrap-legacy-store: messageKeys JS→Rust HKDF derivation', () => {
	// Reference impl matching upstream `libsignal/src/crypto.js:53` exactly.
	function jsLikeDeriveSecrets(seed: Buffer): { cipher: Buffer; mac: Buffer; iv: Buffer } {
		const salt = Buffer.alloc(32)
		const info = Buffer.from('WhisperMessageKeys')
		const prk = createHmac('sha256', salt).update(seed).digest()
		const t1 = createHmac('sha256', prk)
			.update(Buffer.concat([info, Buffer.from([0x01])]))
			.digest()
		const t2 = createHmac('sha256', prk)
			.update(Buffer.concat([t1, info, Buffer.from([0x02])]))
			.digest()
		const t3 = createHmac('sha256', prk)
			.update(Buffer.concat([t2, info, Buffer.from([0x03])]))
			.digest()
		return { cipher: t1, mac: t2, iv: t3.subarray(0, 16) }
	}

	test('upstream messageKeys cache → bridge proto carries derived cipher/mac/iv', async () => {
		const { wrapped, keys } = await makeWrapped()
		const baseKey = Buffer.alloc(33, 0xa0)
		const peerRatchet = Buffer.alloc(33, 0xc0)
		const skipSeed3 = Buffer.alloc(32, 0xd1)
		const skipSeed5 = Buffer.alloc(32, 0xd2)

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: {
				_sessions: {
					[baseKey.toString('base64')]: {
						registrationId: 1,
						currentRatchet: {
							ephemeralKeyPair: {
								pubKey: Buffer.alloc(33, 0xb0).toString('base64'),
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
							remoteIdentityKey: Buffer.alloc(33, 0x02).toString('base64')
						},
						_chains: {
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

		// Derived split MUST match HKDF reference exactly. If Rust libsignal
		// ever fails to decrypt skipped messages from the cache, this test
		// pinpoints which byte disagreed before any wire packet does.
		const expected3 = jsLikeDeriveSecrets(skipSeed3)
		const expected5 = jsLikeDeriveSecrets(skipSeed5)
		const byIndex = Object.fromEntries(mks.map(m => [m.index, m]))
		for (const [idx, expected] of [
			[3, expected3],
			[5, expected5]
		] as const) {
			expect(Buffer.from(byIndex[idx]!.cipherKey!).equals(expected.cipher)).toBe(true)
			expect(Buffer.from(byIndex[idx]!.macKey!).equals(expected.mac)).toBe(true)
			expect(Buffer.from(byIndex[idx]!.iv!).equals(expected.iv)).toBe(true)
		}
	})
})
