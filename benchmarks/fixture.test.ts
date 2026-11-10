import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createTestClient, requireMock } from './e2e/fixture.ts'

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
