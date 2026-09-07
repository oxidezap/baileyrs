import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import P from 'pino'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeWithClient, type ClientOperations } from '../Socket/client-operations.ts'
import { makeGroupMethods } from '../Socket/groups.ts'
import { makeMessageMethods } from '../Socket/messages.ts'
import { makePreKeyMethods } from '../Socket/prekeys.ts'
import { makeStanzaResponseMethods } from '../Compatibility/stanza-responses.ts'
import type { SocketContext } from '../Socket/types.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import makeWASocket from '../Socket/index.ts'
import { useMemoryStore } from '../Utils/use-memory-store.ts'
import { normalizeSocketAuthenticationState } from '../Compatibility/internal/auth-state.ts'

const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe('withClient', () => {
	it('waits for initialization and returns synchronous and asynchronous results', async () => {
		const init = deferred<{ value: number }>()
		const withClient = makeWithClient(() => init.promise)
		let calls = 0
		const pending = withClient(client => {
			calls++
			return client.value
		})
		assert.equal(calls, 0)
		init.resolve({ value: 42 })
		assert.equal(await pending, 42)
		assert.equal(calls, 1)
		assert.equal(await withClient(async client => client.value + 1), 43)
	})

	it('does not invoke callbacks when initialization fails', async () => {
		const init = deferred<object>()
		const failure = new Error('initialization failed')
		const withClient = makeWithClient(() => init.promise)
		const pending = withClient(() => assert.fail('callback ran'))
		init.reject(failure)
		await assert.rejects(pending, error => error === failure)
	})

	it('propagates admission rejection before and after waiting for initialization', async () => {
		const init = deferred<void>()
		const failure = new Error('Connection Closed')
		let closing = false
		const withClient = makeWithClient(async () => {
			if (closing) throw failure
			await init.promise
			if (closing) throw failure
			return {}
		})
		const pending = withClient(() => assert.fail('callback ran'))
		closing = true
		init.resolve()
		await assert.rejects(pending, error => error === failure)
		await assert.rejects(
			withClient(() => assert.fail('callback ran')),
			error => error === failure
		)
	})

	it('turns synchronous callback throws into rejections and preserves rejected values', async () => {
		const withClient = makeWithClient(async () => ({}))
		const failure = new Error('callback failed')
		let pending!: Promise<never>
		assert.doesNotThrow(() => {
			pending = withClient(() => {
				throw failure
			})
		})
		await assert.rejects(pending, error => error === failure)
		await assert.rejects(
			withClient(() => Promise.reject(failure)),
			error => error === failure
		)
		assert.equal(await withClient(() => 'still usable'), 'still usable')
	})

	it('preserves the bridge method receiver', async () => {
		const client = {
			value: 7,
			read() {
				return this.value
			}
		}
		assert.equal(await makeWithClient(async () => client)(ready => ready.read()), 7)
	})

	it('turns synchronous getter throws into rejections', async () => {
		const failure = new Error('acquisition failed')
		const withClient = makeWithClient(() => {
			throw failure
		})
		let pending!: Promise<never>
		assert.doesNotThrow(() => {
			pending = withClient(() => assert.fail('callback ran'))
		})
		await assert.rejects(pending, error => error === failure)
	})

	it('does not drain or track admitted operations', async () => {
		const operation = deferred<number>()
		const withClient = makeWithClient(async () => ({}))
		const pending = withClient(() => operation.promise)
		assert.equal(await withClient(() => 2), 2)
		operation.resolve(1)
		assert.equal(await pending, 1)
	})
})

describe('factory acquisition ordering', () => {
	it('keeps validation before acquisition and argument reads after it', async () => {
		const init = deferred<WasmWhatsAppClient>()
		const order: string[] = []
		const ctx = {
			async withClient<T>(operation: (client: WasmWhatsAppClient) => T | Promise<T>): Promise<T> {
				assert.equal(this, ctx)
				order.push('acquire')
				return operation(await init.promise)
			},
			ev: makeEventBuffer(P({ level: 'silent' }))
		} as SocketContext
		const groups = makeGroupMethods(ctx)
		await assert.rejects(groups.groupParticipantsUpdate('group', [], 'invalid' as never))
		assert.equal(order.length, 0)
		const label = {
			slice() {
				order.push('argument')
				return 'label'
			}
		} as unknown as string
		const pending = groups.updateMemberLabel('group', label)
		assert.deepEqual(order, ['acquire'])
		const client = {
			updateMemberLabel() {
				assert.equal(this, client)
				order.push('bridge')
				return 'result'
			}
		} as unknown as WasmWhatsAppClient
		init.resolve(client)
		assert.equal(await pending, 'result')
		assert.deepEqual(order, ['acquire', 'argument', 'bridge'])
	})

	it('keeps complex message validation after acquisition', async () => {
		const init = deferred<WasmWhatsAppClient>()
		let read = false
		const ctx = { withClient: makeWithClient(() => init.promise) } as SocketContext
		const message = {
			get message() {
				read = true
				return undefined
			}
		}
		const pending = makeMessageMethods(ctx).updateMediaMessage(message as never)
		assert.equal(read, false)
		init.resolve({} as WasmWhatsAppClient)
		await assert.rejects(pending, /Not a media message/)
		assert.equal(read, true)
	})

	it('keeps the prekey catch around acquisition failures', async () => {
		const failure = new Error('closed')
		let logged: unknown
		const methods = makePreKeyMethods({
			withClient: async () => {
				throw failure
			},
			logger: {
				error: (data: unknown) => {
					logged = data
				}
			} as SocketContext['logger']
		})
		await methods.uploadPreKeysToServerIfRequired()
		assert.deepEqual(logged, { error: failure })
	})

	it('accepts narrow stanza clients and preserves context and bridge receivers', async () => {
		let calls = 0
		const client = {
			async acknowledgeStanza() {
				assert.equal(this, client)
				calls++
			},
			async rejectStanza() {},
			async requestMessageRetry() {}
		}
		const ctx: ClientOperations<typeof client> = {
			async withClient(operation) {
				assert.equal(this, ctx)
				return operation(client)
			}
		}
		const methods = makeStanzaResponseMethods(ctx)
		await methods.sendMessageAck({ tag: 'message', attrs: {} })
		assert.equal(calls, 1)
	})
})

describe('withClient on the real socket', { timeout: 15_000 }, () => {
	for (const closing of [false, true]) {
		it(`gates callback argument reads on initialization, closing=${closing}`, async () => {
			const entered = deferred<void>()
			const release = deferred<void>()
			const store = useMemoryStore()
			const sock = makeWASocket({
				auth: normalizeSocketAuthenticationState({
					store: {
						...store,
						async get(bucket, key) {
							entered.resolve()
							await release.promise
							return store.get(bucket, key)
						}
					}
				}),
				logger: P({ level: 'silent' }),
				waWebSocketUrl: 'ws://127.0.0.1:1'
			})
			let reads = 0
			const callbackFailure = new Error('argument getter failed')
			const key = {
				get remoteJid(): string {
					reads++
					throw callbackFailure
				}
			}
			const pending = sock.fetchMessageHistory(1, key, 0)
			try {
				await entered.promise
				assert.equal(reads, 0)
				if (closing) {
					const ending = sock.end(undefined)
					release.resolve()
					await assert.rejects(pending, /Connection Closed/)
					await ending
					await assert.rejects(sock.fetchMessageHistory(1, key, 0), /Connection Closed/)
					assert.equal(reads, 0)
				} else {
					release.resolve()
					await assert.rejects(pending, error => error === callbackFailure)
					assert.equal(reads, 1)
					await sock.getJid()
				}
			} finally {
				release.resolve()
				await sock[Symbol.asyncDispose]()
			}
		})
	}

	it('does not evaluate callback arguments after bridge initialization fails', async () => {
		const sock = makeWASocket({
			auth: normalizeSocketAuthenticationState({ store: useMemoryStore() }),
			logger: P({ level: 'silent' }),
			waWebSocketUrl: 'ws://127.0.0.1:1',
			dangerSkipCertChainVerify: 'invalid' as unknown as boolean
		})
		let reads = 0
		try {
			const key = {
				get remoteJid() {
					reads++
					return 'user@s.whatsapp.net'
				}
			}
			await assert.rejects(sock.fetchMessageHistory(1, key, 0), /failed to initialize/)
			assert.equal(reads, 0)
		} finally {
			await sock[Symbol.asyncDispose]()
		}
	})
})
