import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto'

/**
 * Native crypto callbacks that delegate AES/HMAC primitives to Node's OpenSSL
 * (`node:crypto`). Pass the returned object as the second argument to
 * `initWasmEngine(logger, nativeCrypto)` — every Signal / Noise primitive in
 * the Rust bridge (wacore_libsignal::crypto) will use it instead of the WASM
 * soft implementation.
 *
 * Safe to use only in Node.js / Bun. In browsers, omit this and the bridge
 * falls back to the WASM soft AES + sha2.
 */
export const makeNativeCryptoProvider = () => ({
	aesCbc256Encrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
		const c = createCipheriv('aes-256-cbc', key, iv)
		const a = c.update(plaintext)
		const b = c.final()
		const out = new Uint8Array(a.length + b.length)
		out.set(a, 0)
		out.set(b, a.length)
		return out
	},

	aesCbc256Decrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
		const d = createDecipheriv('aes-256-cbc', key, iv)
		const a = d.update(ciphertext)
		const b = d.final()
		const out = new Uint8Array(a.length + b.length)
		out.set(a, 0)
		out.set(b, a.length)
		return out
	},

	aesGcm256Encrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
		const c = createCipheriv('aes-256-gcm', key, nonce)
		if (aad.length > 0) c.setAAD(aad, { plaintextLength: plaintext.length })
		const a = c.update(plaintext)
		const b = c.final()
		const tag = c.getAuthTag()
		const out = new Uint8Array(a.length + b.length + tag.length)
		out.set(a, 0)
		out.set(b, a.length)
		out.set(tag, a.length + b.length)
		return out
	},

	aesGcm256Decrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertextWithTag: Uint8Array): Uint8Array {
		if (ciphertextWithTag.length < 16) {
			throw new Error('aesGcm256Decrypt: ciphertext too short for tag')
		}
		const ctLen = ciphertextWithTag.length - 16
		const d = createDecipheriv('aes-256-gcm', key, nonce)
		d.setAuthTag(ciphertextWithTag.subarray(ctLen))
		if (aad.length > 0) d.setAAD(aad, { plaintextLength: ctLen })
		const a = d.update(ciphertextWithTag.subarray(0, ctLen))
		// d.final() throws on tag mismatch — Rust adapter maps that to AuthFailed.
		const b = d.final()
		const out = new Uint8Array(a.length + b.length)
		out.set(a, 0)
		out.set(b, a.length)
		return out
	},

	hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
		const h = createHmac('sha256', key)
		h.update(data)
		return new Uint8Array(h.digest())
	}
})
