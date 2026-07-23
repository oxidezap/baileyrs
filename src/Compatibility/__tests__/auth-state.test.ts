import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { initAuthCreds } from '../../Utils/generics.ts'
import { useMemoryStore } from '../../Utils/use-memory-store.ts'
import { normalizeSocketAuthenticationState } from '../internal/auth-state.ts'

const makeKeys = () => ({
	get: async () => ({}),
	set: async () => undefined
})

describe('socket authentication normalization', () => {
	it('preserves a complete legacy authentication state by reference', () => {
		const creds = initAuthCreds()
		const keys = makeKeys()
		const normalized = normalizeSocketAuthenticationState({ creds, keys })

		assert.equal(normalized.creds, creds)
		assert.equal(normalized.keys, keys)
		assert.equal(normalized.store, undefined)
	})

	it('completes store-only native authentication without duplicating its storage', async () => {
		const store = useMemoryStore()
		const normalized = normalizeSocketAuthenticationState({ store })

		assert.equal(normalized.store, store)
		assert.equal(normalized.creds.registered, false)
		assert.equal(typeof normalized.keys.get, 'function')
		assert.equal(typeof normalized.keys.set, 'function')
		assert.deepEqual(await normalized.keys.get('pre-key', ['7']), {})
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
