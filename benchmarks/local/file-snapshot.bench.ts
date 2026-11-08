import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'vitest'
import { useBridgeStore } from '../../src/Utils/use-bridge-store.ts'
import { integrationOptions } from '../options.ts'

// Hold input and publication semantics fixed while varying the already-owned
// atomic snapshot size. Setup and cleanup stay outside measurement.
describe('file snapshot/atomic', () => {
	for (const size of [256, 4096, 32768]) {
		test(`tc-token update with ${size}B snapshot row`, async ({ bench }) => {
			const folder = await mkdtemp(join(tmpdir(), 'baileyrs-snapshot-bench-'))
			try {
				const store = await useBridgeStore(folder)
				const payload = new Uint8Array(size).fill(7)
				await store.set('meta', 'fixture', payload)
				const jid = '12025550123@s.whatsapp.net'
				let timestamp = 1_700_000_000
				await store.touchTcTokenSenderTimestamp(jid, String(timestamp++))
				await bench(`durable tc-token update with ${size}B row`, async () => {
					await store.touchTcTokenSenderTimestamp(jid, String(timestamp++))
				}).run(integrationOptions)
				assert.deepEqual(await store.get('meta', 'fixture'), payload)
				await store.flush!()
			} finally {
				await rm(folder, { recursive: true, force: true })
			}
		})
	}
})
