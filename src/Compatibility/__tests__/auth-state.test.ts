import type { SignalKeyStore } from '../../Types/index.ts'
import { makeTransactionalMemKeys } from '../../Utils/__tests__/_legacy-store-fixtures.ts'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'
import { initAuthCreds } from '../../Utils/generics.ts'
import { useMemoryStore } from '../../Utils/use-memory-store.ts'
import {
	normalizeSocketAuthenticationState,
	refreshSocketAuthenticationState,
	waitForSocketAuthenticationState
} from '../internal/auth-state.ts'

const makeKeys = () => ({
	get: async () => ({}),
	set: async () => undefined
})

describe('socket authentication normalization', () => {
	it('rejects an unmigrated legacy backend before socket startup', () => {
		const creds = initAuthCreds()
		const keys = makeKeys()
		assert.throws(() => normalizeSocketAuthenticationState({ creds, keys }), /keys.bridgeTransaction/)
	})

	it('preserves a migrated legacy state by reference', () => {
		const creds = initAuthCreds()
		const keys = makeTransactionalMemKeys() as unknown as SignalKeyStore
		const state = normalizeSocketAuthenticationState({ creds, keys })
		assert.equal(state.creds, creds)
		assert.equal(state.keys, keys)
	})

	it('completes store-only native authentication without duplicating its storage', async () => {
		const store = useMemoryStore()
		const normalized = normalizeSocketAuthenticationState({ store })

		assert.equal(normalized.store, store)
		assert.equal(normalized.creds.registered, false)
		assert.equal(Buffer.isBuffer(normalized.creds.noiseKey.private), true)
		assert.equal(Buffer.isBuffer(normalized.creds.signedIdentityKey.public), true)
		assert.equal(typeof normalized.keys.get, 'function')
		assert.equal(typeof normalized.keys.set, 'function')
		assert.deepEqual(await normalized.keys.get('pre-key', ['7']), {})
	})

	it('hydrates returning store-only credentials before socket initialization', async () => {
		const store = useMemoryStore()
		await store.set(
			'device',
			'device',
			new TextEncoder().encode(
				JSON.stringify({ registration_id: 42, pn: { user: '15551234567', server: 's.whatsapp.net', device: 2 } })
			)
		)
		const normalized = normalizeSocketAuthenticationState({ store })
		await waitForSocketAuthenticationState(normalized)

		assert.equal(normalized.creds.registrationId, 42)
		assert.equal(normalized.creds.registered, true)
		assert.equal(normalized.creds.me?.id, '15551234567:2@s.whatsapp.net')
		assert.equal(Buffer.isBuffer(normalized.creds.noiseKey.private), true)
		assert.equal(Buffer.isBuffer(normalized.creds.signedIdentityKey.public), true)
	})

	it('refreshes store-only credentials after first pairing', async () => {
		const store = useMemoryStore()
		const normalized = normalizeSocketAuthenticationState({ store })
		await waitForSocketAuthenticationState(normalized)
		assert.equal(normalized.creds.registered, false)

		await store.set(
			'device',
			'device',
			new TextEncoder().encode(
				JSON.stringify({ registration_id: 84, pn: { user: '15557654321', server: 's.whatsapp.net' } })
			)
		)
		await refreshSocketAuthenticationState(normalized)

		assert.equal(normalized.creds.registrationId, 84)
		assert.equal(normalized.creds.registered, true)
		assert.equal(normalized.creds.me?.id, '15557654321@s.whatsapp.net')
		assert.equal(Buffer.isBuffer(normalized.creds.noiseKey.private), true)
	})

	it('rejects an incomplete legacy state without a native store', () => {
		assert.throws(
			() =>
				normalizeSocketAuthenticationState({ creds: initAuthCreds() } as Parameters<
					typeof normalizeSocketAuthenticationState
				>[0]),
			/auth must provide both creds and keys when no native store is configured/
		)
	})
})
