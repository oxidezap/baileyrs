/**
 * `useMultiFileAuthState` has to rebuild its credential mirror from the device
 * the engine persisted.
 *
 * The mirror starts life as `initAuthCreds()`, which invents everything, and
 * nothing on this path used to read the device back: every restart handed the
 * caller `registered: false` and `me: undefined` for a paired, working session.
 * Upstream bots read both — `creds.me.id` is how they know who they are, and
 * they branch on `registered` to decide whether pairing is still owed — so the
 * mirror being wrong is a compatibility break even though the socket itself
 * connects fine off the engine's own copy.
 *
 * The device bytes here are produced by the same codec that reads them
 * (`createDeviceProjection().read`), so these are round-trips through the real
 * format rather than fixtures that can drift away from it.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createDeviceProjection } from '../Compatibility/legacy-store/device.ts'
import { nativeKey } from '../Compatibility/legacy-store/routing.ts'
import type { AuthenticationCreds } from '../Types/index.ts'
import { initAuthCreds } from '../Utils/generics.ts'
import { useBridgeStore } from '../Utils/use-bridge-store.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'

const SESSION_PEER = '5511900000001.0'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy-session-rc9.json', import.meta.url), 'utf-8')) as {
	bob: { store: { session: Record<string, unknown> } }
}

const folders: string[] = []
const makeFolder = () => {
	const folder = mkdtempSync(join(tmpdir(), 'auth-hydration-'))
	folders.push(folder)
	return folder
}

const PN = '559980000002:80@s.whatsapp.net'
const LID = '100000024691356:80@lid'

/** A device as the engine would have left it after a successful pairing. */
const pairedCreds = (): AuthenticationCreds => {
	const creds = initAuthCreds()
	creds.me = { id: PN, lid: LID, name: 'tester' }
	creds.registered = true
	return creds
}

/**
 * Write `source` into `folder` the way the engine does, then hand back what a
 * restart sees.
 */
const restartOn = async (folder: string, source: AuthenticationCreds) => {
	const store = await useBridgeStore(folder)
	const projection = createDeviceProjection(source)
	for (const record of ['device', 'account'] as const) {
		const payload = projection.read(record)
		if (payload) await store.set('device', record, payload)
	}
	return await useMultiFileAuthState(folder)
}

describe('useMultiFileAuthState device hydration', () => {
	after(() => {
		for (const folder of folders) rmSync(folder, { recursive: true, force: true })
	})

	it('rebuilds identity from the persisted device', async () => {
		const source = pairedCreds()
		const { state } = await restartOn(makeFolder(), source)

		// The named regression: both were `false` / `undefined` on every restart.
		assert.equal(state.creds.registered, true)
		assert.equal(state.creds.me?.id, PN)
		assert.equal(state.creds.me?.lid, LID)
		assert.equal(state.creds.me?.name, 'tester')
	})

	it('rebuilds the Signal material, not just the labels', async () => {
		// `initAuthCreds()` generates fresh keys, so a mirror that kept them
		// would describe a device that never existed — worse than an empty one,
		// because it looks populated.
		const source = pairedCreds()
		const { state } = await restartOn(makeFolder(), source)

		assert.equal(state.creds.registrationId, source.registrationId)
		assertSameBytes(state.creds.signedIdentityKey.public, source.signedIdentityKey.public, 'identity key')
		assertSameBytes(state.creds.noiseKey.public, source.noiseKey.public, 'noise key')
		assert.equal(state.creds.signedPreKey.keyId, source.signedPreKey.keyId)
		assertSameBytes(state.creds.signedPreKey.keyPair.public, source.signedPreKey.keyPair.public, 'signed pre-key')
		assert.equal(state.creds.advSecretKey, source.advSecretKey)
	})

	it('projects the key store around the device identity, not the throwaway one', async () => {
		// The ordering guard. Hydration has to run before `projectNativeStore`,
		// which snapshots `signedIdentityKey.public` and `registrationId` into
		// the Signal codecs when it is called. Reverse the two and everything
		// above still passes — the mirror is the same object, mutated later —
		// while the codecs quietly keep the invented identity.
		const source = pairedCreds()
		const folder = makeFolder()
		const { state } = await restartOn(folder, source)

		// A real rc.9 session, because the local identity is written into the
		// imported record and an empty one carries nothing to look at.
		await state.keys.set({ session: { [SESSION_PEER]: legacySessionRecord() } as never })

		const store = await useBridgeStore(folder)
		const written = await store.get('session', nativeKey('session', SESSION_PEER))
		assert.ok(written, 'the session was not written through the projection')
		assert.ok(
			indexOfBytes(written, source.signedIdentityKey.public) >= 0,
			'the imported session does not carry the device identity, so the codecs were built before hydration'
		)
	})

	it('leaves the mirror at its defaults when there is no device yet', async () => {
		// A first run has nothing to read, and must not be reported as paired.
		const { state } = await useMultiFileAuthState(makeFolder())
		assert.equal(state.creds.registered, false)
		assert.equal(state.creds.me, undefined)
	})

	it('survives a device record it cannot decode', async () => {
		// Losing the mirror is better than refusing to start: the engine reads
		// its own device from these bytes whatever this makes of them.
		const folder = makeFolder()
		const store = await useBridgeStore(folder)
		await store.set('device', 'device', new Uint8Array([0x7b, 0x00, 0x01]))

		const { state } = await useMultiFileAuthState(folder)
		assert.equal(state.creds.registered, false)
	})
})

/** A real baileys@7.0.0-rc.9 session, deep-copied so no test can leak into another. */
function legacySessionRecord(): unknown {
	return JSON.parse(JSON.stringify(fixture.bob.store.session[SESSION_PEER]))
}

/** Byte equality without caring whether the value arrived as a Buffer or a Uint8Array. */
function assertSameBytes(actual: Uint8Array, expected: Uint8Array, what: string) {
	assert.deepEqual(Array.from(actual), Array.from(expected), `${what} was not restored from the device`)
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
	outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
		for (let index = 0; index < needle.length; index++) {
			if (haystack[start + index] !== needle[index]) continue outer
		}
		return start
	}
	return -1
}
