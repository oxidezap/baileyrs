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

/** Create a loopback mock client, removing its auth directory if setup fails. */
export async function createTestClient(options: CreateTestClientOptions): Promise<TestClient> {
	const socketUrl = options.socketUrl ?? process.env.SOCKET_URL ?? ''
	requireMock(socketUrl)
	const authFolder = options.authFolder ?? (await mkdtemp(join(tmpdir(), 'baileyrs-bench-')))
	try {
		return await createSharedClient({ ...options, socketUrl, authFolder, connectTimeoutMs: 120_000 })
	} catch (error) {
		await rm(authFolder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
		throw error
	}
}

/**
 * Disable reconnect, await socket shutdown, then remove the auth directory.
 * Propagate shutdown or persistence failures so a broken teardown fails the benchmark.
 */
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

/** Reject non-loopback endpoints and configurations without the synthetic mock secret. */
export function requireMock(socketUrl = process.env.SOCKET_URL ?? ''): void {
	const url = new URL(socketUrl)
	if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
		throw new Error('Benchmarks require a local Bartender, never a live WhatsApp endpoint')
	}
	if (process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') {
		throw new Error('Set the documented mock ADV_SECRET_KEY')
	}
}

/**
 * Send a unique fixed-width text and return its matching receiver event.
 * The deadline covers send and delivery; expiry closes both clients, and every
 * exit removes the receiver listener. An optional destination selects a group.
 */
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

/** Attempt every client teardown and aggregate failures after all attempts settle. */
export async function destroyClients(clients: TestClient[]): Promise<void> {
	const results = await Promise.allSettled(clients.map(client => destroyTestClient(client)))
	const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
	if (errors.length) throw new AggregateError(errors, 'Benchmark teardown failed')
}

/**
 * Pair two fresh clients and deliver eight DMs in each direction before measurement.
 * If setup fails, tear down both clients before propagating the failure.
 */
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

/** Minimal transport and event surface observed by the idle assertion. */
interface IdleClient {
	sock: {
		user?: { id: string }
		ws: { readonly isOpen: boolean }
		ev: {
			on(event: 'connection.update', listener: (update: { connection?: string }) => void): unknown
			off(event: 'connection.update', listener: (update: { connection?: string }) => void): unknown
		}
	}
}

/** Observe a continuously open idle window, rejecting closes and reconnects. */
export async function idle(client: IdleClient): Promise<void> {
	let interrupted = false
	const listener = (update: { connection?: string }) => {
		if (update.connection === 'close' || update.connection === 'connecting') interrupted = true
	}
	client.sock.ev.on('connection.update', listener)
	try {
		assert.ok(client.sock.user?.id)
		assert.equal(client.sock.ws.isOpen, true, 'session is not open at start of idle')
		await delay(idleMs)
		assert.equal(interrupted, false, 'session closed or reconnected during idle')
		assert.equal(client.sock.ws.isOpen, true, 'session is not open at end of idle')
	} finally {
		client.sock.ev.off('connection.update', listener)
	}
}
