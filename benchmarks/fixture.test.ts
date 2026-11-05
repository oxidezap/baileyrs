import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createTestClient, idle, requireMock } from './e2e/fixture.ts'

/** A connected socket double whose transport and lifecycle events can diverge. */
function connectedClient() {
	return { sock: { user: { id: 'benchmark@s.whatsapp.net' }, ws: { isOpen: true }, ev: new EventEmitter() } }
}

test('mock guard validates the effective URL, including socket overrides', async () => {
	const originalUrl = process.env.SOCKET_URL
	const originalSecret = process.env.ADV_SECRET_KEY
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-bench-guard-'))
	// If validation regresses, a regular-file parent makes auth initialization
	// fail before the fixture could construct a socket or contact any endpoint.
	const notDirectory = join(folder, 'not-a-directory')
	await writeFile(notDirectory, '')
	try {
		process.env.SOCKET_URL = 'wss://127.0.0.1:8080/ws/chat'
		process.env.ADV_SECRET_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
		await assert.rejects(
			createTestClient({
				label: 'guard',
				socketUrl: 'wss://example.invalid/ws/chat',
				authFolder: join(notDirectory, 'auth')
			}),
			/require a local Bartender/
		)
		process.env.SOCKET_URL = 'wss://example.invalid/ws/chat'
		for (const url of ['wss://127.0.0.1:8080/ws/chat', 'ws://localhost:8080/ws/chat', 'wss://[::1]:8080/ws/chat']) {
			assert.doesNotThrow(() => requireMock(url))
		}
		assert.throws(() => requireMock('wss://localhost.example.invalid/ws/chat'), /require a local Bartender/)
	} finally {
		if (originalUrl === undefined) delete process.env.SOCKET_URL
		else process.env.SOCKET_URL = originalUrl
		if (originalSecret === undefined) delete process.env.ADV_SECRET_KEY
		else process.env.ADV_SECRET_KEY = originalSecret
		await rm(folder, { recursive: true, force: true })
	}
})

test('idle rejects an already disconnected socket and removes its observer', { timeout: 5000 }, async () => {
	const client = connectedClient()
	client.sock.ws.isOpen = false
	await assert.rejects(idle(client), /not open at start/)
	assert.equal(client.sock.ev.listenerCount('connection.update'), 0)
})

test('idle rejects a reconnect even if the connection recovers within the window', { timeout: 5000 }, async () => {
	const client = connectedClient()
	const window = idle(client)
	client.sock.ws.isOpen = false
	client.sock.ev.emit('connection.update', { connection: 'connecting' })
	client.sock.ws.isOpen = true
	client.sock.ev.emit('connection.update', { connection: 'open' })
	await assert.rejects(window, /closed or reconnected/)
	assert.equal(client.sock.ev.listenerCount('connection.update'), 0)
})

test('idle rejects a close even when transport has reopened', { timeout: 5000 }, async () => {
	const client = connectedClient()
	const window = idle(client)
	client.sock.ev.emit('connection.update', { connection: 'close' })
	client.sock.ev.emit('connection.update', { connection: 'open' })
	await assert.rejects(window, /closed or reconnected/)
	assert.equal(client.sock.ev.listenerCount('connection.update'), 0)
})

test('idle accepts a continuously open socket and removes its observer', { timeout: 5000 }, async () => {
	const client = connectedClient()
	await idle(client)
	assert.equal(client.sock.ev.listenerCount('connection.update'), 0)
})
