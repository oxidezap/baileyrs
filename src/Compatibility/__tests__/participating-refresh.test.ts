import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeParticipatingRefreshHandler } from '../participating-refresh.ts'
import type { SocketContext } from '../../Socket/types.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))

describe('participating metadata refresh', () => {
	it('routes only group and community dirty states', async () => {
		const calls: string[] = []
		const ctx = {
			logger: { warn: () => undefined }
		} as unknown as SocketContext
		const refresh = makeParticipatingRefreshHandler(ctx, {
			groupFetchAllParticipating: async () => calls.push('groups'),
			communityFetchAllParticipating: async () => calls.push('communities')
		})

		refresh('groups')
		refresh('communities')
		refresh('account_sync')
		await tick()

		assert.deepEqual(calls, ['groups', 'communities'])
	})
})
