/**
 * A bridge rejection has to point at the code that made the call.
 *
 * The engine builds its rejection inside wasm, in a microtask continuation
 * that runs after the response arrives: V8 captures the stack there, so the
 * error reaches the consumer with glue and `wasm://` frames only and not one
 * frame of the caller. A bot cannot tell which command triggered a
 * `server error 429` from that.
 *
 * The socket therefore recreates the error at the JS boundary the caller
 * awaited (`Socket/bridge-error-boundary.ts`): V8's async stack walk then
 * names the awaiting caller, the enumerable payload crosses untouched, and
 * the original error rides along as `cause` with its wasm stack intact.
 *
 * This file drives the real bridge through the real public surface, offline
 * against a dead loopback port, because the symptom lives in where the stack
 * is captured and only the real wasm boundary reproduces that.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import P from 'pino'

import { makeWASocket, type WASocket } from '../index.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { expect } from './expect.ts'

describe('bridge rejections carry a caller stack', { timeout: 60_000 }, () => {
	let folder: string
	let sock: WASocket

	before(async () => {
		folder = await mkdtemp(join(tmpdir(), 'baileyrs-callerstack-'))
		const { state } = await useMultiFileAuthState(folder)
		sock = makeWASocket({
			auth: state,
			logger: P({ level: 'silent' }) as never,
			waWebSocketUrl: 'ws://127.0.0.1:1',
			shouldSyncHistoryMessage: () => false
		})
	})

	after(async () => {
		await sock.end(undefined)
		await rm(folder, { recursive: true, force: true })
	})

	const rejectionOf = async (call: () => Promise<unknown>): Promise<Error & Record<string, unknown>> => {
		const outcome = await call().then(
			() => null,
			error => error as Error & Record<string, unknown>
		)
		if (!outcome) throw new Error('expected the call to reject offline')
		return outcome
	}

	it('names the public API caller in the stack', async () => {
		async function botCommandListaAluguel() {
			return await sock.fetchBlocklist()
		}

		const error = await rejectionOf(botCommandListaAluguel)
		expect(String(error.stack)).toContain('botCommandListaAluguel')
	})

	it('keeps the payload a consumer already inspects', async () => {
		const error = await rejectionOf(() => sock.fetchBlocklist())
		expect(error instanceof Error).toBe(true)
		expect(error.name).toBe('WhatsAppError')
		expect(error.message).toBe('not connected')
		expect(error.kind).toBe('not-connected')
	})

	it('keeps the wasm stack reachable through cause', async () => {
		const error = await rejectionOf(() => sock.fetchBlocklist())
		const cause = error.cause as Error | undefined
		expect(cause instanceof Error).toBe(true)
		expect(String(cause?.stack)).toContain('wasm://')
	})
})
