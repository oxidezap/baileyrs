import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { initSync } from '@oxidezap/whatsapp-rust-bridge/host'
import { makeWASocket, createAuthenticationState, type HostStoreCallbacks } from '../../host.ts'

// Node-only harness for the real /host WASM and socket; no live server or QR required.
initSync({ module: readFileSync(fileURLToPath(import.meta.resolve('@oxidezap/whatsapp-rust-bridge/wasm'))) })

const logger = {
	level: 'silent',
	child() {
		return this
	},
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {}
}

test('a fresh host socket persists a device that the next auth state can hydrate', { timeout: 15_000 }, async () => {
	const records = new Map<string, Uint8Array>()
	const store: HostStoreCallbacks = {
		get: async (namespace, key) => records.get(`${namespace}/${key}`)?.slice() ?? null,
		set: async (namespace, key, value) => {
			records.set(`${namespace}/${key}`, value.slice())
		},
		delete: async (namespace, key) => {
			records.delete(`${namespace}/${key}`)
		}
	}
	const auth = await createAuthenticationState(store)
	assert.equal(auth.creds.registered, false)
	assert.equal(records.has('device/device'), false)

	const socket = makeWASocket({ auth, logger, waWebSocketUrl: 'ws://127.0.0.1:1' })
	socket.setAutoReconnect(false)
	try {
		for (let tries = 0; tries < 200 && !records.has('device/device'); tries++) await setTimeout(20)
		assert.ok(records.has('device/device'), 'socket did not persist its new device')
	} finally {
		await socket.end()
	}
	const persisted: unknown = JSON.parse(new TextDecoder().decode(records.get('device/device')))
	assert.ok(persisted && typeof persisted === 'object' && 'registration_id' in persisted && 'noise_key' in persisted)
	const { registration_id, noise_key } = persisted
	assert.ok(typeof registration_id === 'number' && registration_id >= 1 && registration_id <= 2_147_483_647)
	assert.ok(Array.isArray(noise_key) && noise_key.length === 64 && noise_key.every(byte => Number.isInteger(byte)))
	const restored = await createAuthenticationState(store)
	assert.equal(restored.creds.registrationId, registration_id)
	assert.deepEqual(Array.from(restored.creds.noiseKey.private), noise_key.slice(0, 32))
	assert.deepEqual(Array.from(restored.creds.noiseKey.public), noise_key.slice(32))
	assert.equal(restored.creds.registered, false)
})
