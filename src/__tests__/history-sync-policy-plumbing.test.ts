/**
 * Plumbing for the Baileys history-sync admission policy.
 *
 * The socket translates `shouldSyncHistoryMessage` into the bridge's generic
 * ninth `policies` argument. Pinned here, all offline against a dead loopback
 * port:
 *
 * - the installed bridge accepts the adapter shape as its ninth argument;
 * - an explicit `undefined` policy keeps the default instead of throwing on
 *   the first notification;
 * - a policy rejecting every processable sync type warns once at construction
 *   (upstream parity: disabling everything also drops initial LID mappings),
 *   while the default policy stays quiet.
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

import makeWASocket from '../Socket/index.ts'
import { delay } from '../Utils/generics.ts'
import type { ILogger } from '../Utils/logger.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { expect } from './expect.ts'

const warnings: unknown[][] = []
const warnLogger = {
	level: 'silent',
	child: () => warnLogger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: (...args: unknown[]) => {
		warnings.push(args)
	},
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

initWasmEngine(warnLogger)

const buildSocket = async (policy: (() => boolean) | undefined, tag: string) => {
	const authFolder = await mkdtemp(join(tmpdir(), `baileyrs-history-${tag}-`))
	const { state } = await useMultiFileAuthState(authFolder)
	const sock = makeWASocket({
		auth: state,
		logger: warnLogger,
		waWebSocketUrl: 'ws://127.0.0.1:1',
		...(policy === undefined ? {} : { shouldSyncHistoryMessage: policy })
	})
	return { authFolder, sock }
}

describe('history sync policy plumbing', { timeout: 60_000 }, () => {
	it('the bridge accepts the adapter policy shape as its ninth argument', async () => {
		// Shaped for both bridge generations: release bridges declare the
		// ninth `policies` argument, while the pinned calls-audio preview
		// still declares eight and drops extras at runtime.
		const createClientWithPolicies = createWhatsAppClient as (
			...args: [...Parameters<typeof createWhatsAppClient>, { historySyncAdmission: () => boolean }?]
		) => ReturnType<typeof createWhatsAppClient>
		const client = await createClientWithPolicies(
			deadTransport(),
			deadHttp(),
			null,
			memoryStore(),
			null,
			undefined,
			null,
			null,
			{ historySyncAdmission: () => true }
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

	it('an explicit undefined policy keeps the default and initializes', async () => {
		const { authFolder, sock } = await buildSocket(undefined, 'undefined')
		try {
			for (let i = 0; i < 100 && !sock.waClient; i++) await delay(50)
			expect(Boolean(sock.waClient)).toBe(true)
		} finally {
			await sock.end(undefined)
			await rm(authFolder, { recursive: true, force: true })
		}
	})

	it('a policy disabling every sync type warns once at construction', async () => {
		warnings.length = 0
		const { authFolder, sock } = await buildSocket(() => false, 'disabled')
		try {
			for (let i = 0; i < 100 && !sock.waClient; i++) await delay(50)
			expect(Boolean(sock.waClient)).toBe(true)
			expect(warnings.some(args => String(args[args.length - 1]).includes('DISABLING ALL SYNC'))).toBe(true)
		} finally {
			await sock.end(undefined)
			await rm(authFolder, { recursive: true, force: true })
		}
	})

	it('the default policy stays quiet', async () => {
		warnings.length = 0
		const { authFolder, sock } = await buildSocket(undefined, 'default')
		try {
			for (let i = 0; i < 100 && !sock.waClient; i++) await delay(50)
			expect(Boolean(sock.waClient)).toBe(true)
			expect(warnings.some(args => String(args[args.length - 1]).includes('DISABLING ALL SYNC'))).toBe(false)
		} finally {
			await sock.end(undefined)
			await rm(authFolder, { recursive: true, force: true })
		}
	})
})
