import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HostWASocket } from '../host-types.ts'

const acceptsCompleteHostSocketSurface = (socket: HostWASocket): void => {
	void socket.groupLeave('120@g.us')
	void socket.groupInviteCode('120@g.us')
	void socket.groupAcceptInvite('invite')
	void socket.communityFetchLinkedGroups('120@g.us')
	void socket.newsletterFollow('123@newsletter')
}

describe('host socket declarations', () => {
	it('include the complete callable operation surface', () => {
		assert.equal(typeof acceptsCompleteHostSocketSurface, 'function')
	})
})
