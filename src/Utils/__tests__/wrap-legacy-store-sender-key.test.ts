/**
 * Cross-impl gap for `sender_key`:
 *   • Bridge: store `sender_key`, key `{group}:{user}[:dev]@{server}.{sig}`,
 *     value = protobuf `SenderKeyRecordStructure`.
 *   • Upstream: store `sender-key`, key `{group}::{signalUser}::{deviceId}`,
 *     value = `Buffer(JSON.stringify(states, BufferJSON.replacer), 'utf-8')`.
 * Store name, key shape AND value encoding all differ.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import { SenderKeyRecord } from 'baileys/lib/Signal/Group/sender-key-record.js'
import { proto as bridgeProto } from 'whatsapp-rust-bridge/proto-types'
import { expect } from '../../__tests__/expect.ts'
import {
	BRIDGE_SK_KEY_LID,
	BRIDGE_SK_KEY_PN_DEV,
	UPSTREAM_SK_KEY_LID,
	UPSTREAM_SK_KEY_PN_DEV,
	buildBridgeSenderKeyBytes,
	fill,
	makeWrapped
} from './_legacy-store-fixtures.ts'

describe('wrap-legacy-store: sender_key key-name translation', () => {
	test('LID, no JID device → upstream `_1` suffix + double-colon separators', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('sender_key', BRIDGE_SK_KEY_LID, buildBridgeSenderKeyBytes())
		expect(keys.raw['sender-key']?.[UPSTREAM_SK_KEY_LID]).toBeDefined()
		// The bridge-shaped key MUST NOT leak — would mean we passthrough'd raw bytes.
		expect(keys.raw['sender-key']?.[BRIDGE_SK_KEY_LID]).toBeUndefined()
	})

	test('PN with device suffix → JID device becomes upstream deviceId', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('sender_key', BRIDGE_SK_KEY_PN_DEV, buildBridgeSenderKeyBytes())
		expect(keys.raw['sender-key']?.[UPSTREAM_SK_KEY_PN_DEV]).toBeDefined()
	})

	test('bridge GET reads back from the upstream-formatted key', async () => {
		const { wrapped, keys } = await makeWrapped()
		const upstreamBytes = Buffer.from(
			JSON.stringify(
				[
					{
						senderKeyId: 17,
						senderChainKey: { iteration: 3, seed: Buffer.from(fill(32, 7)) },
						senderSigningKey: { public: Buffer.from(fill(33, 11)), private: Buffer.from(fill(32, 13)) },
						senderMessageKeys: []
					}
				],
				(_k, v) => {
					if (Buffer.isBuffer(v) || v instanceof Uint8Array || (v as { type?: string })?.type === 'Buffer') {
						return { type: 'Buffer', data: Buffer.from((v as { data?: Uint8Array }).data ?? v).toString('base64') }
					}
					return v
				}
			),
			'utf-8'
		)
		keys.raw['sender-key'] = { [UPSTREAM_SK_KEY_LID]: upstreamBytes }

		const out = await wrapped.get('sender_key', BRIDGE_SK_KEY_LID)
		expect(out).not.toBe(null)
	})
})

describe('wrap-legacy-store: sender_key value-byte translation', () => {
	test('bridge proto bytes load via upstream `SenderKeyRecord.deserialize`', async () => {
		const { wrapped, keys } = await makeWrapped()
		const keyId = 42
		const iteration = 9
		const chainSeed = Buffer.from(fill(32, 7))
		const signPub = Buffer.from(fill(33, 11))
		const signPriv = Buffer.from(fill(32, 13))

		await wrapped.set(
			'sender_key',
			BRIDGE_SK_KEY_LID,
			buildBridgeSenderKeyBytes({
				keyId,
				iteration,
				chainSeed: new Uint8Array(chainSeed),
				signingPublic: new Uint8Array(signPub),
				signingPrivate: new Uint8Array(signPriv)
			})
		)

		const onDisk = keys.raw['sender-key']?.[UPSTREAM_SK_KEY_LID] as Buffer
		const rec = SenderKeyRecord.deserialize(onDisk)
		expect(rec.isEmpty()).toBe(false)
		const state = rec.getSenderKeyState()!
		expect(state.getKeyId()).toBe(keyId)
		expect(state.getSenderChainKey().getIteration()).toBe(iteration)
		expect(Buffer.from(state.getSenderChainKey().getSeed() as Buffer).equals(chainSeed)).toBe(true)
		expect(Buffer.from(state.getSigningKeyPublic() as Buffer).equals(signPub)).toBe(true)
		expect(Buffer.from(state.getSigningKeyPrivate() as Buffer).equals(signPriv)).toBe(true)
	})

	test('upstream JSON bytes round-trip to valid bridge proto', async () => {
		const { wrapped, keys } = await makeWrapped()
		const keyId = 99
		const iteration = 4
		const chainSeed = Buffer.alloc(32, 0xab)
		const signPub = Buffer.alloc(33, 0xcd)
		const signPriv = Buffer.alloc(32, 0xef)

		const upstreamBytes = Buffer.from(
			JSON.stringify(
				[
					{
						senderKeyId: keyId,
						senderChainKey: { iteration, seed: chainSeed },
						senderSigningKey: { public: signPub, private: signPriv },
						senderMessageKeys: []
					}
				],
				(_k, v) => {
					if (Buffer.isBuffer(v) || v instanceof Uint8Array || (v as { type?: string })?.type === 'Buffer') {
						return { type: 'Buffer', data: Buffer.from((v as { data?: Uint8Array }).data ?? v).toString('base64') }
					}
					return v
				}
			),
			'utf-8'
		)
		keys.raw['sender-key'] = { [UPSTREAM_SK_KEY_LID]: upstreamBytes }

		const bytesOut = (await wrapped.get('sender_key', BRIDGE_SK_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.SenderKeyRecordStructure.decode(bytesOut)
		expect(decoded.senderKeyStates!.length).toBe(1)
		const s = decoded.senderKeyStates![0]!
		expect(s.senderKeyId).toBe(keyId)
		expect(s.senderChainKey?.iteration).toBe(iteration)
		expect(Buffer.from(s.senderChainKey!.seed!).equals(chainSeed)).toBe(true)
		expect(Buffer.from(s.senderSigningKey!.public!).equals(signPub)).toBe(true)
		expect(Buffer.from(s.senderSigningKey!.private!).equals(signPriv)).toBe(true)
	})

	test('iteration bump survives bridge SET → upstream advance → bridge GET', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('sender_key', BRIDGE_SK_KEY_LID, buildBridgeSenderKeyBytes({ keyId: 5, iteration: 1 }))

		const onDisk = keys.raw['sender-key']?.[UPSTREAM_SK_KEY_LID] as Buffer
		const rec = SenderKeyRecord.deserialize(onDisk)
		const state = rec.getSenderKeyState()!
		const ck = state.getSenderChainKey()
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SenderChainKey is structurally typed
		const bumped: any = { getIteration: () => ck.getIteration() + 5, getSeed: () => ck.getSeed() }
		state.setSenderChainKey(bumped)
		const newJson = JSON.stringify(rec.serialize(), (_k, v) => {
			if (Buffer.isBuffer(v) || v instanceof Uint8Array || (v as { type?: string })?.type === 'Buffer') {
				return { type: 'Buffer', data: Buffer.from((v as { data?: Uint8Array }).data ?? v).toString('base64') }
			}
			return v
		})
		keys.raw['sender-key']![UPSTREAM_SK_KEY_LID] = Buffer.from(newJson, 'utf-8')

		const bytesOut = (await wrapped.get('sender_key', BRIDGE_SK_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.SenderKeyRecordStructure.decode(bytesOut)
		expect(decoded.senderKeyStates![0]!.senderChainKey?.iteration).toBe(6)
	})
})
