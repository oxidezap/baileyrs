import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import P from 'pino'
import { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import makeWASocket from '../Socket/index.ts'
import { DisconnectReason } from '../Types/index.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const silentLogger = P({ level: 'silent' })
const throwingErrorLogger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {
		throw new Error('logger failed')
	},
	child() {
		return throwingErrorLogger
	}
} as unknown as ILogger

describe('run completion lifecycle adoption', { timeout: 30_000 }, () => {
	let authFolder: string

	before(async () => {
		authFolder = await mkdtemp(join(tmpdir(), 'baileyrs-run-completion-'))
	})

	after(async () => {
		await rm(authFolder, { recursive: true, force: true })
	})

	it('owns and reports a spontaneous supervised-run exit', async () => {
		let releaseConnection!: () => void
		const connectionGate = new Promise<void>(resolve => {
			releaseConnection = resolve
		})
		let acceptConnection!: () => void
		const connectionAccepted = new Promise<void>(resolve => {
			acceptConnection = resolve
		})
		const server = createServer(socket => {
			socket.on('error', () => {})
			acceptConnection()
			void connectionGate.then(() => socket.destroy())
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('expected a local TCP address')

		let sock: ReturnType<typeof makeWASocket> | undefined
		let releaseFlush!: () => void
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const flushGate = new Promise<void>(resolve => {
				releaseFlush = resolve
			})
			let flushStarted!: () => void
			const flushStartedGate = new Promise<void>(resolve => {
				flushStarted = resolve
			})
			const store = new Proxy(state.store as object, {
				get(target, property, receiver) {
					const value = Reflect.get(target, property, receiver)
					if (property !== 'flush' || typeof value !== 'function') return value
					return async (...args: unknown[]) => {
						flushStarted()
						await flushGate
						return (value as (...values: unknown[]) => unknown).apply(target, args)
					}
				}
			}) as typeof state.store
			sock = makeWASocket({
				auth: { ...state, store },
				logger: silentLogger,
				waWebSocketUrl: `ws://127.0.0.1:${address.port}`
			})
			sock.setAutoReconnect(false)
			await connectionAccepted

			const client = sock.waClient
			if (!client) throw new Error('bridge client did not finish startup')

			let closes = 0
			const closePublished = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('spontaneous run exit was not reported')), 5_000)
				sock!.ev.on('connection.update', update => {
					if (update.connection !== 'close') return
					closes++
					clearTimeout(timeout)
					resolve()
				})
			})
			const first = client.waitForRunCompletion()
			const second = client.waitForRunCompletion()
			releaseConnection()
			const completion = await first
			expect(completion.reason).toBe('auto-reconnect-disabled')
			expect(completion.generation).toBe(0)
			expect(await second).toEqual(completion)
			expect(await client.waitForRunCompletion()).toEqual(completion)
			await flushStartedGate
			releaseFlush()
			await closePublished

			expect(closes).toBe(1)
			expect(sock.waClient).toBeUndefined()
		} finally {
			releaseConnection()
			releaseFlush()
			await sock?.end(undefined).catch(() => {})
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	})

	it('lets an explicit end own a concurrent run completion', async () => {
		let releaseConnection!: () => void
		const connectionGate = new Promise<void>(resolve => {
			releaseConnection = resolve
		})
		let acceptConnection!: () => void
		const connectionAccepted = new Promise<void>(resolve => {
			acceptConnection = resolve
		})
		const server = createServer(socket => {
			socket.on('error', () => {})
			acceptConnection()
			void connectionGate.then(() => socket.destroy())
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('expected a local TCP address')

		let sock: ReturnType<typeof makeWASocket> | undefined
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			sock = makeWASocket({
				auth: state,
				logger: silentLogger,
				waWebSocketUrl: `ws://127.0.0.1:${address.port}`
			})
			sock.setAutoReconnect(false)
			await connectionAccepted

			const client = sock.waClient
			if (!client) throw new Error('bridge client did not finish startup')

			let closes = 0
			sock.ev.on('connection.update', update => {
				if (update.connection === 'close') closes++
			})
			const completion = client.waitForRunCompletion()
			const ending = sock.end(undefined)
			releaseConnection()
			const result = await completion
			expect(result.reason).toBe('shutdown-requested')
			await ending

			expect(closes).toBe(0)
			expect(sock.waClient).toBeUndefined()
		} finally {
			releaseConnection()
			await sock?.end(undefined).catch(() => {})
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	})

	it('cleans up a rejected completion even when the logger throws', async () => {
		const originalWait = WasmWhatsAppClient.prototype.waitForRunCompletion
		WasmWhatsAppClient.prototype.waitForRunCompletion = () => Promise.reject(new Error('observation failed'))
		const server = createServer(socket => {
			socket.on('error', () => {})
			socket.destroy()
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('expected a local TCP address')

		let sock: ReturnType<typeof makeWASocket> | undefined
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			sock = makeWASocket({
				auth: state,
				logger: throwingErrorLogger,
				waWebSocketUrl: `ws://127.0.0.1:${address.port}`
			})
			let closes = 0
			const closePublished = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('rejected completion was not reported')), 5_000)
				sock!.ev.on('connection.update', update => {
					if (update.connection !== 'close') return
					closes++
					clearTimeout(timeout)
					resolve()
				})
			})

			await closePublished
			expect(closes).toBe(1)
			expect(sock.waClient).toBeUndefined()
		} finally {
			WasmWhatsAppClient.prototype.waitForRunCompletion = originalWait
			await sock?.end(undefined).catch(() => {})
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	})

	it('maps a completion cause when it wins the terminal event race', async () => {
		const originalWait = WasmWhatsAppClient.prototype.waitForRunCompletion
		WasmWhatsAppClient.prototype.waitForRunCompletion = () =>
			Promise.resolve({
				reason: 'auto-reconnect-disabled',
				generation: 0,
				protocolError: { kind: 'conflict' }
			} as never)
		const server = createServer(socket => {
			socket.on('error', () => {})
			socket.destroy()
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('expected a local TCP address')

		let sock: ReturnType<typeof makeWASocket> | undefined
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			sock = makeWASocket({
				auth: state,
				logger: silentLogger,
				waWebSocketUrl: `ws://127.0.0.1:${address.port}`
			})
			const close = new Promise<Error>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('typed completion was not reported')), 5_000)
				sock!.ev.on('connection.update', update => {
					if (update.connection !== 'close') return
					clearTimeout(timeout)
					resolve(update.lastDisconnect!.error!)
				})
			})

			const error = await close
			expect((error as { output?: { statusCode?: number } }).output?.statusCode).toBe(
				DisconnectReason.connectionReplaced
			)
			expect(
				(error as { data?: { runCompletion?: { protocolError?: { kind?: string } } } }).data?.runCompletion
					?.protocolError?.kind
			).toBe('conflict')
		} finally {
			WasmWhatsAppClient.prototype.waitForRunCompletion = originalWait
			await sock?.end(undefined).catch(() => {})
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	})
})
