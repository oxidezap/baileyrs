/**
 * E2E: the `connection.update` contract, against a live connection.
 *
 * `connection.update { close }` carries one meaning on this socket, the same
 * one it carries in upstream Baileys: this socket is finished, build a new
 * one. Disconnects the Rust engine retries surface as `connecting`.
 *
 * That split is what makes the canonical upstream handler safe here:
 *
 * ```ts
 * if (connection === 'close') {
 *   const shouldReconnect = statusCode !== DisconnectReason.loggedOut
 *   if (shouldReconnect) connectToWhatsApp()
 * }
 * ```
 *
 * Upstream has no auto-reconnect, so that handler treats every `close` as
 * final. If a transient drop surfaced as `close`, it would build a second
 * socket while the engine was already restoring the first — two live sockets
 * on one account, which the server answers with `<stream:error code="409">`.
 *
 * Needs the live mock server precisely because the offline suites cannot reach
 * these states: a socket that never connects cannot drop, and every bridge
 * call rejects immediately instead of staying pending inside wasm.
 */

import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import P from 'pino'
import { type Boom, DisconnectReason } from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient, type TestClient } from './test-client.ts'
import { type CuttableProxy, startCuttableProxy } from './tcp-proxy.ts'
import { waitForEvent } from './wait.ts'

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

type ConnectionUpdate = { connection?: string; lastDisconnect?: { error?: Error } }

const statusOf = (update: ConnectionUpdate) => (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode

/** Record every `connection.update` a socket publishes, in order. */
const recordUpdates = (client: TestClient) => {
	const updates: ConnectionUpdate[] = []
	client.sock.ev.on('connection.update', (update: ConnectionUpdate) => updates.push(update))
	return {
		all: () => updates,
		closes: () => updates.filter(update => update.connection === 'close'),
		connectings: () => updates.filter(update => update.connection === 'connecting')
	}
}

describe('E2E: connection.update contract', { timeout: 180_000 }, () => {
	let proxy: CuttableProxy
	let alice: TestClient

	before(async () => {
		// Alice reaches the mock server through a proxy we can cut, so a drop
		// happens underneath her socket with nobody asking for it.
		proxy = await startCuttableProxy()
		alice = await createTestClient({
			label: 'alice',
			folderPrefix: 'baileys-e2e-contract',
			socketUrl: proxy.url
		})
		logger.info({ alice: alice.jid, proxy: proxy.url }, 'paired through the proxy')
	})

	after(async () => {
		await destroyTestClient(alice)
		await proxy.close()
	})

	test('a transport drop reports connecting, never close, and the engine restores it', async () => {
		const seen = recordUpdates(alice)
		const connectionsBefore = proxy.connections()

		const reopened = waitForEvent(alice.sock, 'connection.update', u => u.connection === 'open', 90_000)
		proxy.cut()
		await reopened

		// A fresh TCP connection proves the engine really reconnected rather
		// than the old one having survived the cut.
		expect(proxy.connections() > connectionsBefore).toBe(true)
		// The whole point: an upstream-style handler keyed on `close` must not
		// have fired, or it would have built a second socket while the engine
		// was restoring this one.
		expect(seen.closes().length).toBe(0)
		expect(seen.connectings().length > 0).toBe(true)
		expect(alice.sock.isConnected).toBe(true)
	})

	test('the retrying update clears the spent QR', async () => {
		const seen = recordUpdates(alice)

		const reopened = waitForEvent(alice.sock, 'connection.update', u => u.connection === 'open', 90_000)
		proxy.cut()
		await reopened

		const connecting = seen.connectings()[0] as { qr?: string } | undefined
		if (!connecting) throw new Error('expected a connecting update')
		// A consumer merging partial state would otherwise keep rendering a QR
		// the server has already rotated away.
		expect(connecting.qr).toBe(undefined)
	})

	test('messages still flow after the engine-driven reconnect', async () => {
		// Proves the restored socket is a working one, not just an `open` event:
		// a second socket fighting for the session would have been kicked with
		// `<stream:error code="409">` by now.
		const bob = await createTestClient({ label: 'bob', folderPrefix: 'baileys-e2e-contract' })
		try {
			const text = `contract-${Date.now()}`
			const received = waitForEvent(
				bob.sock,
				'messages.upsert',
				upsert =>
					upsert.messages.some(
						m => !m.key?.fromMe && (m.message?.conversation || m.message?.extendedTextMessage?.text) === text
					),
				30_000
			)
			await alice.sock.sendMessage(bob.jid, { text })
			await received
		} finally {
			await destroyTestClient(bob)
		}
	})
})

describe('E2E: teardown with a live connection', { timeout: 120_000 }, () => {
	test('end() with a bridge call in flight does not corrupt the wasm heap', async () => {
		// A regression guard for the teardown ordering, not a reproduction of
		// the heap bug — worth stating plainly, because it passes with
		// `end()`'s `await client.disconnect()` reverted.
		//
		// Freeing a client with a call still pending does corrupt the wasm heap
		// (`__tests__/bridge-free-safety.test.ts` reproduces it directly), but
		// `end()` drops the transport via `ws.close()` first, so pending calls
		// reject before the free. The link is black-holed here to keep those
		// calls outstanding for as long as possible — the closest this suite
		// can get to the hazard through the public API. What it pins down is
		// that a teardown racing in-flight work stays clean.
		const proxy = await startCuttableProxy()
		const client = await createTestClient({
			label: 'inflight',
			folderPrefix: 'baileys-e2e-contract',
			socketUrl: proxy.url
		})
		try {
			proxy.freeze()

			// Requests leave, replies never come back: these stay pending inside
			// wasm for the whole teardown.
			void client.sock.groupFetchAllParticipating().catch(() => {})
			void client.sock.fetchBlocklist().catch(() => {})
			void client.sock.onWhatsApp('5599999999999').catch(() => {})
			await new Promise(resolve => setTimeout(resolve, 500))

			client.sock.setAutoReconnect(false)
			await client.sock.end(undefined).catch(() => {})

			// A corrupted heap surfaces asynchronously; give it room to land.
			await new Promise(resolve => setTimeout(resolve, 3000))
		} finally {
			try {
				await destroyTestClient(client)
			} catch {
				/* already ended */
			}
			await proxy.close()
		}
	})

	test('logout() reports exactly one close, with loggedOut', async () => {
		// `Client::logout()` dispatches `LoggedOut` before awaiting its own
		// `disconnect()`, so the terminal-close path re-enters `end()` while
		// `await sock.logout()` is still running. Two hazards: a duplicate
		// synthetic close, and `free()` racing the in-flight call.
		const client = await createTestClient({ label: 'logout', folderPrefix: 'baileys-e2e-contract' })
		const seen = recordUpdates(client)
		try {
			await client.sock.logout().catch(() => {})
			await new Promise(resolve => setTimeout(resolve, 1500))

			const closes = seen.closes()
			expect(closes.length).toBe(1)
			expect(statusOf(closes[0]!)).toBe(DisconnectReason.loggedOut)
		} finally {
			try {
				await destroyTestClient(client)
			} catch {
				/* already ended */
			}
		}
	})

	test('setAutoReconnect(false) turns a drop into a terminal close', async () => {
		// `client/lifecycle.rs` dispatches `Disconnected` and only THEN tests
		// the flag and breaks out of the run loop. Reporting `connecting` there
		// would leave the socket in that state forever, with the wasm client
		// never freed and the consumer's reconnect handler never firing.
		const proxy = await startCuttableProxy()
		const client = await createTestClient({
			label: 'noreconnect',
			folderPrefix: 'baileys-e2e-contract',
			socketUrl: proxy.url
		})
		const seen = recordUpdates(client)
		try {
			client.sock.setAutoReconnect(false)

			const closed = waitForEvent(client.sock, 'connection.update', u => u.connection === 'close', 60_000)
			proxy.cut()
			await closed

			const closes = seen.closes()
			expect(closes.length > 0).toBe(true)
			expect(statusOf(closes[0]!)).toBe(DisconnectReason.connectionClosed)
		} finally {
			try {
				await destroyTestClient(client)
			} catch {
				/* already ended */
			}
			await proxy.close()
		}
	})
})
