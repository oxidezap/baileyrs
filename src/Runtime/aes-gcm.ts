/**
 * Historical AES-GCM helper names, now a thin adapter over runtime-owned
 * bridge primitives. Engine initialization belongs to the runtime/socket
 * lifecycle; these calls never initialize or cache bridge state themselves.
 */
import { hostRuntime } from './host.ts'
import { makeMediaCryptoRuntime } from './bridge.ts'
import type { MediaCryptoRuntime } from './types.ts'

const defaultCryptoRuntime = makeMediaCryptoRuntime(hostRuntime)

export const aesGcm256EncryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	plaintext: Uint8Array,
	runtime: MediaCryptoRuntime = defaultCryptoRuntime
): Uint8Array => runtime.aesGcm256Encrypt(key, nonce, aad, plaintext)

export const aesGcm256DecryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	ciphertextWithTag: Uint8Array,
	runtime: MediaCryptoRuntime = defaultCryptoRuntime
): Uint8Array => runtime.aesGcm256Decrypt(key, nonce, aad, ciphertextWithTag)
