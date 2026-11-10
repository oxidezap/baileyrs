import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nodeMedia } from '../Runtime/node-media.ts'

describe('runtime media isolation', () => {
	it('loading the host runtime does not replace Node HKDF', async () => {
		await import('../Runtime/node.ts')
		const nodeHkdf = nodeMedia.hkdf
		await import('../Runtime/host.ts')
		assert.equal(nodeMedia.hkdf, nodeHkdf)
	})
})
