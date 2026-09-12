import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeTransport } from '../Socket/transport.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
} as unknown as ILogger

const platformWebSocket = globalThis.WebSocket

describe('transport: dispatcher options and H2 opt-out', () => {
	let capturedOptions: Array<Record<string, unknown> | undefined> = []

	afterEach(() => {
		globalThis.WebSocket = platformWebSocket
	})

	beforeEach(() => {
		capturedOptions = []
		class CapturedWebSocket {
			static readonly OPEN = 1
			readonly url: string
			readyState = CapturedWebSocket.OPEN
			binaryType = 'blob'
			private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

			constructor(url: string, options?: Record<string, unknown>) {
				this.url = url
				capturedOptions.push(options)
				queueMicrotask(() => this.dispatch('open'))
			}

			addEventListener(type: string, listener: (event: never) => void) {
				const set = this.listeners.get(type) ?? new Set()
				set.add(listener as (event: unknown) => void)
				this.listeners.set(type, set)
			}

			close() {
				this.readyState = 3
				this.dispatch('close')
			}

			private dispatch(type: string) {
				for (const listener of this.listeners.get(type) ?? []) listener({})
			}
		}
		globalThis.WebSocket = CapturedWebSocket as unknown as typeof WebSocket
	})

	it('configures a dispatcher with allowH2 disabled to avoid HTTP/2 WS rejection', async () => {
		const transport = makeTransport({ waWebSocketUrl: 'ws://127.0.0.1:1/ws', logger: silentLogger })
		await transport.connect({ onConnected: () => {}, onData: () => {}, onDisconnected: () => {} })

		const options = capturedOptions[0]
		expect(options).toBeDefined()
		expect(options?.dispatcher).toBeDefined()

		const dispatcher = options!.dispatcher as Record<string | symbol, unknown>
		const optSymbols = Object.getOwnPropertySymbols(dispatcher)
		const optionsSym = optSymbols.find(s => s.description === 'options' || String(s).includes('options'))
		if (optionsSym) {
			const agentOpts = dispatcher[optionsSym] as Record<string, unknown>
			expect(agentOpts.allowH2).toBe(false)
		}
	})

	it('configures rejectUnauthorized: false when dangerSkipCertChainVerify is true', async () => {
		const transport = makeTransport({
			waWebSocketUrl: 'ws://127.0.0.1:1/ws',
			logger: silentLogger,
			dangerSkipCertChainVerify: true
		})
		await transport.connect({ onConnected: () => {}, onData: () => {}, onDisconnected: () => {} })

		const options = capturedOptions[0]
		expect(options).toBeDefined()
		expect(options?.dispatcher).toBeDefined()

		const dispatcher = options!.dispatcher as Record<string | symbol, unknown>
		const optSymbols = Object.getOwnPropertySymbols(dispatcher)
		const optionsSym = optSymbols.find(s => s.description === 'options' || String(s).includes('options'))
		if (optionsSym) {
			const agentOpts = dispatcher[optionsSym] as { connect?: { rejectUnauthorized?: boolean } }
			expect(agentOpts.connect?.rejectUnauthorized).toBe(false)
		}
	})
})
