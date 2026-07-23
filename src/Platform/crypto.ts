import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto'

const AES_256_CBC = 'aes-256-cbc'
const AES_256_GCM = 'aes-256-gcm'
const GCM_AUTH_TAG_BYTES = 16

export const aesCbc256Encrypt = (key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array => {
	const cipher = createCipheriv(AES_256_CBC, key, iv)
	return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

export const aesCbc256Decrypt = (key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array => {
	const decipher = createDecipheriv(AES_256_CBC, key, iv)
	return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export const aesGcm256Encrypt = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	plaintext: Uint8Array
): Uint8Array => {
	const cipher = createCipheriv(AES_256_GCM, key, nonce)
	if (aad.length) cipher.setAAD(aad, { plaintextLength: plaintext.length })
	return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

export const aesGcm256Decrypt = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	ciphertextWithTag: Uint8Array
): Uint8Array => {
	if (ciphertextWithTag.length < GCM_AUTH_TAG_BYTES) {
		throw new RangeError('AES-GCM ciphertext is shorter than its authentication tag')
	}
	const ciphertextLength = ciphertextWithTag.length - GCM_AUTH_TAG_BYTES
	const decipher = createDecipheriv(AES_256_GCM, key, nonce)
	decipher.setAuthTag(ciphertextWithTag.subarray(ciphertextLength))
	if (aad.length) decipher.setAAD(aad, { plaintextLength: ciphertextLength })
	return Buffer.concat([decipher.update(ciphertextWithTag.subarray(0, ciphertextLength)), decipher.final()])
}

export const hmacDigest = (variant: 'sha256' | 'sha512', key: Uint8Array, ...parts: Uint8Array[]): Uint8Array => {
	const hmac = createHmac(variant, key)
	for (const part of parts) hmac.update(part)
	return hmac.digest()
}
