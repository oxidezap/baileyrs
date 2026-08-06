/**
 * Backward-compatibility of the group (sender-key) codec.
 *
 * The oracle here is the real upstream implementation: `SenderKeyRecord` from
 * the installed `baileys` package is the code that wrote every legacy row on
 * disk and the code a rollback would read them back with. Its contract is
 * explicit about ordering — `getSenderKeyState()` with no id returns the LAST
 * state, and `addSenderKeyState` pushes to the back and `shift()`s the FRONT
 * once the record holds more than five. So in the legacy shape the current
 * state is last and the oldest is first.
 *
 * A record whose states come back in the other order is not a decoding error
 * anywhere visible: it encrypts under a stale key and evicts the freshest one.
 */

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { SenderKeyRecord } from 'baileys/lib/Signal/Group/sender-key-record.js'
import { BufferJSON } from 'baileys/lib/Utils/generics.js'
import { decodeSenderKeyRecordComponents, generateKeyPair } from '@oxidezap/whatsapp-rust-bridge'
import { NativeStore } from '../../Compatibility/legacy-store/constants.ts'
import { createSignalCodecs } from '../../Compatibility/legacy-store/codecs/signal.ts'
import { expect } from '../../__tests__/expect.ts'

type LegacyState = {
	senderKeyId: number
	senderChainKey: { iteration: number; seed: Buffer }
	senderSigningKey: { public: Buffer; private?: Buffer }
	senderMessageKeys?: Array<{ iteration: number; seed: Buffer }> | null
}

type Fixture = { bob: { store: { 'sender-key': Record<string, { type: 'Buffer'; data: string }> } } }

const fixture = JSON.parse(
	readFileSync(new URL('../../__tests__/fixtures/legacy-session-rc9.json', import.meta.url), 'utf-8')
) as Fixture

const SENDER_KEY_ID = '120363000000000001@g.us::5511900000001::0'

const codecs = createSignalCodecs()
const senderKey = codecs[NativeStore.SENDER_KEY]

/** Exactly how upstream persists a record: JSON.stringify with BufferJSON. */
const writeLegacy = (states: readonly unknown[]): Buffer =>
	Buffer.from(JSON.stringify(states, BufferJSON.replacer), 'utf-8')

const readLegacy = (bytes: Uint8Array): LegacyState[] =>
	JSON.parse(Buffer.from(bytes).toString('utf-8'), BufferJSON.reviver) as LegacyState[]

const roundTrip = (legacyBytes: Uint8Array): Uint8Array =>
	senderKey.toLegacy(SENDER_KEY_ID, senderKey.fromLegacy(SENDER_KEY_ID, legacyBytes)!) as Uint8Array

/** The state upstream would encrypt under, read through upstream's own code. */
const currentKeyId = (legacyBytes: Uint8Array): number =>
	SenderKeyRecord.deserialize(Buffer.from(legacyBytes)).getSenderKeyState()!.getKeyId()

/** A record built the way upstream builds one: each rotation pushed to the back. */
const rotatedRecord = (keyIds: readonly number[]): Buffer => {
	const record = new SenderKeyRecord()
	for (const [index, keyId] of keyIds.entries()) {
		record.addSenderKeyState(keyId, index, Buffer.alloc(32, index + 1), generateKeyPair().pubKey)
	}
	return writeLegacy(record.serialize())
}

const rc9SenderKey = (): Buffer => Buffer.from(fixture.bob.store['sender-key'][SENDER_KEY_ID]!.data, 'base64')

describe('legacy sender key: rc.9 auth state', () => {
	test('imports the real rc.9 sender key', () => {
		expect(senderKey.fromLegacy(SENDER_KEY_ID, rc9SenderKey())!.length).toBeGreaterThan(0)
	})

	test('keeps every field of the rc.9 state across the round trip', () => {
		const [original] = readLegacy(rc9SenderKey())
		const [back] = readLegacy(roundTrip(rc9SenderKey()))

		expect(back!.senderKeyId).toBe(original!.senderKeyId)
		expect(back!.senderChainKey.iteration).toBe(original!.senderChainKey.iteration)
		expect(Buffer.from(back!.senderChainKey.seed).equals(Buffer.from(original!.senderChainKey.seed))).toBe(true)
		expect(Buffer.from(back!.senderSigningKey.public).equals(Buffer.from(original!.senderSigningKey.public))).toBe(true)
		expect(
			Buffer.from(back!.senderSigningKey.private ?? []).equals(Buffer.from(original!.senderSigningKey.private ?? []))
		).toBe(true)
	})

	test('leaves the rc.9 record readable by the upstream implementation', () => {
		const record = SenderKeyRecord.deserialize(Buffer.from(roundTrip(rc9SenderKey())))

		expect(record.isEmpty()).toBe(false)
		expect(record.getSenderKeyState()!.getKeyId()).toBe(currentKeyId(rc9SenderKey()))
	})
})

describe('legacy sender key: rotated records', () => {
	const KEY_IDS = [1001, 1002, 1003] as const

	test('the fixture matches the upstream ordering contract', () => {
		// Guards the premise of every test below: upstream's current state is the
		// last one written, not the first.
		expect(currentKeyId(rotatedRecord(KEY_IDS))).toBe(1003)
	})

	test('keeps the state order upstream wrote', () => {
		const legacy = rotatedRecord(KEY_IDS)

		expect(readLegacy(roundTrip(legacy)).map(state => state.senderKeyId)).toEqual([...KEY_IDS])
	})

	test('still encrypts under the newest state after the round trip', () => {
		const legacy = rotatedRecord(KEY_IDS)

		expect(currentKeyId(roundTrip(legacy))).toBe(currentKeyId(legacy))
	})

	test('imports the newest legacy state as the native current state', () => {
		// The core keeps the current state at the front of the record; upstream
		// keeps it at the back. Importing without flipping makes the bridge
		// encrypt group messages under a key the members already rotated away
		// from.
		const components = decodeSenderKeyRecordComponents(senderKey.fromLegacy(SENDER_KEY_ID, rotatedRecord(KEY_IDS))!)

		expect(components.states[0]!.keyId).toBe(1003)
	})

	test('survives a full five-state record', () => {
		const keyIds = [1, 2, 3, 4, 5]
		const legacy = rotatedRecord(keyIds)

		expect(readLegacy(roundTrip(legacy)).map(state => state.senderKeyId)).toEqual(keyIds)
	})
})

describe('legacy sender key: shapes upstream actually wrote', () => {
	const state = (extra: Record<string, unknown>): Record<string, unknown> => ({
		senderKeyId: 7,
		senderChainKey: { iteration: 3, seed: Buffer.alloc(32, 9) },
		senderSigningKey: { public: Buffer.from(generateKeyPair().pubKey), private: Buffer.alloc(32, 4) },
		...extra
	})

	// The JS libsignal omitted senderMessageKeys entirely when a state had none,
	// so a real upgraded auth state carries rows in all three shapes.
	for (const [label, extra] of [
		['present but empty', { senderMessageKeys: [] }],
		['omitted', {}],
		['null', { senderMessageKeys: null }]
	] as const) {
		test(`imports a state whose senderMessageKeys is ${label}`, () => {
			const bytes = senderKey.fromLegacy(SENDER_KEY_ID, writeLegacy([state(extra)]))

			expect(bytes!.length).toBeGreaterThan(0)
		})
	}

	test('keeps an empty private signing key rather than dropping the field', () => {
		// A sender key received from someone else has no private signing key, and
		// upstream still wrote the field as an empty Buffer. Omitting it makes the
		// row distinguishable from one upstream produced — and `getSigningKeyPrivate`
		// then reads a different shape than it wrote.
		const received = state({
			senderSigningKey: { public: Buffer.from(generateKeyPair().pubKey), private: Buffer.alloc(0) }
		})
		const [back] = readLegacy(roundTrip(writeLegacy([received])))

		expect(back!.senderSigningKey.private).toBeDefined()
		expect(Buffer.from(back!.senderSigningKey.private!).length).toBe(0)
	})

	test('preserves skipped message keys', () => {
		const messageKeys = [
			{ iteration: 1, seed: Buffer.alloc(32, 11) },
			{ iteration: 4, seed: Buffer.alloc(32, 12) }
		]
		const [back] = readLegacy(roundTrip(writeLegacy([state({ senderMessageKeys: messageKeys })])))

		expect(back!.senderMessageKeys!.map(key => key.iteration)).toEqual([1, 4])
		expect(Buffer.from(back!.senderMessageKeys![1]!.seed).equals(Buffer.alloc(32, 12))).toBe(true)
	})
})
