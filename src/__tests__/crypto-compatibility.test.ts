import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { describe, it } from 'node:test'
import {
	aesDecrypt,
	aesDecryptCTR,
	aesDecryptGCM,
	aesDecryptWithIV,
	aesEncrypWithIV,
	aesEncrypt,
	aesEncryptCTR,
	aesEncryptGCM,
	Curve,
	derivePairingCodeKey,
	generateSignalPubKey,
	hkdf,
	hmacSign,
	md5,
	sha256,
	signedKeyPair
} from '../Utils/crypto.ts'

const key = Buffer.from('11'.repeat(32), 'hex')
const iv = Buffer.from('22'.repeat(16), 'hex')
const plaintext = Buffer.from('Baileyrs compatibility crypto fixture')

describe('public crypto compatibility', () => {
	it('round-trips CBC with prefixed and explicit IV forms', () => {
		const explicit = aesEncrypWithIV(plaintext, key, iv)
		assert.deepEqual(aesDecryptWithIV(explicit, key, iv), plaintext)
		const prefixed = aesEncrypt(plaintext, key)
		assert.equal(prefixed.length > plaintext.length, true)
		assert.deepEqual(aesDecrypt(prefixed, key), plaintext)
	})

	it('round-trips CTR and authenticated GCM', () => {
		const ctr = aesEncryptCTR(plaintext, key, iv)
		assert.deepEqual(aesDecryptCTR(ctr, key, iv), plaintext)

		const nonce = Buffer.from('33'.repeat(12), 'hex')
		const aad = Buffer.from('associated')
		const gcm = aesEncryptGCM(plaintext, key, nonce, aad)
		assert.deepEqual(aesDecryptGCM(gcm, key, nonce, aad), plaintext)
		assert.throws(() => aesDecryptGCM(gcm, key, nonce, Buffer.from('wrong')), /auth|authenticate/i)
	})

	it('matches upstream bridge HKDF and MD5 outputs', async () => {
		const upstream = await import('baileys')
		const input = Buffer.from('hkdf differential fixture')
		const options = { salt: Buffer.from('salt'), info: 'WhatsApp Test Keys' }
		assert.deepEqual(Buffer.from(hkdf(input, 64, options)), Buffer.from(upstream.hkdf(input, 64, options)))
		assert.deepEqual(Buffer.from(md5(input)), Buffer.from(upstream.md5(input)))
	})

	it('matches hash/HMAC and pairing PBKDF2 contracts', async () => {
		assert.equal(
			sha256(Buffer.from('abc')).toString('hex'),
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		)
		assert.equal(hmacSign(Buffer.from('data'), Buffer.from('key')).length, 32)
		const salt = Buffer.from('pairing-salt')
		assert.deepEqual(await derivePairingCodeKey('12345678', salt), pbkdf2Sync('12345678', salt, 2 << 16, 32, 'sha256'))
	})

	it('prefixes only raw Signal public keys', () => {
		const raw = Buffer.alloc(32, 7)
		assert.deepEqual(generateSignalPubKey(raw), Buffer.concat([Buffer.from([5]), raw]))
		const prefixed = Buffer.concat([Buffer.from([5]), raw])
		assert.equal(generateSignalPubKey(prefixed), prefixed)
	})

	it('uses the same Signal Curve agreement and XEdDSA semantics as upstream', async () => {
		const upstream = await import('baileys')
		const localPair = Curve.generateKeyPair()
		const remotePair = upstream.Curve.generateKeyPair()
		assert.equal(localPair.private.length, 32)
		assert.equal(localPair.public.length, 32)

		const localShared = Curve.sharedKey(localPair.private, remotePair.public)
		const remoteShared = upstream.Curve.sharedKey(remotePair.private, localPair.public)
		assert.deepEqual(localShared, remoteShared)

		const message = Buffer.from('cross-runtime XEdDSA fixture')
		const localSignature = Curve.sign(localPair.private, message)
		const remoteSignature = upstream.Curve.sign(remotePair.private, message)
		assert.equal(upstream.Curve.verify(localPair.public, message, localSignature), true)
		assert.equal(Curve.verify(remotePair.public, message, remoteSignature), true)
		assert.equal(Curve.verify(remotePair.public, Buffer.from('tampered'), remoteSignature), false)
		assert.equal(Curve.verify(Buffer.alloc(7), message, remoteSignature), false)
	})

	it('creates signed pre-keys verifiable by both implementations', async () => {
		const upstream = await import('baileys')
		const identity = Curve.generateKeyPair()
		const signed = signedKeyPair(identity, 17)
		assert.equal(signed.keyId, 17)
		assert.equal(signed.signature.length, 64)
		const serializedPublic = generateSignalPubKey(signed.keyPair.public)
		assert.equal(Curve.verify(identity.public, serializedPublic, signed.signature), true)
		assert.equal(upstream.Curve.verify(identity.public, serializedPublic, signed.signature), true)
	})
})
