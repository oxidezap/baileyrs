import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { DisconnectReason } from '../../Types/index.ts'
import { isBoom } from '../../Utils/boom.ts'
import type { ILogger } from '../../Utils/logger.ts'
import { makeTaggedMessageWaiter } from '../tagged-message-waiter.ts'

const makeLogger = () => {
	const warnings: unknown[][] = []
	const logger = {
		level: 'silent',
		child: () => logger,
		trace: () => undefined,
		debug: () => undefined,
		info: () => undefined,
		warn: (...args: unknown[]) => warnings.push(args),
		error: () => undefined
	} as ILogger
	return { logger, warnings }
}

describe('tagged message waiter', () => {
	it('resolves the matching tag and removes every listener', async () => {
		const ws = new EventEmitter()
		const { logger } = makeLogger()
		const waitForMessage = makeTaggedMessageWaiter(ws, logger, 100)
		const pending = waitForMessage<{ ok: boolean }>('message-id')

		assert.equal(ws.listenerCount('TAG:message-id'), 1)
		assert.equal(ws.listenerCount('close'), 1)
		assert.equal(ws.listenerCount('error'), 1)
		ws.emit('TAG:message-id', { ok: true })

		assert.deepEqual(await pending, { ok: true })
		assert.equal(ws.listenerCount('TAG:message-id'), 0)
		assert.equal(ws.listenerCount('close'), 0)
		assert.equal(ws.listenerCount('error'), 0)
	})

	it('returns undefined and warns on timeout', async () => {
		const ws = new EventEmitter()
		const { logger, warnings } = makeLogger()
		const waitForMessage = makeTaggedMessageWaiter(ws, logger)
		const keepAlive = setTimeout(() => undefined, 100)
		try {
			assert.equal(await waitForMessage('timeout-id', 5), undefined)
		} finally {
			clearTimeout(keepAlive)
		}
		assert.equal(warnings.length, 1)
		assert.deepEqual(warnings[0]?.[0], { msgId: 'timeout-id' })
	})

	it('rejects with the connection-closed reason when the socket closes', async () => {
		const ws = new EventEmitter()
		const { logger } = makeLogger()
		const waitForMessage = makeTaggedMessageWaiter(ws, logger, 100)
		const pending = waitForMessage('closed-id')
		ws.emit('close')

		await assert.rejects(pending, error => {
			assert.ok(isBoom(error))
			assert.equal(error.output.statusCode, DisconnectReason.connectionClosed)
			return true
		})
	})
})
