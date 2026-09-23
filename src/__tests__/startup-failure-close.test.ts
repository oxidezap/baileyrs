import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import P from 'pino'
import { createWASocketFactory } from '../Socket/core.ts'
import { nodeRuntime } from '../Runtime/node.ts'
import { makeWASocket, initAuthCreds, useMemoryStore } from '../index.ts'
import type { ConnectionState } from '../Types/index.ts'

const logger = P({ level: 'silent' })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

// Observe the consumer's public lifecycle, with the real WASM constructor.
// No network should be needed to learn that restoration failed.
describe('startup failures close the socket', { timeout: 10_000 }, () => {
	it('announces connecting while native auth hydration is still pending', async () => {
		let finishRead!: (value: null) => void
		const read = new Promise<null>(resolve => {
			finishRead = resolve
		})
		const sock = makeWASocket({
			// @ts-expect-error Store-only auth is supported at runtime; the public auth intersection omits it.
			auth: { store: { ...useMemoryStore(), get: () => read } },
			logger
		})
		const updates: Partial<ConnectionState>[] = []
		sock.ev.on('connection.update', update => updates.push(update))
		try {
			await tick()
			assert.deepEqual(
				updates.map(update => update.connection),
				['connecting']
			)
		} finally {
			const ending = sock.end(undefined)
			finishRead(null)
			await ending
		}
	})

	for (const stage of ['hydration', 'construction'] as const) {
		it(`reports all four concurrent ${stage} failures and drains stores first`, async () => {
			const sockets: ReturnType<typeof makeWASocket>[] = []
			let constructionFailure = 0
			const factory =
				stage === 'construction'
					? createWASocketFactory({
							...nodeRuntime,
							bridge: {
								...nodeRuntime.bridge,
								async createWhatsAppClient() {
									throw new Error(`construction-${constructionFailure++}-failed`)
								}
							}
						})
					: makeWASocket
			try {
				await Promise.all(
					Array.from({ length: 4 }, async (_, index) => {
						let flushed = false
						let ended = false
						const store = {
							...useMemoryStore(),
							async get() {
								if (stage === 'hydration') throw new Error(`restore-${index}-failed`)
								return undefined
							},
							async flush() {
								await tick()
								flushed = true
							}
						}
						const sock = factory({
							// @ts-expect-error Store-only auth is supported at runtime; the public auth intersection omits it.
							auth:
								stage === 'hydration'
									? { store }
									: {
											store,
											creds: initAuthCreds(),
											keys: { get: async () => ({}), set: async () => {} }
										},
							logger,
							waWebSocketUrl: 'ws://127.0.0.1:1'
						})
						sockets.push(sock)
						const updates: Partial<ConnectionState>[] = []
						let atClose: { flushed: boolean; ended: boolean } | undefined
						sock.registerSocketEndHandler(() => {
							ended = true
						})
						sock.ev.on('connection.update', update => {
							updates.push(update)
							if (update.connection === 'close') atClose = { flushed, ended }
						})
						const failure = stage === 'hydration' ? `restore-${index}-failed` : `construction-${index}-failed`
						const closed = sock.waitForConnectionUpdate(async () => false, 1_000)
						const observed = assert.rejects(closed, error => {
							assert.ok(error instanceof Error)
							assert.ok(error.cause instanceof Error)
							assert.equal(error.cause.message, failure)
							return true
						})
						await assert.rejects(sock.getJid(), /failed to initialize/)
						await observed
						assert.deepEqual(atClose, { flushed: true, ended: true })
						await sock.end(undefined)
						await tick()
						assert.deepEqual(
							updates.map(update => update.connection),
							['connecting', 'close']
						)
						assert.equal(updates.filter(update => update.connection === 'close').length, 1)
						assert.equal(
							updates.some(update => update.connection === 'open'),
							false
						)
						assert.equal(sock.waClient, undefined)
					})
				)
			} finally {
				await Promise.all(sockets.map(sock => sock.end(undefined)))
			}
		})
	}

	it('reports an engine failure even when the consumer logger throws', async () => {
		const failure = new Error('engine initialization failed')
		const factory = createWASocketFactory({
			...nodeRuntime,
			bridge: {
				...nodeRuntime.bridge,
				initWasmEngine() {
					throw failure
				}
			}
		})
		const sock = factory({
			auth: { creds: initAuthCreds(), keys: { get: async () => ({}), set: async () => {} } },
			logger: {
				...logger,
				level: 'silent',
				trace() {},
				warn() {},
				debug() {},
				error() {
					throw new Error('logger failed')
				}
			}
		})
		try {
			const closed = sock.waitForConnectionUpdate(async () => false, 1_000)
			await assert.rejects(closed, /engine initialization failed/)
		} finally {
			await sock.end(undefined)
		}
	})

	it('releases an adopted client before publishing its startup error', async () => {
		const failure = new Error('device props failed')
		let freed = false
		const factory = createWASocketFactory({
			...nodeRuntime,
			bridge: {
				...nodeRuntime.bridge,
				async createWhatsAppClient(...args) {
					const client = await nodeRuntime.bridge.createWhatsAppClient(...args)
					client.setDeviceProps = async () => {
						throw failure
					}
					const free = client.free.bind(client)
					client.free = () => {
						free()
						freed = true
					}
					return client
				}
			}
		})
		const sock = factory({
			auth: { store: useMemoryStore(), creds: initAuthCreds(), keys: { get: async () => ({}), set: async () => {} } },
			logger
		})
		try {
			await assert.rejects(
				sock.waitForConnectionUpdate(async () => false, 1_000),
				error => {
					assert.ok(error instanceof Error)
					assert.equal(error.cause, failure)
					assert.equal(freed, true)
					assert.equal(sock.waClient, undefined)
					return true
				}
			)
		} finally {
			await sock.end(undefined)
		}
	})

	it('does not publish a startup failure when the caller already ended the socket', async () => {
		let rejectRead!: (error: Error) => void
		const read = new Promise<never>((_, reject) => {
			rejectRead = reject
		})
		const sock = makeWASocket({
			// @ts-expect-error Store-only auth is supported at runtime; the public auth intersection omits it.
			auth: { store: { ...useMemoryStore(), get: () => read } },
			logger
		})
		const updates: Partial<ConnectionState>[] = []
		sock.ev.on('connection.update', update => updates.push(update))
		const ending = sock.end(undefined)
		rejectRead(new Error('read cancelled during shutdown'))
		await ending
		await tick()
		assert.equal(updates.length, 0)
		await assert.rejects(sock.getJid(), /Connection Closed/)
	})
})
