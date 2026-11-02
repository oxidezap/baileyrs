import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import P from 'pino'
import { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { createWASocketFactory } from '../Socket/core.ts'
import { makeCallContextTracker } from '../Socket/calls-core.ts'
import { nodeRuntime } from '../Runtime/node.ts'
import { createAuthenticationState } from '../Compatibility/auth-state.ts'
import { useMemoryStore } from '../Utils/use-memory-store.ts'

describe('managed call socket admission', () => {
	it('retains overlapping hangup authority and reclaims backend-ended context history', async () => {
		const ctx = {
			withClient: async () => {
				throw new Error('no client operation expected')
			},
			reportUnexpectedError: () => {}
		}
		const contexts = new Map<string, unknown>(),
			tracker = makeCallContextTracker(ctx, contexts)
		for (let i = 0; i < 258; i++) {
			const id = `ENDED-${i}`
			contexts.set(id, {})
			tracker.onMediaEvent({ kind: 'ended', callId: id })
		}
		assert.equal(contexts.size, 0)
		contexts.set('ENDING', {})
		let finishFirst!: () => void, finishSecond!: () => void
		const first = tracker.duringEnd(
			'ENDING',
			() =>
				new Promise<void>(resolve => {
					finishFirst = resolve
				})
		)
		const second = tracker.duringEnd(
			'ENDING',
			() =>
				new Promise<void>(resolve => {
					finishSecond = resolve
				})
		)
		finishFirst()
		await first
		tracker.onMediaEvent({ kind: 'ended', callId: 'ENDING' })
		assert.ok(contexts.has('ENDING'), 'one completed hangup must not release another in-flight lease')
		finishSecond()
		await second
		tracker.onMediaEvent({ kind: 'ended', callId: 'ENDING' })
		assert.equal(contexts.size, 0)
		contexts.set('FAILED', {})
		await assert.rejects(
			tracker.duringEnd('FAILED', async () => {
				throw new Error('native hangup failed')
			})
		)
		tracker.onMediaEvent({ kind: 'ended', callId: 'FAILED' })
		assert.ok(contexts.has('FAILED'), 'late local termination does not confirm a failed peer notification')
		tracker.confirmed('FAILED')
		assert.equal(contexts.size, 0)
	})
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
	it('retains the local creator for an outgoing incomplete hangup without incoming call updates', async () => {
		const self = '111111111111111@lid',
			peer = '222222222222222@lid'
		const prototype = WasmWhatsAppClient.prototype
		const original = { dial: prototype.dialCallPcm, end: prototype.endCall, terminate: prototype.terminateCall }
		const terminations: string[][] = []
		let nativeEnds = 0
		let callbacks!: Parameters<typeof nodeRuntime.bridge.createWhatsAppClient>[2]
		let socket: ReturnType<ReturnType<typeof createWASocketFactory>> | undefined
		try {
			prototype.dialCallPcm = async () => 'OUTGOING-NO-UPDATES' as never
			prototype.endCall = async () => {
				nativeEnds++
				callbacks?.onCallEvent?.({ kind: 'ended', callId: 'OUTGOING-NO-UPDATES' })
				await new Promise<void>(resolve => setImmediate(resolve))
				return { outcome: 'local-only', failure: 'synthetic peer failure' } as never
			}
			prototype.terminateCall = async (...args: string[]) => {
				terminations.push(args)
				if (terminations.length === 1) throw new Error('synthetic signaling failure')
				return { outcome: 'peer-notified' }
			}
			const auth = await createAuthenticationState(useMemoryStore())
			auth.creds.me = { id: '12025550111@s.whatsapp.net', lid: self }
			socket = createWASocketFactory({
				...nodeRuntime,
				bridge: {
					...nodeRuntime.bridge,
					createWhatsAppClient: (...args) => {
						callbacks = args[2]
						return nodeRuntime.bridge.createWhatsAppClient(...args)
					}
				}
			})({
				auth,
				logger: P({ level: 'silent' }),
				waWebSocketUrl: 'ws://127.0.0.1:1'
			})
			const call = await socket.voip.call(peer)
			await assert.rejects(call.end(), /synthetic signaling failure/)
			assert.deepEqual(await call.end(), { outcome: 'peer-notified' })
			assert.equal(nativeEnds, 1, 'retry must not mistake already-ended native media for peer notification')
			assert.deepEqual(terminations, [
				[call.id, peer, self],
				[call.id, peer, self]
			])
		} finally {
			try {
				await socket?.end(undefined)
			} finally {
				prototype.dialCallPcm = original.dial
				prototype.endCall = original.end
				prototype.terminateCall = original.terminate
			}
		}
	})
})
