import { makeTransactionalMemKeys } from '../Utils/__tests__/_legacy-store-fixtures.ts'
/**
 * The keystore divergence, written down as executable form.
 *
 * baileyrs persists the Rust core's own state through the consumer's
 * `SignalKeyStore`, under namespaces upstream Baileys never writes. That is a
 * deliberate contract, not an accident, so these tests fix both halves of it:
 * that the writes really happen before pairing (the bug a production bot hit
 * when it counted keystore rows to detect a first run), and that the exported
 * classifier tells bridge state apart from Signal key material for every
 * namespace in the routing catalog.
 *
 * If a future change stops writing bridge state before pairing, the first test
 * fails — that is the intended outcome: the contract documented in the README
 * would no longer be true and has to be re-read, not silently updated.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { describe, it, test } from 'node:test'
import P from 'pino'

import { LegacyStore, MirrorStore, RawStore, StoreCatalog } from '../Compatibility/legacy-store/constants.ts'
import makeWASocket from '../Socket/index.ts'
import type { AuthenticationState, SignalKeyStore } from '../Types/index.ts'
import { initAuthCreds } from '../Utils/generics.ts'
import {
	BRIDGE_INTERNAL_KEY_PREFIX,
	BRIDGE_INTERNAL_KEY_TYPES,
	isBridgeInternalKeyType
} from '../Utils/wrap-legacy-store.ts'
import { expect } from './expect.ts'

const silentLogger = P({ level: 'silent' })
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Accepts and immediately drops every connection, so the engine never pairs. */
const startDeadEndServer = async () => {
	const live = new Set<Socket>()
	const server: Server = createServer(socket => {
		live.add(socket)
		socket.on('error', () => {})
		socket.on('close', () => live.delete(socket))
		socket.destroy()
	})
	server.on('error', () => {})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (typeof address === 'string' || address === null) throw new Error('expected a TCP address')
	return {
		url: `ws://127.0.0.1:${address.port}`,
		close: async () => {
			for (const socket of live) socket.destroy()
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	}
}

const makeRecordingKeys = () => {
	const writtenTypes: string[] = []
	return { ...makeTransactionalMemKeys(type => writtenTypes.push(type)), writtenTypes }
}

describe('bridge keystore namespaces: the observed behavior', { timeout: 120_000 }, () => {
	it('a fresh, unpaired socket writes bridge state into the consumer keystore', async () => {
		const server = await startDeadEndServer()
		const creds = initAuthCreds()
		const keys = makeRecordingKeys()

		try {
			const sock = makeWASocket({
				auth: { creds, keys: keys as unknown as SignalKeyStore } satisfies AuthenticationState,
				logger: silentLogger,
				waWebSocketUrl: server.url
			})

			const deadline = Date.now() + 30_000
			while (keys.writtenTypes.length === 0) {
				if (Date.now() > deadline) throw new Error('the engine never wrote to the keystore')
				await wait(50)
			}
			await sock.end(undefined).catch(() => {})
		} finally {
			await server.close()
		}

		// Still unpaired: no QR was ever scanned, the transport never completed
		// a handshake. Upstream Baileys writes nothing to `keys` in this state.
		expect(creds.registered).toBe(false)
		expect(creds.me).toBe(undefined)

		// Every namespace touched is bridge-internal, and the classifier says so.
		for (const type of keys.writtenTypes) expect(isBridgeInternalKeyType(type)).toBe(true)
		expect(keys.writtenTypes).toContain(MirrorStore.DEVICE)

		// The reported bug: counting keystore rows to detect a first run reads
		// bridge state as a session that does not exist.
		expect(keys.count() > 0).toBe(true)
		expect(!creds.registered && !creds.me?.id && keys.count() === 0).toBe(false)

		// The documented replacement stays correct.
		expect(!creds.registered && !creds.me?.id).toBe(true)
	})
})

describe('bridge keystore namespaces: the classifier', () => {
	test('every mirror and raw namespace in the catalog is internal', () => {
		const catalogued = [...Object.values(MirrorStore), ...Object.values(RawStore)]
		expect(catalogued.length > 0).toBe(true)
		for (const type of catalogued) expect(isBridgeInternalKeyType(type)).toBe(true)
	})

	test('the exported list is the catalog, not a second copy of it', () => {
		const nativeTypes = [...new Set(Object.values(StoreCatalog).map(route => route.nativeType))]
		expect([...BRIDGE_INTERNAL_KEY_TYPES].toSorted()).toEqual(nativeTypes.toSorted())
		expect([...Object.values(MirrorStore), ...Object.values(RawStore)].toSorted()).toEqual(nativeTypes.toSorted())
	})

	test('every namespace holding real Signal key material is not internal', () => {
		const signalTypes = [...Object.values(LegacyStore), 'sender-key-memory']
		expect(signalTypes.length > 0).toBe(true)
		for (const type of signalTypes) expect(isBridgeInternalKeyType(type)).toBe(false)
	})

	test('classification is by reserved prefix, so a namespace added later is covered', () => {
		// Deliberate: the prefix is reserved, and the next namespace has to be
		// filtered by stores written today, before they are rebuilt.
		expect(BRIDGE_INTERNAL_KEY_TYPES.includes('bridge-native-future-store')).toBe(false)
		expect(isBridgeInternalKeyType('bridge-native-future-store')).toBe(true)
		expect(isBridgeInternalKeyType(`${BRIDGE_INTERNAL_KEY_PREFIX}anything`)).toBe(true)
	})

	test('a namespace that only looks like the prefix is not internal', () => {
		for (const type of [
			'bridge',
			'bridged-native-device',
			'native-device',
			'my-bridge-native-device',
			'pre-key-bridge'
		])
			expect(isBridgeInternalKeyType(type)).toBe(false)
	})

	test('non-namespace input is reported as not internal instead of throwing', () => {
		for (const value of ['', undefined, null, 0, 42, {}, [], Symbol('session'), () => {}])
			expect(isBridgeInternalKeyType(value)).toBe(false)
	})
})
