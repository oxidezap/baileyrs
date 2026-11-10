/**
 * Backward-compatibility of the pairwise (DM) session codec.
 *
 * `legacy-session-rc9.json` was produced by baileys@7.0.0-rc.9 — the last JS
 * libsignal release, with no Rust anywhere in the pipeline. The session in it
 * is a real DM that ratcheted twice, so it carries a sending chain, two
 * receiving chains, and a chain whose key the old implementation had already
 * pruned.
 *
 * What these tests defend is the upgrade path: a user with an existing auth
 * state installs baileyrs and must keep talking. Anything the codec drops on
 * the way in is a conversation that silently stops decrypting.
 */

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { LegacySession, NativeStore } from '../../Compatibility/legacy-store/constants.ts'
import { createSignalCodecs } from '../../Compatibility/legacy-store/codecs/signal.ts'
import { NATIVE_ONLY_PROJECTION } from '../../Compatibility/legacy-store/types.ts'
import { expect } from '../../__tests__/expect.ts'

type LegacyChain = {
	chainType: number
	chainKey: { counter: number; key?: string }
	messageKeys: Record<string, string>
}

type LegacyEntry = {
	registrationId?: number
	currentRatchet: {
		ephemeralKeyPair: { pubKey: string; privKey: string }
		lastRemoteEphemeralKey: string
		previousCounter: number
		rootKey: string
	}
	indexInfo: {
		baseKey: string
		baseKeyType: number
		closed: number
		used: number
		created: number
		remoteIdentityKey: string
	}
	_chains: Record<string, LegacyChain>
}

type LegacyRecord = { _sessions: Record<string, LegacyEntry>; version: string; registrationId?: number }

type Fixture = {
	bob: {
		creds: { registrationId: number; signedIdentityKey: { public: { type: 'Buffer'; data: string } } }
		store: { session: Record<string, LegacyRecord> }
	}
}

const fixture = JSON.parse(
	readFileSync(new URL('../../__tests__/fixtures/legacy-session-rc9.json', import.meta.url), 'utf-8')
) as Fixture

const SESSION_KEY = '5511900000001.0'
const bobIdentityPublic = new Uint8Array(Buffer.from(fixture.bob.creds.signedIdentityKey.public.data, 'base64'))

const codecs = createSignalCodecs({
	localIdentityPublic: bobIdentityPublic,
	localRegistrationId: fixture.bob.creds.registrationId
})
const session = codecs[NativeStore.SESSION]

/** A fresh deep copy, so a test that mutates the record cannot leak into the next. */
const legacySession = (): LegacyRecord => JSON.parse(JSON.stringify(fixture.bob.store.session[SESSION_KEY]))

const importSession = (record: LegacyRecord = legacySession()): Uint8Array => session.fromLegacy(SESSION_KEY, record)!

const projectSession = (bytes: Uint8Array): LegacyRecord => {
	const projected = session.toLegacy(SESSION_KEY, bytes)
	if (projected === NATIVE_ONLY_PROJECTION) throw new Error('rc.9 session projected as native-only')
	return projected as LegacyRecord
}

const onlyEntry = (record: LegacyRecord): LegacyEntry => Object.values(record._sessions)[0]!

describe('legacy DM session: rc.9 auth state', () => {
	test('imports a real rc.9 session into the native format', () => {
		expect(importSession().length).toBeGreaterThan(0)
	})

	test('keeps the session identity across the round trip', () => {
		// These fields are what makes it the SAME session to the peer. Lose any
		// one of them and the ratchet no longer lines up on the other side.
		const original = onlyEntry(legacySession())
		const back = onlyEntry(projectSession(importSession()))

		expect(back.registrationId).toBe(original.registrationId)
		expect(back.currentRatchet.rootKey).toBe(original.currentRatchet.rootKey)
		expect(back.currentRatchet.lastRemoteEphemeralKey).toBe(original.currentRatchet.lastRemoteEphemeralKey)
		expect(back.currentRatchet.previousCounter).toBe(original.currentRatchet.previousCounter)
		expect(back.indexInfo.baseKey).toBe(original.indexInfo.baseKey)
		expect(back.indexInfo.baseKeyType).toBe(original.indexInfo.baseKeyType)
		expect(back.indexInfo.remoteIdentityKey).toBe(original.indexInfo.remoteIdentityKey)
		expect(back.indexInfo.closed).toBe(original.indexInfo.closed)
	})

	test('keeps the ratchet key pair across the round trip', () => {
		const original = onlyEntry(legacySession())
		const back = onlyEntry(projectSession(importSession()))

		expect(back.currentRatchet.ephemeralKeyPair.pubKey).toBe(original.currentRatchet.ephemeralKeyPair.pubKey)
		expect(back.currentRatchet.ephemeralKeyPair.privKey).toBe(original.currentRatchet.ephemeralKeyPair.privKey)
	})

	test('preserves every ratchet chain', () => {
		const original = onlyEntry(legacySession())
		const back = onlyEntry(projectSession(importSession()))

		// Chain order is normalized by the core, so compare by ratchet key.
		expect(Object.keys(back._chains).toSorted()).toEqual(Object.keys(original._chains).toSorted())

		for (const [ratchetKey, chain] of Object.entries(original._chains)) {
			const got = back._chains[ratchetKey]!
			expect(got.chainType).toBe(chain.chainType)
			expect(got.chainKey.counter).toBe(chain.chainKey.counter)
			// rc.9 prunes the key off a chain it has ratcheted past; an absent key
			// must stay absent rather than come back as empty bytes.
			expect(got.chainKey.key).toBe(chain.chainKey.key)
		}
	})

	test('preserves the skipped-message keys of every chain', () => {
		const original = onlyEntry(legacySession())
		const back = onlyEntry(projectSession(importSession()))

		for (const [ratchetKey, chain] of Object.entries(original._chains)) {
			expect(back._chains[ratchetKey]!.messageKeys).toEqual(chain.messageKeys)
		}
	})

	test('is idempotent: re-importing the projection yields the same bytes', () => {
		const first = importSession()
		const second = importSession(projectSession(first))

		expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
	})

	test('keeps the record readable by the old implementation', () => {
		// The projection is what a rollback would read back off disk, so its
		// container has to stay in the exact shape rc.9 wrote.
		const back = projectSession(importSession())

		expect(back.version).toBe('v1')
		expect(Object.keys(back._sessions)).toEqual(Object.keys(legacySession()._sessions))
	})
})

/**
 * A chain accumulates a skipped message key whenever a message arrives out of
 * order, which is ordinary traffic rather than an edge case. The core persists
 * the v1 seed alongside the keys it derives from it; without that seed the
 * projection has no inverse and the whole record becomes native-only, which
 * freezes the legacy row on disk from that message onwards — a rollback would
 * then read a session stale by however long the upgrade lasted.
 */
describe('legacy DM session: skipped message keys', () => {
	const SEED = Buffer.alloc(32, 7).toString('base64')

	const withSkippedKey = (): LegacyRecord => {
		const record = legacySession()
		const chain = Object.values(onlyEntry(record)._chains).find(
			candidate => candidate.chainType === LegacySession.CHAIN_RECEIVING
		)!
		chain.messageKeys = { '0': SEED }
		return record
	}

	test('projects a record that carries one', () => {
		const back = onlyEntry(projectSession(importSession(withSkippedKey())))
		const carrying = Object.values(back._chains).filter(candidate => Object.keys(candidate.messageKeys).length > 0)

		expect(carrying).toHaveLength(1)
		expect(carrying[0]!.messageKeys).toEqual({ '0': SEED })
	})
})

/**
 * libsignal's own deserialize runs a v1 migration that copies a record-level
 * `registrationId` onto every entry that lacks one. An auth state written
 * before that migration still keeps the id only at the top, and reading such a
 * record as if the entries had none imports a session under the wrong
 * registration id — the peer then rejects everything it sends.
 */
describe('legacy DM session: pre-v1 record shape', () => {
	const preV1 = (): LegacyRecord => {
		const record = legacySession()
		const entry = onlyEntry(record)
		record.registrationId = entry.registrationId
		delete entry.registrationId
		return record
	}

	test('imports it under the record-level registration id', () => {
		const expected = onlyEntry(legacySession()).registrationId
		const back = onlyEntry(projectSession(importSession(preV1())))

		expect(back.registrationId).toBe(expected)
	})

	test('imports it to the same bytes as the migrated shape', () => {
		expect(Buffer.from(importSession(preV1())).equals(Buffer.from(importSession()))).toBe(true)
	})
})
