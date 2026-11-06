import assert from 'node:assert/strict'
import { withDeadline } from '../deadline.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import {
	createTestClient as createSharedClient,
	type CreateTestClientOptions,
	type TestClient
} from '../../src/__tests__/e2e/test-client.ts'
import type { WAMessage } from '../../src/index.ts'

/** Last time any benchmark socket sent or received a frame. */
let lastSocketActivity = performance.now()
let trackingInstalled = false

/**
 * Record socket traffic so {@link settle} can tell when the clients are quiet.
 * The transport looks up the global `WebSocket` on every connect, so a subclass
 * installed before the first client sees every frame of every client. The
 * per-frame cost is one timestamp, the same for base and head.
 */
function trackSocketActivity(): void {
	if (trackingInstalled) return
	trackingInstalled = true
	const NativeWebSocket = globalThis.WebSocket
	class TrackedWebSocket extends NativeWebSocket {
		constructor(...args: ConstructorParameters<typeof WebSocket>) {
			super(...args)
			this.addEventListener('message', () => {
				lastSocketActivity = performance.now()
			})
		}
		override send(data: Parameters<WebSocket['send']>[0]): void {
			lastSocketActivity = performance.now()
			super.send(data)
		}
	}
	globalThis.WebSocket = TrackedWebSocket
}

export const settleQuietMs = 750
export const settleMaxMs = 20_000

/**
 * Wait until no socket has sent or received a frame for {@link settleQuietMs}
 * and the event loop was mostly idle over that window.
 *
 * Receipts, acks, pre-key uploads and server notifications keep arriving after
 * an operation's own promise resolves. Without this, a variable part of that
 * tail lands inside the next measured call. Call it outside measurement only.
 * It gives up after {@link settleMaxMs} instead of failing: a busy session
 * makes the row noisier, not wrong.
 */
export async function settle(quietMs = settleQuietMs, maxMs = settleMaxMs): Promise<void> {
	const deadline = performance.now() + maxMs
	while (performance.now() < deadline) {
		const loop = performance.eventLoopUtilization()
		await delay(quietMs)
		const busy = performance.eventLoopUtilization(loop).utilization
		if (performance.now() - lastSocketActivity >= quietMs && busy < 0.5) return
	}
}

/** Create a loopback mock client, removing its auth directory if setup fails. */
export async function createTestClient(options: CreateTestClientOptions): Promise<TestClient> {
	const socketUrl = options.socketUrl ?? process.env.SOCKET_URL ?? ''
	requireMock(socketUrl)
	trackSocketActivity()
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
 * Send a unique fixed-width text and return the first receiver's matching event.
 *
 * The call completes only when every receiver has published the message and
 * the sender has processed a delivery receipt from each of them, so the whole
 * exchange is inside the call and none of it spills into the next one.
 * The deadline covers send, delivery and receipts; expiry closes every client,
 * and every exit removes the listeners. An optional destination selects a group.
 */
export async function roundtrip(
	sender: TestClient,
	receivers: TestClient | TestClient[],
	size = 64,
	destination?: string
): Promise<WAMessage> {
	const targets = Array.isArray(receivers) ? receivers : [receivers]
	const to = destination ?? targets[0]!.jid
	const prefix = `bench-${++sequence}-`
	const text = prefix.padEnd(size, 'x')
	const cleanups: (() => void)[] = []
	const deliveries = targets.map(
		receiver =>
			new Promise<WAMessage>(resolve => {
				const listener = (data: { messages: WAMessage[] }) => {
					const message = data.messages.find(
						m => !m.key.fromMe && (m.message?.conversation ?? m.message?.extendedTextMessage?.text) === text
					)
					if (message) resolve(message)
				}
				receiver.sock.ev.on('messages.upsert', listener)
				cleanups.push(() => receiver.sock.ev.off('messages.upsert', listener))
			})
	)
	// Receipts can arrive before sendMessage resolves, so record them by ID
	// from the start and match the sent ID afterwards.
	const receipts = new Map<string, Set<string>>()
	let sentId: string | undefined
	let receiptsDone: (() => void) | undefined
	const allReceipts = new Promise<void>(resolve => {
		receiptsDone = resolve
	})
	const checkReceipts = () => {
		if (sentId && (receipts.get(sentId)?.size ?? 0) >= targets.length) receiptsDone!()
	}
	const onReceipt = (
		updates: { key: { id?: string | null; participant?: string | null }; receipt: { receiptTimestamp?: unknown } }[]
	) => {
		for (const { key, receipt } of updates) {
			if (!key.id || receipt.receiptTimestamp == null) continue
			let from = receipts.get(key.id)
			if (!from) receipts.set(key.id, (from = new Set()))
			from.add(key.participant ?? '')
		}
		checkReceipts()
	}
	sender.sock.ev.on('message-receipt.update', onReceipt)
	cleanups.push(() => sender.sock.ev.off('message-receipt.update', onReceipt))
	try {
		return await withDeadline(
			async () => {
				const sent = await sender.sock.sendMessage(to, { text })
				assert.ok(sent?.key.id)
				sentId = sent.key.id
				checkReceipts()
				const messages = await Promise.all(deliveries)
				for (const message of messages) assert.equal(message.key.id, sent.key.id)
				await allReceipts
				return messages[0]!
			},
			60_000,
			() => destroyClients([sender, ...targets])
		)
	} finally {
		for (const cleanup of cleanups) cleanup()
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
			await settle()
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
