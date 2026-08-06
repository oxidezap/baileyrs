import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import {
	calculateAgreement,
	calculateSignature,
	generateKeyPair,
	hkdf,
	md5,
	verifySignature
} from '@oxidezap/whatsapp-rust-bridge'
import { KEY_BUNDLE_TYPE } from '../Defaults/index.ts'
import {
	aesCbc256Decrypt,
	aesCbc256Encrypt,
	aesGcm256Decrypt,
	aesGcm256Encrypt,
	hmacDigest
} from '../Platform/crypto.ts'
import type { KeyPair } from '../Types/Auth.ts'

export { hkdf, md5 }
export type { HkdfInfo } from '@oxidezap/whatsapp-rust-bridge'

/** Prefix Signal's version byte when the public key is in raw 32-byte form. */
export const generateSignalPubKey = (pubKey: Uint8Array | Buffer) =>
	pubKey.length === 33 ? pubKey : Buffer.concat([KEY_BUNDLE_TYPE, pubKey])

export const Curve = {
	generateKeyPair: (): KeyPair => {
		const pair = generateKeyPair()
		return {
			private: Buffer.from(pair.privKey),
			public: Buffer.from(pair.pubKey.subarray(1))
		}
	},
	sharedKey: (privateKey: Uint8Array, publicKey: Uint8Array): Buffer<ArrayBuffer> =>
		Buffer.from(calculateAgreement(generateSignalPubKey(publicKey), privateKey)) as Buffer<ArrayBuffer>,
	sign: (privateKey: Uint8Array, buffer: Uint8Array): Uint8Array => calculateSignature(privateKey, buffer),
	verify: (publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean => {
		try {
			return verifySignature(generateSignalPubKey(publicKey), message, signature)
		} catch {
			return false
		}
	}
}

export const signedKeyPair = (identityKeyPair: KeyPair, keyId: number) => {
	const keyPair = Curve.generateKeyPair()
	return {
		keyPair,
		signature: Curve.sign(identityKeyPair.private, generateSignalPubKey(keyPair.public)),
		keyId
	}
}

export function aesEncryptGCM(
	plaintext: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array,
	additionalData: Uint8Array
): Buffer<ArrayBuffer> {
	return Buffer.from(aesGcm256Encrypt(key, iv, additionalData, plaintext)) as Buffer<ArrayBuffer>
}

export function aesDecryptGCM(
	ciphertext: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array,
	additionalData: Uint8Array
): Buffer<ArrayBuffer> {
	return Buffer.from(aesGcm256Decrypt(key, iv, additionalData, ciphertext)) as Buffer<ArrayBuffer>
}

export function aesEncryptCTR(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer<ArrayBuffer> {
	const cipher = createCipheriv('aes-256-ctr', key, iv)
	return Buffer.concat([cipher.update(plaintext), cipher.final()]) as Buffer<ArrayBuffer>
}

export function aesDecryptCTR(ciphertext: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer<ArrayBuffer> {
	const decipher = createDecipheriv('aes-256-ctr', key, iv)
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]) as Buffer<ArrayBuffer>
}

/** Decrypt AES-256-CBC where the IV prefixes the ciphertext. */
export function aesDecrypt(buffer: Uint8Array, key: Uint8Array): Buffer<ArrayBuffer> {
	return aesDecryptWithIV(buffer.subarray(16), key, buffer.subarray(0, 16))
}

export function aesDecryptWithIV(buffer: Uint8Array, key: Uint8Array, IV: Uint8Array): Buffer<ArrayBuffer> {
	return Buffer.from(aesCbc256Decrypt(key, IV, buffer)) as Buffer<ArrayBuffer>
}

/** Encrypt AES-256-CBC and prefix a random IV. */
export function aesEncrypt(buffer: Uint8Array, key: Uint8Array): Buffer<ArrayBuffer> {
	const IV = randomBytes(16)
	return Buffer.concat([IV, aesEncrypWithIV(Buffer.from(buffer), Buffer.from(key), IV)]) as Buffer<ArrayBuffer>
}

// Keep the historical upstream typo as part of the public drop-in API.
export function aesEncrypWithIV(buffer: Buffer, key: Buffer, IV: Buffer): Buffer<ArrayBuffer> {
	return Buffer.from(aesCbc256Encrypt(key, IV, buffer)) as Buffer<ArrayBuffer>
}

export function hmacSign(
	buffer: Buffer | Uint8Array,
	key: Buffer | Uint8Array,
	variant: 'sha256' | 'sha512' = 'sha256'
): Buffer<ArrayBufferLike> {
	return Buffer.from(hmacDigest(variant, key, buffer))
}

export function sha256(buffer: Buffer): Buffer<ArrayBufferLike> {
	return createHash('sha256').update(buffer).digest()
}

export async function derivePairingCodeKey(pairingCode: string, salt: Buffer): Promise<Buffer> {
	const keyMaterial = await globalThis.crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pairingCode),
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	)
	const derivedBits = await globalThis.crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: Uint8Array.from(salt),
			iterations: 2 << 16,
			hash: 'SHA-256'
		},
		keyMaterial,
		256
	)
	return Buffer.from(derivedBits)
}
