/**
 * Generic e2e event waiters built on the typed `BaileysEventEmitter`.
 *
 * Two primitives:
 *
 *   - `waitForEvent(sock, name, predicate?)` — fully typed via `BaileysEventMap`,
 *     resolves with the first event payload that matches the predicate.
 *
 *   - `waitForMessage(sock, predicate)` — convenience that drills into
 *     `messages.upsert` batches and resolves with the first matching individual
 *     `WAMessage`. Stub messages and real chat messages flow through the same
 *     `messages.upsert` channel, so callers just write the right predicate.
 *
 * Both reject with a descriptive error when the timeout expires (default 10 s).
 */

import type { makeWASocket } from '../../index.ts'
import type { BaileysEventMap, proto } from '../../index.ts'

type WASocket = ReturnType<typeof makeWASocket>

/**
 * Wait for the first `BaileysEventMap[E]` event on `sock` matching `predicate`.
 * Cleans up its listener on resolve, reject, and timeout — safe to call from
 * many concurrent tests without leaking handlers.
 */
export function waitForEvent<E extends keyof BaileysEventMap>(
	sock: WASocket,
	name: E,
	predicate: (data: BaileysEventMap[E]) => boolean = () => true,
	timeoutMs = 10_000
): Promise<BaileysEventMap[E]> {
	return new Promise((resolve, reject) => {
		const cleanup = () => sock.ev.off(name, listener)
		const listener = (data: BaileysEventMap[E]) => {
			if (!predicate(data)) return
			cleanup()
			clearTimeout(tid)
			resolve(data)
		}
		const tid = setTimeout(() => {
			cleanup()
			reject(new Error(`Timed out waiting for ${String(name)}`))
		}, timeoutMs)
		sock.ev.on(name, listener)
	})
}

/**
 * Drill into `messages.upsert` batches and resolve with the first individual
 * `WAMessage` matching `predicate`. Use this for both real chat messages and
 * synthesized stub messages — the predicate decides which.
 */
export function waitForMessage(
	sock: WASocket,
	predicate: (msg: proto.IWebMessageInfo) => boolean,
	timeoutMs = 10_000
): Promise<proto.IWebMessageInfo> {
	return new Promise((resolve, reject) => {
		const cleanup = () => sock.ev.off('messages.upsert', listener)
		const listener = (data: BaileysEventMap['messages.upsert']) => {
			const msg = data.messages.find(predicate)
			if (!msg) return
			cleanup()
			clearTimeout(tid)
			resolve(msg)
		}
		const tid = setTimeout(() => {
			cleanup()
			reject(new Error('Timed out waiting for messages.upsert match'))
		}, timeoutMs)
		sock.ev.on('messages.upsert', listener)
	})
}
