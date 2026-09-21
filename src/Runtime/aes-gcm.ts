/** Provider-routed AES-GCM primitives supplied by whatsapp-rust-bridge >=0.24.0. */
import { aesGcm256Decrypt, aesGcm256Encrypt } from '@oxidezap/whatsapp-rust-bridge/host'

export const aesGcm256EncryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	plaintext: Uint8Array
): Uint8Array => aesGcm256Encrypt(key, nonce, aad, plaintext)

export const aesGcm256DecryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	ciphertextWithTag: Uint8Array
): Uint8Array => aesGcm256Decrypt(key, nonce, aad, ciphertextWithTag)
