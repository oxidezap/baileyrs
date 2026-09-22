import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as hostBridge from '@oxidezap/whatsapp-rust-bridge/host'
import type { HostBridgeRuntime, HostRuntime, HostWASocket } from '../host-types.ts'

const bridgeSurface: HostBridgeRuntime = hostBridge

// @ts-expect-error A custom host runtime must provide the bridge operations the socket calls.
const incompleteBridge: HostRuntime['bridge'] = {}

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
		assert.deepEqual(incompleteBridge, {})
		assert.equal(typeof bridgeSurface.initWasmEngine, 'function')
	})
})
