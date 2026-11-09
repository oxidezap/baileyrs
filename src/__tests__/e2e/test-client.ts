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

import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import P from 'pino'
import {
	type Boom,
	DisconnectReason,
	jidNormalizedUser,
	makeWASocket,
	useMemoryStore,
	useMultiFileAuthState
} from '../../index.ts'
import { createDeviceProjection } from '../../Compatibility/legacy-store/device.ts'
import { projectNativeStore } from '../../Compatibility/legacy-store/native-projection.ts'
import { initAuthCreds } from '../../Utils/generics.ts'
import { attachQrAutoresponder } from './qr-autoresponder.ts'
import { waitForEvent } from './wait.ts'

type WASocket = ReturnType<typeof makeWASocket>

const diagnosticGenerations = new Map<string, number>()
const diagnosticStores = new Map<string, ReturnType<typeof useMemoryStore>>()

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
	/**
	 * Called with the socket before anything is attached to it.
	 *
	 * The bootstrap `connecting` is published from a microtask queued during
	 * `makeWASocket`, so a listener attached after this factory returns has
	 * already missed it. Anything judging the lifecycle from its first event
	 * has to get in here.
	 */
	onSocket?: (sock: WASocket) => void
}

export interface TestClient {
	sock: WASocket
	jid: string
	lid?: string
	authFolder: string
	label: string
}

/** Pair a fresh bridge client and wait for both `connection === 'open'` and
 * `receivedPendingNotifications === true`. Auto-attaches the QR autoresponder
 * so the mock-server's scan-driven pairing flow can complete. */
export async function createTestClient(opts: CreateTestClientOptions): Promise<TestClient> {
	const folderPrefix = opts.folderPrefix ?? 'baileys-e2e'
	const folder = opts.authFolder ?? mkdtempSync(join(tmpdir(), `${folderPrefix}-${opts.label}-`))
	const url = opts.socketUrl ?? defaultSocketUrl
	const timeoutMs = opts.connectTimeoutMs ?? 30_000

	const memoryControl = process.env.DIAGNOSTIC_REUSABLE_MEMORY === '1'
	if (
		memoryControl &&
		(process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' ||
			!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
	)
		throw new Error('synthetic mock required')
	if (memoryControl) diagnosticGenerations.set(folder, (diagnosticGenerations.get(folder) ?? 0) + 1)
	let memoryStore = diagnosticStores.get(folder)
	if (memoryControl && !memoryStore) {
		memoryStore = useMemoryStore()
		if (
			process.env.DIAGNOSTIC_MEMORY_YIELD === '1' &&
			(!process.env.DIAGNOSTIC_MEMORY_YIELD_TARGET || process.env.DIAGNOSTIC_MEMORY_YIELD_TARGET === opts.label)
		) {
			for (const method of ['get', 'getMany', 'set', 'setMany', 'delete', 'deleteMany'] as const) {
				const original = memoryStore[method]!.bind(memoryStore) as (...args: unknown[]) => Promise<unknown>
				Object.assign(memoryStore, {
					[method]: async (...args: unknown[]) => {
						const result = await original(...args)
						const phase = process.env.DIAGNOSTIC_MEMORY_YIELD_PHASE
						const generation = diagnosticGenerations.get(folder) ?? 0
						if (!phase || (phase === 'before' && generation === 1) || (phase === 'after' && generation > 1))
							await yieldTurn()
						return result
					}
				})
			}
		}
		diagnosticStores.set(folder, memoryStore)
	}
	const memoryAuth = async () => {
		const store = memoryStore!
		const creds = initAuthCreds()
		const projection = createDeviceProjection(creds)
		for (const key of ['device', 'account'] as const) {
			const value = await store.get('device', key)
			if (value) projection.prepare(key, value)()
		}
		return { store, creds, keys: projectNativeStore(store, creds) }
	}
	const state = memoryControl ? await memoryAuth() : (await useMultiFileAuthState(folder)).state

	const sock = makeWASocket({
		auth: state,
		pushName: basename(folder),
		waWebSocketUrl: url,
		// The corrected mock serves static media at this exact HTTPS authority.
		additionalStaticMediaHosts: [new URL(url).host],
		// Test-only: the mock server's cert is self-signed and strict
		// verification (the default) rejects it. Production code must never set this.
		dangerSkipCertChainVerify: true,
		logger: defaultLogger.child({ user: opts.label })
	})

	;(globalThis as typeof globalThis & { __ackReasonSocket?: (socket: typeof sock) => void }).__ackReasonSocket?.(sock)
	opts.onSocket?.(sock)
	attachQrAutoresponder(sock, url)
	const startupSync = waitForEvent(
		sock,
		'connection.update',
		update => update.receivedPendingNotifications === true,
		timeoutMs
	)

	const connected = new Promise<string>((resolve, reject) => {
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
	try {
		const [jid] = await Promise.all([connected, startupSync])
		return { sock, jid, lid: sock.user?.lid, authFolder: folder, label: opts.label }
	} catch (error) {
		// A failed factory has no returned owner to tear down its live socket.
		sock.setAutoReconnect(false)
		await sock.end(undefined)
		throw error
	}
}

/** Disable auto-reconnect, close the socket, then remove the auth folder.
 * Swallows errors so cleanup is best-effort and never fails a teardown. */
export async function destroyTestClient(client: { sock: WASocket; authFolder: string }): Promise<void> {
	try {
		client.sock.setAutoReconnect(false)
		await client.sock.end(undefined)
	} catch {
		/* ignore */
	}

	try {
		await rm(client.authFolder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
	} catch {
		/* ignore */
	}
}
