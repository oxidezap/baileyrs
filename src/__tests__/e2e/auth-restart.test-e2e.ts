/**
 * E2E: what a bot sees in `creds` after restarting on a paired auth folder.
 *
 * The offline suite builds the device bytes with the same codec that reads
 * them, which proves the hydration but not that the engine writes what the
 * hydration expects. This one pairs for real, drops the socket, and reopens the
 * folder the way a restarted bot does.
 *
 * The regression it guards: every restart used to hand back `registered: false`
 * and `me: undefined` for a working session, because nothing on the native
 * store path ever read the device back into the mirror.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { jidNormalizedUser, useMultiFileAuthState } from '../../index.ts'
import { createTestClient } from './test-client.ts'

describe('E2E: creds after a restart', { timeout: 120_000 }, () => {
	let folder: string
	let pairedJid: string

	before(async () => {
		folder = mkdtempSync(join(tmpdir(), 'baileys-e2e-auth-restart-'))
		const client = await createTestClient({ label: 'alice', authFolder: folder })
		pairedJid = client.jid
		// Not `destroyTestClient`: it deletes the auth folder, which is the
		// whole subject of this test.
		client.sock.setAutoReconnect(false)
		await client.sock.end(undefined)
	})

	after(() => {
		rmSync(folder, { recursive: true, force: true })
	})

	test('a restarted bot reads back its own identity', async () => {
		const { state } = await useMultiFileAuthState(folder)

		assert.equal(state.creds.registered, true, '`registered` did not survive the restart')
		assert.ok(state.creds.me, '`me` did not survive the restart')
		assert.equal(jidNormalizedUser(state.creds.me.id), jidNormalizedUser(pairedJid))
		// The engine addresses the account by LID, and a mirror without it sends
		// a bot back to resolving its own identity over the wire.
		assert.ok(state.creds.me.lid, '`me.lid` did not survive the restart')
	})

	test('the restarted mirror carries the device Signal material', async () => {
		// A mirror that kept `initAuthCreds()`'s invented keys describes a device
		// that never paired, which is worse than an empty one because it reads as
		// populated.
		const first = await useMultiFileAuthState(folder)
		const second = await useMultiFileAuthState(folder)

		assert.equal(first.state.creds.registrationId, second.state.creds.registrationId)
		assert.deepEqual(
			Array.from(first.state.creds.signedIdentityKey.public),
			Array.from(second.state.creds.signedIdentityKey.public),
			'two reads of the same folder disagree on the identity key'
		)
		assert.deepEqual(
			Array.from(first.state.creds.noiseKey.public),
			Array.from(second.state.creds.noiseKey.public),
			'two reads of the same folder disagree on the noise key'
		)
	})
})
