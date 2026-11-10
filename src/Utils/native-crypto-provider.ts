import {
	aesCbc256Decrypt,
	aesCbc256Encrypt,
	aesGcm256Decrypt,
	aesGcm256Encrypt,
	hmacDigest
} from '../Platform/crypto.ts'

/**
 * Native crypto callbacks that delegate AES/HMAC primitives to Node's OpenSSL
 * (`node:crypto`). Pass the returned object as the second argument to
 * `initWasmEngine(logger, nativeCrypto)`. The bridge selects these callbacks
 * only for AES payloads large enough to amortize the JS boundary; small Signal
 * operations, HMAC, and Noise transport remain in Rust.
 *
 * Safe to use only in Node.js. In browsers, omit this and the bridge
 * falls back to the WASM soft AES + sha2.
 */
export const makeNativeCryptoProvider = () => ({
	aesCbc256Encrypt,
	aesCbc256Decrypt,
	aesGcm256Encrypt,
	aesGcm256Decrypt,

	hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
		return hmacDigest('sha256', key, data)
	},

	hmacSha256TwoPart(key: Uint8Array, first: Uint8Array, second: Uint8Array): Uint8Array {
		return hmacDigest('sha256', key, first, second)
	}
})
