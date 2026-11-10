/**
 * `initAuthCreds()` must produce real Signal key material: every pair has a
 * matching public key and the signed pre-key signature verifies under the
 * upstream libsignal runtime, so credentials remain runtime-interoperable.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import { calculateAgreement, generateKeyPair, verifySignature } from 'libsignal/src/curve.js'
import { expect } from '../../__tests__/expect.ts'
import type { KeyPair } from '../../Types/Auth.ts'
import { generateSignalPubKey } from '../crypto.ts'
import { initAuthCreds } from '../generics.ts'

/** A key pair is consistent iff both sides derive the same shared secret. */
function agreesWithUpstream(pair: KeyPair): boolean {
	const peer = generateKeyPair()
	const ours = calculateAgreement(peer.pubKey, pair.private)
	const theirs = calculateAgreement(generateSignalPubKey(pair.public), peer.privKey)
	return Buffer.from(ours).equals(Buffer.from(theirs))
}

describe('initAuthCreds key material', () => {
	test('every generated pair agrees with the upstream curve runtime', () => {
		const creds = initAuthCreds()
		expect(agreesWithUpstream(creds.signedIdentityKey)).toBe(true)
		expect(agreesWithUpstream(creds.noiseKey)).toBe(true)
		expect(agreesWithUpstream(creds.pairingEphemeralKeyPair)).toBe(true)
		expect(agreesWithUpstream(creds.signedPreKey.keyPair)).toBe(true)
	})

	test('the signed pre-key signature verifies under the upstream runtime', () => {
		const creds = initAuthCreds()
		expect(
			verifySignature(
				generateSignalPubKey(creds.signedIdentityKey.public),
				generateSignalPubKey(creds.signedPreKey.keyPair.public),
				creds.signedPreKey.signature
			)
		).toBe(true)
	})

	test('registration id stays in the 14-bit range with the expected key ids', () => {
		for (let round = 0; round < 32; round++) {
			const creds = initAuthCreds()
			expect(creds.registrationId >= 0 && creds.registrationId <= 0x3fff).toBe(true)
			expect(creds.signedPreKey.keyId).toBe(1)
			expect(creds.nextPreKeyId).toBe(1)
		}
	})
})
