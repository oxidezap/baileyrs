import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { useBridgeStore } from '../use-bridge-store.ts'

// Fixed synthetic persisted keys, independent of the bridge's current encoders.
test('recovery namespaces enumerate historical state, external changes and account scope after reopen', async () => {
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-recovery-'))
	const otherFolder = await mkdtemp(join(tmpdir(), 'baileyrs-recovery-other-'))
	try {
		const first = await useBridgeStore(folder)
		const session = '123:1@s.whatsapp.net.0'
		const identity = '123:2@lid.0'
		const group = '120@g.us'
		await first.set('session', session, new Uint8Array([1]))
		await first.set('identity', identity, new Uint8Array(32).fill(2))
		await first.set('sender_key_devices', group, Buffer.from(JSON.stringify([[identity, false]])))
		await first.flush!()
		const reopened = await useBridgeStore(folder)
		assert.equal(reopened.capabilities?.enumerate, true)
		assert.deepEqual(await reopened.listKeys!('session', '123'), [session])
		assert.deepEqual(await reopened.listKeys!('identity', '123'), [identity])
		assert.deepEqual(await reopened.listKeys!('sender_key_devices'), [group])
		assert.deepEqual(await reopened.getMany!('sender_key_devices', [group]), [
			[group, new TextEncoder().encode(JSON.stringify([[identity, false]]))]
		])
		await first.set('session', '123:3@lid.0', new Uint8Array([3]))
		await first.delete('session', session)
		await first.flush!()
		assert.deepEqual(await reopened.listKeys!('session', '123'), ['123:3@lid.0'])
		const other = await useBridgeStore(otherFolder)
		for (const namespace of ['session', 'identity', 'sender_key_devices']) {
			assert.deepEqual(await other.listKeys!(namespace), [])
		}
	} finally {
		await rm(folder, { recursive: true, force: true })
		await rm(otherFolder, { recursive: true, force: true })
	}
})

for (const encoded of ['%invalid', '%31']) {
	test(`recovery enumeration rejects malformed or noncanonical persisted keys: ${encoded}`, async () => {
		const folder = await mkdtemp(join(tmpdir(), 'baileyrs-recovery-corrupt-'))
		try {
			const store = await useBridgeStore(folder)
			await writeFile(join(folder, `session-${encoded}.bin`), new Uint8Array([1]))
			await assert.rejects(store.listKeys!('session'), /native auth filename/)
		} finally {
			await rm(folder, { recursive: true, force: true })
		}
	})
}
