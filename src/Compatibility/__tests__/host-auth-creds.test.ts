import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// The host entrypoint needs an explicit initSync before any bridge call.
// The bare root auto-initializes from disk; importing it here is the test
// harness equivalent of the host's initSync({ module: wasm }).
import { generateKeyPair } from '@oxidezap/whatsapp-rust-bridge/host'
import { generateSignalPubKey } from '../../Utils/crypto.ts'
import { verifySignature } from '@oxidezap/whatsapp-rust-bridge/host'
import { createAuthenticationState, initHostAuthCreds } from '../host-auth-state.ts'
import { useMemoryStore } from '../../Utils/use-memory-store.ts'
import { initAuthCreds } from '../../Utils/generics.ts'
import { expect } from '../../__tests__/expect.ts'

describe('host auth creds', () => {
	it('shares the initialized bridge engine with the host entrypoint', () => {
		// The bare root auto-initializes the wasm from disk; the host
		// entrypoint needs initSync({ module: wasm }). Calling keygen
		// through /host proves the engine is live for host consumers.
		expect(generateKeyPair().privKey).toHaveLength(32)
	})
	it('matches the Node initAuthCreds field contract', () => {
		const host = initHostAuthCreds()
		const node = initAuthCreds()
		expect(Object.keys(host).toSorted()).toEqual(Object.keys(node).toSorted())
		expect(host.registrationId >= 0 && host.registrationId < 16_384).toBe(true)
		expect(/^[A-Za-z0-9+/]{43}=$/.test(host.advSecretKey)).toBe(true)
		for (const key of [host.noiseKey, host.pairingEphemeralKeyPair, host.signedIdentityKey]) {
			expect(key.private).toHaveLength(32)
			expect(key.public).toHaveLength(32)
		}
		expect(host.signedPreKey.signature).toHaveLength(64)
		expect(host.signedPreKey.keyId).toBe(1)
	})

	it('builds host auth from a native store without legacy projection', async () => {
		const auth = await createAuthenticationState(useMemoryStore())
		expect(auth.creds.registered).toBe(false)
		expect(auth.store).toBeDefined()
	})

	it('rejects malformed persisted PN and LID components', async () => {
		for (const device of [
			{ pn: { user: '123', server: 7 } },
			{ pn: { user: '123', server: 'invalid.example' } },
			{ lid: { user: '456', server: 'lid', device: -1 } },
			{ lid: { user: '456', server: 'lid', device: 1.5 } }
		]) {
			const store = useMemoryStore()
			await store.set('device', 'device', new TextEncoder().encode(JSON.stringify(device)))
			await assert.rejects(createAuthenticationState(store), /invalid (pn|lid) JID/)
		}
	})

	it('rejects persisted registration IDs outside the 14-bit domain', async () => {
		for (const registration_id of [-1, 16_384, Number.MAX_SAFE_INTEGER]) {
			const store = useMemoryStore()
			await store.set('device', 'device', new TextEncoder().encode(JSON.stringify({ registration_id })))
			await assert.rejects(createAuthenticationState(store), /invalid persisted registration id/)
		}
	})

	it('signs the prefixed public key like the Node path', () => {
		const host = initHostAuthCreds()
		expect(
			verifySignature(
				generateSignalPubKey(host.signedIdentityKey.public),
				generateSignalPubKey(host.signedPreKey.keyPair.public),
				host.signedPreKey.signature
			)
		).toBe(true)
	})
})
