import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import P from 'pino'
import { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { createWASocketFactory } from '../Socket/core.ts'
import { nodeRuntime } from '../Runtime/node.ts'
import { createAuthenticationState } from '../Compatibility/auth-state.ts'
import { useMemoryStore } from '../Utils/use-memory-store.ts'

describe('managed call socket admission', () => {
	it('does not dial after cancellation while socket initialization is pending', async () => {
		let initialized!: () => void, unblock!: () => void
		const loading = new Promise<void>(resolve => {
			initialized = resolve
		})
		const blocked = new Promise<void>(resolve => {
			unblock = resolve
		})
		let calls = 0
		const original = WasmWhatsAppClient.prototype.dialCallPcm
		let socket: ReturnType<ReturnType<typeof createWASocketFactory>> | undefined
		try {
			WasmWhatsAppClient.prototype.dialCallPcm = async () => {
				calls++
				throw new Error('cancelled call must not reach the bridge')
			}
			const makeSocket = createWASocketFactory({
				...nodeRuntime,
				loadVoip: async pipe => {
					initialized()
					await blocked
					return nodeRuntime.loadVoip!(pipe)
				}
			})
			socket = makeSocket({
				auth: await createAuthenticationState(useMemoryStore()),
				logger: P({ level: 'silent' }),
				waWebSocketUrl: 'ws://127.0.0.1:1'
			})
			const controller = new AbortController()
			const call = socket.voip.call('123@s.whatsapp.net', { signal: controller.signal })
			await loading
			controller.abort()
			await assert.rejects(call, { name: 'AbortError' })
			unblock()
			await socket.getActiveCalls()
			await new Promise<void>(resolve => setImmediate(resolve))
			assert.equal(calls, 0)
		} finally {
			unblock()
			try {
				await socket?.end(undefined)
			} finally {
				WasmWhatsAppClient.prototype.dialCallPcm = original
			}
		}
	})
})
