/** Provider-routed AES-GCM primitives supplied by whatsapp-rust-bridge >=0.24.0. */
import { aesGcm256Decrypt, aesGcm256Encrypt, initWasmEngine } from '@oxidezap/whatsapp-rust-bridge/host'

let initialized = false
const ensureInitialized = (): void => {
	if (!initialized) {
		try {
			initWasmEngine()
		} catch {
			try {
				const processLike = (globalThis as Record<string, unknown>)['process'] as
					| { getBuiltinModule?: (id: string) => unknown }
					| undefined
				const moduleApi = processLike?.getBuiltinModule?.('module') as
					| { createRequire?: (base: string) => (id: string) => unknown }
					| undefined
				const bridge = moduleApi?.createRequire?.(import.meta.url)('@oxidezap/whatsapp-rust-bridge') as
					| { initWasmEngine?: () => void }
					| undefined
				bridge?.initWasmEngine?.()
			} catch {
				// Hosts initialize the bridge explicitly through initSync.
			}
		}
		initialized = true
	}
}

export const aesGcm256EncryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	plaintext: Uint8Array
): Uint8Array => {
	ensureInitialized()
	return aesGcm256Encrypt(key, nonce, aad, plaintext)
}

export const aesGcm256DecryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	ciphertextWithTag: Uint8Array
): Uint8Array => {
	ensureInitialized()
	return aesGcm256Decrypt(key, nonce, aad, ciphertextWithTag)
}
