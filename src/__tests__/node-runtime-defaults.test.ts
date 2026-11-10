import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import { nodeRuntime } from '../Runtime/node.ts'

describe('Node runtime defaults', () => {
	it('preserves the configured pino-backed connection logger', () => {
		assert.equal(nodeRuntime.defaultLogger, DEFAULT_CONNECTION_CONFIG.logger)
	})
})
