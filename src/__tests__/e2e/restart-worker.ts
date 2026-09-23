// A separate process is essential: module and WASM globals must be cold on restore.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import P from 'pino'
import type * as PublicApi from '../../index.ts'
import type { makeWASocket as SocketFactory, WAMessage } from '../../index.ts'
import { attachQrAutoresponder } from './qr-autoresponder.ts'
import { waitForMessage } from './wait.ts'

const [phase, folder, format] = process.argv.slice(2)
assert.ok(folder)
assert.ok(phase === 'seed' || phase === 'restore')
assert.ok(format === 'native' || format === 'legacy')
const api: typeof PublicApi = await import(
	process.env.BAILEYRS_RESTART_ENTRY ?? new URL('../../index.ts', import.meta.url).href
)
const socketUrl = process.env.SOCKET_URL ?? 'wss://127.0.0.1:8080/ws/chat'
const logger = P({ level: 'silent' })
const sockets: ReturnType<typeof SocketFactory>[] = []
const saves: Promise<void>[] = []
const identities: Array<{ id: string; lid: string | undefined }> = []
const qrCounts = [0, 0, 0, 0]
const opens = [0, 0, 0, 0]
const stages = Array<string>(4).fill('auth')
const deadline = setTimeout(() => {
	console.error(JSON.stringify({ phase, format, stages, error: 'restart worker deadline' }))
	process.exit(1)
}, 90_000)

// Listen before startup so parent-driven shutdown cannot miss a signal.
let stop!: () => void
const stopped = new Promise<void>(resolve => {
	stop = resolve
})
process.once('SIGINT', stop)
process.stdin.resume()
try {
	const states = await Promise.all(
		Array.from({ length: 4 }, async (_, index) => {
			const path = join(folder, String(index))
			// Upstream seeds JSON auth; baileyrs must auto-wrap it on every process start.
			const loaded =
				format === 'native'
					? await api.useMultiFileAuthState(path)
					: await (await import('baileys')).useMultiFileAuthState(path)
			if (phase === 'restore') assert.equal(loaded.state.creds.registered, true)
			return loaded
		})
	)
	const results = await Promise.allSettled(
		states.map(async ({ state, saveCreds }, index) => {
			stages[index] = 'socket'
			const sock = api.makeWASocket({
				auth: state as Parameters<typeof SocketFactory>[0]['auth'],
				logger,
				waWebSocketUrl: socketUrl,
				pushName: `restart-${format}-${index}`,
				// Only the configured Bartender test endpoint is used.
				dangerSkipCertChainVerify: true
			})
			sockets[index] = sock
			sock.ev.on('creds.update', () => {
				const pending = saveCreds()
				saves.push(pending)
				void pending.catch(() => {})
			})
			if (phase === 'seed') attachQrAutoresponder(sock, socketUrl)
			await new Promise<void>((resolve, reject) => {
				let open = false
				let synced = false
				sock.ev.on('connection.update', update => {
					if (update.qr) {
						qrCounts[index]!++
						if (phase === 'restore') reject(new Error(`bot ${index} requested QR after restart`))
					}
					if (update.connection) stages[index] = update.connection
					if (update.connection === 'close') reject(update.lastDisconnect?.error ?? new Error('closed'))
					if (update.connection === 'open') {
						open = true
						opens[index]!++
					}
					if (update.receivedPendingNotifications) synced = true
					if (open && synced) resolve()
				})
			})
			assert.ok(sock.user?.id)
			identities[index] = {
				id: api.jidNormalizedUser(sock.user.id),
				lid: sock.user.lid ? api.jidNormalizedUser(sock.user.lid) : undefined
			}
		})
	)
	for (const result of results) if (result.status === 'rejected') throw result.reason

	const manifest = join(folder, 'identities.json')
	if (phase === 'seed') await writeFile(manifest, JSON.stringify(identities))
	else assert.deepEqual(identities, JSON.parse(await readFile(manifest, 'utf8')))

	const textOf = (message: WAMessage) => message.message?.conversation ?? message.message?.extendedTextMessage?.text
	// Every restored session both sends and receives; a reported open alone is insufficient.
	await Promise.all(
		sockets.map(async (sender, index) => {
			const next = (index + 1) % sockets.length
			const text = `${phase}-${format}-${process.pid}-${index}`
			const received = waitForMessage(
				sockets[next]!,
				message => !message.key.fromMe && textOf(message) === text,
				15_000
			)
			const [sent, incoming] = await Promise.all([sender.sendMessage(identities[next]!.id, { text }), received])
			assert.ok(sent?.key.id)
			assert.equal(incoming.key.id, sent.key.id)
			stages[index] = 'traffic-ok'
		})
	)
	await Promise.all(saves)
	await Promise.all(states.map(({ state }) => ('store' in state ? state.store?.flush?.() : undefined)))
	console.log(`RESTART_READY ${JSON.stringify({ phase, format, qrCounts, opens, stages })}`)
	await stopped
} finally {
	for (const sock of sockets) if (sock) sock.setAutoReconnect(false)
	await Promise.all(sockets.map(sock => sock.end(undefined)))
	await Promise.all(saves)
	clearTimeout(deadline)
	process.stdin.pause()
}
