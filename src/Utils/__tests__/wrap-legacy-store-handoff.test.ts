/**
 * Sessions produced by the real upstream libsignal runtime (X3DH handshake +
 * double-ratchet traffic) must migrate losslessly into the canonical record,
 * and the projected record must keep working when handed back to upstream.
 */

import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { keyhelper, ProtocolAddress, SessionBuilder, SessionCipher, type KeyPair, type SignalStorage } from 'libsignal'
import SessionRecord from 'libsignal/src/session_record.js'
import { decodeSessionRecordComponents } from 'whatsapp-rust-bridge'
import { expect } from '../../__tests__/expect.ts'
import type { SignalKeyStore, SignalKeyStoreWithTransaction } from '../../Types/index.ts'
import { generateSignalPubKey } from '../crypto.ts'
import { BufferJSON, initAuthCreds } from '../generics.ts'
import { useLegacyMultiFileAuthState, wrapLegacyStore } from '../wrap-legacy-store.ts'
import { BRIDGE_SESSION_KEY_LID, UPSTREAM_SESSION_KEY_LID, makeWrapped } from './_legacy-store-fixtures.ts'

const BOB_SIGNAL_USER = UPSTREAM_SESSION_KEY_LID.slice(0, UPSTREAM_SESSION_KEY_LID.lastIndexOf('.'))

function makeStorage(identity: KeyPair, registrationId: number) {
	const sessions = new Map<string, SessionRecord>()
	const preKeys = new Map<number, KeyPair>()
	const signedPreKeys = new Map<number, KeyPair>()
	const storage: SignalStorage = {
		getOurIdentity: () => identity,
		getOurRegistrationId: () => registrationId,
		isTrustedIdentity: () => true,
		loadSession: id => sessions.get(id),
		storeSession: (id, record) => {
			sessions.set(id, record)
		},
		loadPreKey: id => preKeys.get(id),
		loadSignedPreKey: id => signedPreKeys.get(id),
		removePreKey: () => {}
	}
	return { storage, sessions, preKeys, signedPreKeys }
}

const credsIdentity = (creds: { signedIdentityKey: { public: Uint8Array; private: Uint8Array } }): KeyPair => ({
	pubKey: Buffer.from(generateSignalPubKey(creds.signedIdentityKey.public)),
	privKey: Buffer.from(creds.signedIdentityKey.private)
})

/** Full upstream X3DH handshake plus one ratchet round trip in each direction. */
async function establishUpstreamSession(aliceIdentity: KeyPair, aliceRegistrationId: number) {
	const bobIdentity = keyhelper.generateIdentityKeyPair()
	const bobRegistrationId = keyhelper.generateRegistrationId()
	const alice = makeStorage(aliceIdentity, aliceRegistrationId)
	const bob = makeStorage(bobIdentity, bobRegistrationId)
	const bobSignedPreKey = keyhelper.generateSignedPreKey(bobIdentity, 1)
	const bobPreKey = keyhelper.generatePreKey(1)
	bob.signedPreKeys.set(1, bobSignedPreKey.keyPair)
	bob.preKeys.set(1, bobPreKey.keyPair)

	const bobAddr = new ProtocolAddress(BOB_SIGNAL_USER, 0)
	const aliceAddr = new ProtocolAddress('501234567890', 0)
	await new SessionBuilder(alice.storage, bobAddr).initOutgoing({
		registrationId: bobRegistrationId,
		identityKey: bobIdentity.pubKey,
		signedPreKey: { keyId: 1, publicKey: bobSignedPreKey.keyPair.pubKey, signature: bobSignedPreKey.signature },
		preKey: { keyId: 1, publicKey: bobPreKey.keyPair.pubKey }
	})
	const aliceCipher = new SessionCipher(alice.storage, bobAddr)
	const bobCipher = new SessionCipher(bob.storage, aliceAddr)

	const hello = await aliceCipher.encrypt(Buffer.from('hello'))
	expect((await bobCipher.decryptPreKeyWhisperMessage(hello.body)).toString()).toBe('hello')
	const reply = await bobCipher.encrypt(Buffer.from('reply-1'))
	expect((await aliceCipher.decryptWhisperMessage(reply.body)).toString()).toBe('reply-1')

	return { alice, bob, aliceCipher, bobCipher, bobAddr, bobIdentity, bobRegistrationId }
}

describe('wrap-legacy-store: upstream-generated session handoff', () => {
	test('a real ratcheted record with a skipped message key migrates losslessly', async () => {
		const { wrapped, keys, creds } = await makeWrapped()
		const aliceIdentity = credsIdentity(creds)
		const s = await establishUpstreamSession(aliceIdentity, creds.registrationId)

		// Out-of-order delivery: s2 is skipped, deriving a stored message key.
		const s1 = await s.bobCipher.encrypt(Buffer.from('s1'))
		await s.bobCipher.encrypt(Buffer.from('s2'))
		const s3 = await s.bobCipher.encrypt(Buffer.from('s3'))
		expect((await s.aliceCipher.decryptWhisperMessage(s1.body)).toString()).toBe('s1')
		expect((await s.aliceCipher.decryptWhisperMessage(s3.body)).toString()).toBe('s3')

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: s.alice.sessions.get(s.bobAddr.toString())!.serialize() as object
		}
		const canonical = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const current = decodeSessionRecordComponents(canonical).currentSession!
		expect(current).toBeDefined()
		expect(current.localRegistrationId).toBe(creds.registrationId)
		expect(current.remoteRegistrationId).toBe(s.bobRegistrationId)
		expect(Buffer.from(current.localIdentityPublic!).equals(aliceIdentity.pubKey)).toBe(true)
		expect(Buffer.from(current.remoteIdentityPublic!).equals(s.bobIdentity.pubKey)).toBe(true)
		expect(current.rootKey!.length).toBe(32)
		expect(current.senderChain).toBeDefined()
		expect(current.pendingPreKey).toBeUndefined()

		// Exactly the s2 gap survives, at its original message counter
		// (reply-1 = 0, s1 = 1, s2 = 2, s3 = 3).
		const skipped = current.receiverChains.flatMap(chain => chain.messageKeys)
		expect(skipped.length).toBe(1)
		expect(skipped[0]!.index).toBe(2)
	})

	test('the projected record keeps decrypting and encrypting in upstream', async () => {
		const { wrapped, keys, creds } = await makeWrapped()
		const aliceIdentity = credsIdentity(creds)
		const s = await establishUpstreamSession(aliceIdentity, creds.registrationId)

		// Encrypted by upstream before migration, delivered only after it.
		const inFlight = await s.bobCipher.encrypt(Buffer.from('in-flight'))

		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: s.alice.sessions.get(s.bobAddr.toString())!.serialize() as object
		}
		const canonical = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, canonical)
		const projected = keys.raw['session']![UPSTREAM_SESSION_KEY_LID]
		expect(projected).toBeDefined()

		// Resume upstream from nothing but the projected record.
		const resumed = makeStorage(aliceIdentity, creds.registrationId)
		resumed.sessions.set(s.bobAddr.toString(), SessionRecord.deserialize(projected))
		const resumedCipher = new SessionCipher(resumed.storage, s.bobAddr)
		expect((await resumedCipher.decryptWhisperMessage(inFlight.body)).toString()).toBe('in-flight')
		const outbound = await resumedCipher.encrypt(Buffer.from('back-again'))
		expect((await s.bobCipher.decryptWhisperMessage(outbound.body)).toString()).toBe('back-again')
	})

	test('useLegacyMultiFileAuthState serves the same record from disk', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'legacy-auth-'))
		after(() => rm(dir, { recursive: true, force: true }))

		const creds = initAuthCreds()
		const s = await establishUpstreamSession(credsIdentity(creds), creds.registrationId)
		await writeFile(join(dir, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer))
		await writeFile(
			join(dir, `session-${UPSTREAM_SESSION_KEY_LID}.json`),
			JSON.stringify(s.alice.sessions.get(s.bobAddr.toString())!.serialize(), BufferJSON.replacer)
		)

		const { state, saveCreds } = await useLegacyMultiFileAuthState(dir)
		const wrapped = await wrapLegacyStore(
			{ creds: state.creds, keys: state.keys as SignalKeyStore | SignalKeyStoreWithTransaction },
			saveCreds
		)
		const canonical = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const current = decodeSessionRecordComponents(canonical).currentSession!
		expect(current).toBeDefined()
		expect(Buffer.from(current.remoteIdentityPublic!).equals(s.bobIdentity.pubKey)).toBe(true)
	})
})
