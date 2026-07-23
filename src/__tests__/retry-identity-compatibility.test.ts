import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, it } from 'node:test'
import type { BinaryNode } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'
import { handleIdentityChange, type IdentityChangeDebounceCache } from '../Utils/identity-change-handler.ts'
import { MessageRetryManager, RetryReason } from '../Utils/message-retry-manager.ts'
import { buildAckStanza } from '../Utils/stanza-ack.ts'

const logger: ILogger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
}

describe('message retry manager compatibility', () => {
	it('matches upstream cache, retry, session and base-key behavior', async () => {
		const upstream = await import('baileys')
		const local = new MessageRetryManager(logger, 2)
		const remote = new upstream.MessageRetryManager(logger, 2)
		const message = { conversation: 'retry me' }

		local.addRecentMessage('5511999999999@s.whatsapp.net', 'MSG-1', message)
		remote.addRecentMessage('5511999999999@s.whatsapp.net', 'MSG-1', message)
		const localRecent = local.getRecentMessage('5511999999999@s.whatsapp.net', 'MSG-1')
		const remoteRecent = remote.getRecentMessage('5511999999999@s.whatsapp.net', 'MSG-1')
		assert.deepEqual(localRecent?.message, remoteRecent?.message)
		assert.equal(typeof localRecent?.timestamp, 'number')
		assert.ok(Math.abs((localRecent?.timestamp ?? 0) - (remoteRecent?.timestamp ?? 0)) < 100)

		for (const value of [undefined, '', 'not-a-number', '0', '4', '7', '13', '99']) {
			assert.equal(local.parseRetryErrorCode(value), remote.parseRetryErrorCode(value))
		}
		for (const [localReason, upstreamReason] of [
			[undefined, undefined],
			[RetryReason.UnknownError, upstream.RetryReason.UnknownError],
			[RetryReason.SignalErrorInvalidMessage, upstream.RetryReason.SignalErrorInvalidMessage],
			[RetryReason.SignalErrorBadMac, upstream.RetryReason.SignalErrorBadMac]
		] as const) {
			assert.equal(local.isMacError(localReason), remote.isMacError(upstreamReason))
		}

		assert.equal(local.incrementRetryCount('MSG-1'), remote.incrementRetryCount('MSG-1'))
		assert.equal(local.incrementRetryCount('MSG-1'), remote.incrementRetryCount('MSG-1'))
		assert.equal(local.getRetryCount('MSG-1'), remote.getRetryCount('MSG-1'))
		assert.equal(local.hasExceededMaxRetries('MSG-1'), remote.hasExceededMaxRetries('MSG-1'))

		assert.deepEqual(
			local.shouldRecreateSession('no-session@s.whatsapp.net', false),
			remote.shouldRecreateSession('no-session@s.whatsapp.net', false)
		)
		assert.deepEqual(
			local.shouldRecreateSession('mac@s.whatsapp.net', true, RetryReason.SignalErrorBadMac),
			remote.shouldRecreateSession('mac@s.whatsapp.net', true, upstream.RetryReason.SignalErrorBadMac)
		)
		assert.deepEqual(
			local.shouldRecreateSession('ordinary@s.whatsapp.net', true),
			remote.shouldRecreateSession('ordinary@s.whatsapp.net', true)
		)
		assert.deepEqual(
			local.shouldRecreateSession('ordinary@s.whatsapp.net', true),
			remote.shouldRecreateSession('ordinary@s.whatsapp.net', true)
		)

		const baseKey = Uint8Array.from([1, 2, 3, 4])
		local.saveBaseKey('address', 'MSG-1', baseKey)
		remote.saveBaseKey('address', 'MSG-1', baseKey)
		assert.equal(local.hasSameBaseKey('address', 'MSG-1', baseKey), remote.hasSameBaseKey('address', 'MSG-1', baseKey))
		assert.equal(
			local.hasSameBaseKey('address', 'MSG-1', Uint8Array.from([1, 2, 3, 5])),
			remote.hasSameBaseKey('address', 'MSG-1', Uint8Array.from([1, 2, 3, 5]))
		)
		local.deleteBaseKey('address', 'MSG-1')
		remote.deleteBaseKey('address', 'MSG-1')
		assert.equal(local.hasSameBaseKey('address', 'MSG-1', baseKey), remote.hasSameBaseKey('address', 'MSG-1', baseKey))

		local.markRetrySuccess('MSG-1')
		remote.markRetrySuccess('MSG-1')
		assert.equal(local.getRetryCount('MSG-1'), remote.getRetryCount('MSG-1'))
		assert.equal(local.getRecentMessage('5511999999999@s.whatsapp.net', 'MSG-1'), undefined)
		assert.equal(remote.getRecentMessage('5511999999999@s.whatsapp.net', 'MSG-1'), undefined)
	})

	it('matches scheduling, cancellation and clear semantics', async () => {
		const upstream = await import('baileys')
		const local = new MessageRetryManager(logger, 5)
		const remote = new upstream.MessageRetryManager(logger, 5)
		let localCalls = 0
		let remoteCalls = 0

		local.schedulePhoneRequest('fire', () => localCalls++, 5)
		remote.schedulePhoneRequest('fire', () => remoteCalls++, 5)
		local.schedulePhoneRequest('cancel', () => localCalls++, 5)
		remote.schedulePhoneRequest('cancel', () => remoteCalls++, 5)
		local.cancelPendingPhoneRequest('cancel')
		remote.cancelPendingPhoneRequest('cancel')
		await delay(20)
		assert.equal(localCalls, remoteCalls)
		assert.equal(localCalls, 1)

		local.schedulePhoneRequest('clear', () => localCalls++, 5)
		remote.schedulePhoneRequest('clear', () => remoteCalls++, 5)
		local.incrementRetryCount('clear')
		remote.incrementRetryCount('clear')
		local.clear()
		remote.clear()
		await delay(20)
		assert.equal(localCalls, remoteCalls)
		assert.equal(local.getRetryCount('clear'), remote.getRetryCount('clear'))
	})
})

describe('ACK stanza compatibility', () => {
	it('matches upstream for message, receipt and nack variants', async () => {
		const upstream = await import('baileys')
		const nodes: Array<[BinaryNode, number | undefined, string | undefined]> = [
			[
				{
					tag: 'message',
					attrs: {
						id: 'MSG-1',
						from: 'group@g.us',
						participant: 'participant@s.whatsapp.net',
						recipient: 'recipient@s.whatsapp.net',
						type: 'text'
					}
				},
				undefined,
				'me@s.whatsapp.net'
			],
			[{ tag: 'receipt', attrs: { id: 'MSG-2', from: 'peer@s.whatsapp.net', type: 'retry' } }, 500, undefined],
			[{ tag: 'notification', attrs: { id: 'MSG-3', from: 'peer@s.whatsapp.net' } }, 0, undefined]
		]

		for (const [node, errorCode, meId] of nodes) {
			assert.deepEqual(buildAckStanza(node, errorCode, meId), upstream.buildAckStanza(node, errorCode, meId))
		}
	})
})

describe('identity change compatibility', () => {
	it('matches every observable decision and side-effect path', async () => {
		const upstream = await import('baileys')
		const identity = (from?: string, attrs: Record<string, string> = {}): BinaryNode => ({
			tag: 'notification',
			attrs: { ...(from ? { from } : {}), ...attrs },
			content: [{ tag: 'identity', attrs: {} }]
		})
		const cases: Array<{
			name: string
			node: BinaryNode
			meId?: string
			seedDebounce?: boolean
			session?: boolean
			fail?: Error
		}> = [
			{ name: 'invalid notification', node: identity() },
			{ name: 'missing identity child', node: { tag: 'notification', attrs: { from: 'peer@s.whatsapp.net' } } },
			{ name: 'companion device', node: identity('peer:2@s.whatsapp.net') },
			{ name: 'self primary', node: identity('me@s.whatsapp.net'), meId: 'me:0@s.whatsapp.net' },
			{ name: 'debounced', node: identity('debounced@s.whatsapp.net'), seedDebounce: true },
			{ name: 'no session', node: identity('new@s.whatsapp.net'), session: false },
			{ name: 'offline', node: identity('offline@s.whatsapp.net', { offline: '1' }) },
			{ name: 'refreshed', node: identity('refresh@s.whatsapp.net') },
			{ name: 'refresh failure', node: identity('failure@s.whatsapp.net'), fail: new Error('refresh failed') }
		]

		for (const testCase of cases) {
			const run = async (implementation: typeof handleIdentityChange) => {
				const values = new Map<string | number, boolean>()
				const debounceCache: IdentityChangeDebounceCache = {
					get: key => values.get(key),
					set: (key, value) => values.set(key, value)
				}
				if (testCase.seedDebounce && testCase.node.attrs.from) debounceCache.set(testCase.node.attrs.from, true)
				const calls = { validate: 0, before: 0, assert: 0 }
				const result = await implementation(testCase.node, {
					meId: testCase.meId,
					meLid: undefined,
					debounceCache,
					logger,
					validateSession: async () => {
						calls.validate++
						return { exists: testCase.session !== false }
					},
					onBeforeSessionRefresh: () => calls.before++,
					assertSessions: async () => {
						calls.assert++
						if (testCase.fail) throw testCase.fail
						return true
					}
				})
				return { result, calls }
			}

			const local = await run(handleIdentityChange)
			const remote = await run(upstream.handleIdentityChange as unknown as typeof handleIdentityChange)
			assert.deepEqual(local, remote, testCase.name)
		}
	})
})
