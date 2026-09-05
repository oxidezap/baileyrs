/**
 * E2E: the Noise server-cert policy, through the real socket factory.
 *
 * The offline plumbing tests prove the flag reaches the bridge constructor;
 * they never perform a handshake, so they cannot prove what the engine does
 * with it. This file pairs against the mock three times with `makeWASocket`
 * directly (not through the fixture factory, whose default opt-in would hide
 * the production default):
 *
 * - flag absent (the production default) → the mock's self-signed chain is
 *   rejected, observed as `Server certificate verification failed ... XEdDSA`
 *   in the engine log, and the socket never opens;
 * - flag explicitly `false` → same rejection;
 * - flag literal `true` → pairs and opens.
 *
 * A pairing timeout alone proves nothing (any outage times out), so the
 * strict cases assert the cert-failure log signal itself; the timeout only
 * bounds how long a broken mock gets before the case fails.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, test } from 'node:test'
import P from 'pino'
import { makeWASocket, useMultiFileAuthState } from '../../index.ts'
import { expect } from '../expect.ts'
import { attachQrAutoresponder } from './qr-autoresponder.ts'
import { waitForEvent } from './wait.ts'

type WASocket = ReturnType<typeof makeWASocket>

const socketUrl = process.env.SOCKET_URL ?? 'wss://127.0.0.1:8080/ws/chat'
/** Failure bound only: the strict proof is the log signal, not this timer. */
const CERT_FAILURE_TIMEOUT_MS = 30_000

// One shared engine logger for every socket in this file. The wasm engine
// initializes once per process with the first socket's logger, so sharing one
// capturing logger (rather than one per case) is what makes the cert-failure
// lines observable no matter which case runs first.
const captured: string[] = []
const engineLogger = P({ level: 'debug' }, {
	write: (chunk: string | Uint8Array) => {
		captured.push(String(chunk))
		return true
	}
} as never)

const certFailureLines = (from: number): string[] =>
	captured.slice(from).filter(line => /certificate verification failed/i.test(line))

const waitForCertRejection = async (from: number): Promise<string[]> => {
	const deadline = Date.now() + CERT_FAILURE_TIMEOUT_MS
	for (;;) {
		const hits = certFailureLines(from)
		if (hits.length > 0) return hits
		if (Date.now() >= deadline) {
			throw new Error('timed out waiting for the Noise cert-rejection log signal')
		}
		await new Promise<void>(resolve => setTimeout(resolve, 250))
	}
}

interface StrictClient {
	sock: WASocket
	authFolder: string
	onUpdate: (update: ConnectionUpdate) => void
	opened: boolean
	mark: number
}

const startStrictClient = async (label: string, flag: boolean | undefined): Promise<StrictClient> => {
	const authFolder = mkdtempSync(join(tmpdir(), 'baileyrs-certpolicy-'))
	const { state } = await useMultiFileAuthState(authFolder)
	const client: StrictClient = {
		sock: makeWASocket({
			auth: state,
			waWebSocketUrl: socketUrl,
			logger: engineLogger.child({ case: label }),
			...(flag === undefined ? {} : { dangerSkipCertChainVerify: flag })
		}),
		authFolder,
		onUpdate: update => {
			if (update.connection === 'open') client.opened = true
		},
		opened: false,
		mark: captured.length
	}
	client.sock.ev.on('connection.update', client.onUpdate)
	return client
}

type ConnectionUpdate = { connection?: string }

const stopClient = async (client: {
	sock: WASocket
	authFolder: string
	onUpdate?: (update: ConnectionUpdate) => void
}) => {
	if (client.onUpdate) {
		try {
			client.sock.ev.off('connection.update', client.onUpdate)
		} catch {
			/* ignore */
		}
	}
	try {
		client.sock.setAutoReconnect(false)
		await client.sock.end(undefined)
	} catch {
		/* ignore */
	}
	try {
		rmSync(client.authFolder, { recursive: true, force: true })
	} catch {
		/* ignore */
	}
}

describe('E2E: Noise server-cert policy against the mock', { timeout: 180_000 }, () => {
	test('absent flag (production default) rejects the mock chain and never opens', async () => {
		const client = await startStrictClient('absent', undefined)
		try {
			const hits = await waitForCertRejection(client.mark)
			expect(hits.length > 0).toBe(true)
			expect(hits.some(line => /XEdDSA/.test(line))).toBe(true)
			expect(client.opened).toBe(false)
		} finally {
			await stopClient(client)
		}
	})

	test('explicit false rejects the mock chain and never opens', async () => {
		const client = await startStrictClient('explicit-false', false)
		try {
			const hits = await waitForCertRejection(client.mark)
			expect(hits.length > 0).toBe(true)
			expect(hits.some(line => /XEdDSA/.test(line))).toBe(true)
			expect(client.opened).toBe(false)
		} finally {
			await stopClient(client)
		}
	})

	test('literal true pairs and opens', async () => {
		const authFolder = mkdtempSync(join(tmpdir(), 'baileyrs-certpolicy-'))
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({
				auth: state,
				waWebSocketUrl: socketUrl,
				logger: engineLogger.child({ case: 'opt-in' }),
				dangerSkipCertChainVerify: true
			})
			const detachQr = attachQrAutoresponder(sock, socketUrl)
			try {
				await waitForEvent(sock, 'connection.update', update => update.connection === 'open', 30_000)
				expect(sock.user?.id).toBeTruthy()
			} finally {
				detachQr()
				await stopClient({ sock, authFolder })
			}
		} finally {
			try {
				rmSync(authFolder, { recursive: true, force: true })
			} catch {
				/* ignore */
			}
		}
	})
})
