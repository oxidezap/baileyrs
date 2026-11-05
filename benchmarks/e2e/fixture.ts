import assert from 'node:assert/strict'
import { withDeadline } from '../deadline.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
	createTestClient as createSharedClient,
	type CreateTestClientOptions,
	type TestClient
} from '../../src/__tests__/e2e/test-client.ts'
import type { WAMessage } from '../../src/index.ts'

export async function createTestClient(options: CreateTestClientOptions): Promise<TestClient> {
	requireMock()
	const authFolder = options.authFolder ?? (await mkdtemp(join(tmpdir(), 'baileyrs-bench-')))
	try {
		return await createSharedClient({ ...options, authFolder, connectTimeoutMs: 120_000 })
	} catch (error) {
		await rm(authFolder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
		throw error
	}
}

// Benchmarks must fail on shutdown/durability errors instead of silently
// accepting a leaked client or an auth store that did not flush.
export async function destroyTestClient(client: TestClient): Promise<void> {
	client.sock.setAutoReconnect(false)
	try {
		await client.sock.end(undefined)
	} finally {
		await rm(client.authFolder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
	}
}
export type { TestClient }
let sequence = 0
export const idleMs = 1000

export function requireMock(): void {
	const url = new URL(process.env.SOCKET_URL ?? '')
	if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
		throw new Error('Benchmarks require a local Bartender, never a live WhatsApp endpoint')
	}
	if (process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') {
		throw new Error('Set the documented mock ADV_SECRET_KEY')
	}
}

export async function roundtrip(
	sender: TestClient,
	receiver: TestClient,
	size = 64,
	destination = receiver.jid
): Promise<WAMessage> {
	const prefix = `bench-${++sequence}-`
	const text = prefix.padEnd(size, 'x')
	let listener: ((data: { messages: WAMessage[] }) => void) | undefined
	const received = new Promise<WAMessage>(resolve => {
		listener = data => {
			const message = data.messages.find(
				m => !m.key.fromMe && (m.message?.conversation ?? m.message?.extendedTextMessage?.text) === text
			)
			if (message) resolve(message)
		}
		receiver.sock.ev.on('messages.upsert', listener)
	})
	try {
		return await withDeadline(
			async () => {
				const sent = await sender.sock.sendMessage(destination, { text })
				const message = await received
				assert.ok(sent?.key.id)
				assert.equal(message.key.id, sent.key.id)
				return message
			},
			60_000,
			() => destroyClients([sender, receiver])
		)
	} finally {
		if (listener) receiver.sock.ev.off('messages.upsert', listener)
	}
}

export async function destroyClients(clients: TestClient[]): Promise<void> {
	const results = await Promise.allSettled(clients.map(client => destroyTestClient(client)))
	const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
	if (errors.length) throw new AggregateError(errors, 'Benchmark teardown failed')
}

export async function warmedPair(): Promise<[TestClient, TestClient]> {
	const a = await createTestClient({ label: 'bench-a' })
	try {
		const b = await createTestClient({ label: 'bench-b' })
		try {
			for (let i = 0; i < 8; i++) {
				await roundtrip(a, b)
				await roundtrip(b, a)
			}
			return [a, b]
		} catch (error) {
			await destroyTestClient(b)
			throw error
		}
	} catch (error) {
		await destroyTestClient(a)
		throw error
	}
}

export async function idle(client: TestClient): Promise<void> {
	assert.ok(client.sock.user?.id)
	let closed = false
	const listener = (update: { connection?: string }) => {
		if (update.connection === 'close') closed = true
	}
	client.sock.ev.on('connection.update', listener)
	try {
		await delay(idleMs)
		assert.equal(closed, false, 'session closed during idle')
	} finally {
		client.sock.ev.off('connection.update', listener)
	}
}
