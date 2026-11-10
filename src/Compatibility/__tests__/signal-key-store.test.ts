import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SignalKeyStore } from '../../Types/index.ts'
import type { ILogger } from '../../Utils/logger.ts'
import { makeLazyTransactionKeyStore } from '../internal/signal-key-store.ts'

const logger: ILogger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
}

describe('exposed Signal key-store facade', () => {
	it('does not inspect or wrap the store until the public facade is observed', async () => {
		let capabilityChecks = 0
		const state = new Proxy<SignalKeyStore>(
			{
				get: async () => ({}),
				set: async () => undefined
			},
			{
				has: (target, property) => {
					capabilityChecks++
					return Reflect.has(target, property)
				}
			}
		)
		const resolve = makeLazyTransactionKeyStore(state, logger, {
			maxCommitRetries: 1,
			delayBetweenTriesMs: 0
		})

		assert.equal(capabilityChecks, 0)
		const first = resolve()
		assert.equal(capabilityChecks, 1)
		assert.equal(resolve(), first)
		assert.equal(capabilityChecks, 1)
		assert.equal(first.isInTransaction(), false)
		assert.equal(await first.transaction(async () => first.isInTransaction(), 'test'), true)
	})
})
