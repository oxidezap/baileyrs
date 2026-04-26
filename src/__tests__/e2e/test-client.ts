/**
 * Shared factory for e2e bridge clients.
 *
 * Each test file used to ship its own ~25-line `createTestClient` with the
 * same boilerplate (mkdtemp + useMultiFileAuthState + makeWASocket + wait
 * for `connection.update`). They are now thin wrappers over this module.
 *
 * The `baileys-handoff` test still has its own factories (createBridgeClient
 * + createUpstreamClient) because it needs the upstream-baileys auth-state
 * format on disk and a separate sock implementation; that file uses
 * [`attachQrAutoresponder`] directly from `qr-autoresponder.ts`.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import P from 'pino'
import { Boom, DisconnectReason, jidNormalizedUser, makeWASocket, useMultiFileAuthState } from '../../index.ts'
import { attachQrAutoresponder } from './qr-autoresponder.ts'

type WASocket = ReturnType<typeof makeWASocket>

const defaultLogger = P({ level: process.env.LOG_LEVEL ?? 'warn' })
const defaultSocketUrl = process.env.SOCKET_URL ?? 'wss://127.0.0.1:8080/ws/chat'

export interface CreateTestClientOptions {
	/** Logger child name and tmp-folder slug. */
	label: string
	/** Tmp-dir prefix when auto-creating an auth folder. Default `baileys-e2e`. */
	folderPrefix?: string
	/** Override the default mock-server WebSocket URL. */
	socketUrl?: string
	/** Override the default connect timeout. Default 30_000 ms. */
	connectTimeoutMs?: number
	/** Pre-existing auth folder (rarely needed here; handoff uses its own factory). */
	authFolder?: string
}

export interface TestClient {
	sock: WASocket
	jid: string
	lid?: string
	authFolder: string
	label: string
}

/** Pair a fresh bridge client and wait until `connection.update` resolves
 * `connection === 'open'`. Auto-attaches the QR autoresponder so the
 * mock-server's scan-driven pairing flow can complete. */
export async function createTestClient(opts: CreateTestClientOptions): Promise<TestClient> {
	const folderPrefix = opts.folderPrefix ?? 'baileys-e2e'
	const folder = opts.authFolder ?? mkdtempSync(join(tmpdir(), `${folderPrefix}-${opts.label}-`))
	const url = opts.socketUrl ?? defaultSocketUrl
	const timeoutMs = opts.connectTimeoutMs ?? 30_000

	const { state } = await useMultiFileAuthState(folder)

	const sock = makeWASocket({
		auth: state,
		waWebSocketUrl: url,
		logger: defaultLogger.child({ user: opts.label })
	})

	attachQrAutoresponder(sock, url)

	const jid = await new Promise<string>((resolve, reject) => {
		const tid = setTimeout(() => reject(new Error(`${opts.label}: connect timeout`)), timeoutMs)
		sock.ev.on('connection.update', update => {
			if (update.connection === 'open') {
				clearTimeout(tid)
				resolve(jidNormalizedUser(sock.user?.id))
			} else if (update.connection === 'close') {
				const reason = (update.lastDisconnect?.error as Boom)?.output?.statusCode
				if (reason === DisconnectReason.loggedOut) {
					clearTimeout(tid)
					reject(new Error(`${opts.label}: Logged out`))
				}
			}
		})
	})

	return { sock, jid, lid: sock.user?.lid, authFolder: folder, label: opts.label }
}

/** Disable auto-reconnect, close the socket, then remove the auth folder.
 * Swallows errors so cleanup is best-effort and never fails a teardown. */
export async function destroyTestClient(client: { sock: WASocket; authFolder: string }): Promise<void> {
	try {
		client.sock.setAutoReconnect(false)
		await client.sock.end()
	} catch {
		/* ignore */
	}

	try {
		rmSync(client.authFolder, { recursive: true, force: true })
	} catch {
		/* ignore */
	}
}
