import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initWasmEngine } from '@oxidezap/whatsapp-rust-bridge'
import { createAuthenticationState } from '../Compatibility/auth-state.ts'
import { useBridgeStore } from '../Utils/use-bridge-store.ts'
import { useMemoryStore } from '../Utils/use-memory-store.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'

initWasmEngine()
const encode = (record: unknown) => new TextEncoder().encode(JSON.stringify(record))
// Synthetic protobuf details only; no identity, signature or account material.
const inline = [10, 1, 1]
const sidecar = new Uint8Array([10, 1, 2])
for (const backend of ['host', 'file'] as const) {
	for (const presence of ['absent', 'null', 'value'] as const) {
		test(`${backend} hydration uses sidecar only for absent inline account (${presence})`, async () => {
			const folder = await mkdtemp(join(tmpdir(), 'account-precedence-'))
			try {
				const store = backend === 'host' ? useMemoryStore() : await useBridgeStore(folder)
				const record = presence === 'absent' ? {} : { account: presence === 'null' ? null : inline }
				await store.set('device', 'device', encode(record))
				await store.set('device', 'account', sidecar)
				await store.flush?.()
				let sidecarReads = 0
				const get = store.get.bind(store)
				store.get = async (namespace, key) => {
					if (namespace === 'device' && key === 'account') sidecarReads++
					return get(namespace, key)
				}
				const state =
					backend === 'host' ? await createAuthenticationState(store) : (await useMultiFileAuthState(folder)).state
				if (presence === 'null') assert.equal(state.creds.account, undefined)
				else assert.deepEqual(Array.from(state.creds.account!.details!), [presence === 'value' ? 1 : 2])
				if (backend === 'host') assert.equal(sidecarReads, presence === 'absent' ? 1 : 0)
			} finally {
				await rm(folder, { recursive: true, force: true })
			}
		})
	}
}
