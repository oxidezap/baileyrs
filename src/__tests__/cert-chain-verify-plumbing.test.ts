/**
 * Plumbing for the testing-only Noise cert-chain bypass.
 *
 * The bridge verifies the server cert chain strictly unless
 * `createWhatsAppClient` receives a literal `true` as its 8th argument; any
 * other truthy value rejects the construction as `invalid-argument` instead
 * of opting in. The socket exposes this as the optional per-socket
 * `dangerSkipCertChainVerify` flag and forwards it unchanged.
 *
 * What is pinned here, all offline against a dead loopback port:
 *
 * - the default config carries no opt-in, so a socket built without the flag
 *   constructs exactly like strict;
 * - `false`/`null`/absent construct fine at the bridge (strictness itself is
 *   proven against the mock in e2e: strict rejects, `true` pairs);
 * - malformed truthy values (`'true'`, `1`) reject — directly with
 *   `invalid-argument`, and through the socket factory as a failed
 *   initialization rather than a socket that pairs.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
	createWhatsAppClient,
	initWasmEngine,
	type JsHttpClientConfig,
	type JsStoreCallbacks,
	type JsTransportCallbacks
} from '@oxidezap/whatsapp-rust-bridge'

import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import makeWASocket from '../Socket/index.ts'
import { delay } from '../Utils/generics.ts'
import type { ILogger } from '../Utils/logger.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { expect } from './expect.ts'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as unknown as ILogger

const deadTransport = (): JsTransportCallbacks => ({
	connect: async () => undefined,
	send: async () => undefined,
	disconnect: async () => undefined
})

const deadHttp = (): JsHttpClientConfig => ({
	execute: async () => ({ statusCode: 503, body: new Uint8Array() })
})

const memoryStore = (): JsStoreCallbacks => ({
	get: async () => null,
	set: async () => undefined,
	delete: async () => undefined
})

initWasmEngine(silentLogger)

describe('cert chain verification bypass plumbing', { timeout: 60_000 }, () => {
	it('the default config carries no opt-in', () => {
		expect(DEFAULT_CONNECTION_CONFIG.dangerSkipCertChainVerify).toBe(undefined)
	})

	for (const label of ['absent', 'null', 'false', 'true'] as const) {
		it(`bridge construction accepts ${label} (strict unless literal true)`, async () => {
			const eighth = label === 'absent' ? undefined : label === 'null' ? null : label === 'true'
			const client = await createWhatsAppClient(
				deadTransport(),
				deadHttp(),
				null,
				memoryStore(),
				null,
				undefined,
				null,
				eighth
			)
			try {
				expect(typeof client.disconnect).toBe('function')
			} finally {
				try {
					await client.disconnect()
				} catch {
					/* ignore */
				}
				client.free()
			}
		})
	}

	for (const malformed of ['true', 1] as const) {
		it(`bridge construction rejects malformed ${JSON.stringify(malformed)} as invalid-argument, never as opt-in`, async () => {
			const outcome = await createWhatsAppClient(
				deadTransport(),
				deadHttp(),
				null,
				memoryStore(),
				null,
				undefined,
				null,
				malformed as unknown as boolean
			).then(
				client => {
					client.free()
					return { settled: 'resolved' } as const
				},
				(error: { kind?: unknown }) => ({ settled: 'rejected', kind: error?.kind }) as const
			)

			expect(outcome.settled).toBe('rejected')
			expect(outcome.settled === 'rejected' ? outcome.kind : undefined).toBe('invalid-argument')
		})
	}

	for (const flag of [undefined, false, true] as const) {
		it(`socket factory with ${String(flag)} initializes its bridge client`, async () => {
			const authFolder = await mkdtemp(join(tmpdir(), 'baileyrs-certflag-'))
			try {
				const { state } = await useMultiFileAuthState(authFolder)
				const sock = makeWASocket({
					auth: state,
					logger: silentLogger,
					waWebSocketUrl: 'ws://127.0.0.1:1',
					...(flag === undefined ? {} : { dangerSkipCertChainVerify: flag })
				})
				try {
					for (let i = 0; i < 100 && !sock.waClient; i++) await delay(50)
					expect(Boolean(sock.waClient)).toBe(true)
				} finally {
					await sock.end(undefined)
				}
			} finally {
				await rm(authFolder, { recursive: true, force: true })
			}
		})
	}

	for (const malformed of ['true', 1] as const) {
		it(`socket factory with malformed ${JSON.stringify(malformed)} fails initialization instead of pairing`, async () => {
			const authFolder = await mkdtemp(join(tmpdir(), 'baileyrs-certflag-'))
			try {
				const { state } = await useMultiFileAuthState(authFolder)
				const sock = makeWASocket({
					auth: state,
					logger: silentLogger,
					waWebSocketUrl: 'ws://127.0.0.1:1',
					dangerSkipCertChainVerify: malformed as unknown as boolean
				})
				try {
					sock.setAutoReconnect(false)
					const error = await sock
						.query({ tag: 'iq', attrs: { id: 'cert-flag-probe', type: 'get', xmlns: 'test' } }, 1000)
						.then(
							() => undefined,
							err => err as Error
						)
					expect(error).toBeDefined()
					expect(String((error as Error)?.message)).toContain('failed to initialize')
				} finally {
					await sock.end(undefined)
				}
			} finally {
				await rm(authFolder, { recursive: true, force: true })
			}
		})
	}
})
