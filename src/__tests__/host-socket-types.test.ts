import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as hostBridge from '@oxidezap/whatsapp-rust-bridge/host'
import Long from 'long'
import type {
	HostAuthenticationState,
	HostBridgeRuntime,
	HostConnectionUpdate,
	HostLongConstructor,
	HostRuntime,
	HostSocketConfig,
	HostWASocket
} from '../host-types.ts'

const bridgeSurface: HostBridgeRuntime = hostBridge
const longSurface: HostLongConstructor = Long

// @ts-expect-error A custom host runtime must provide the bridge operations the socket calls.
const incompleteBridge: HostRuntime['bridge'] = {}
// @ts-expect-error The event path requires Long.fromValue and Long instances.
const incompleteLong: HostRuntime['Long'] = {}

const rejectsMalformedHostConfig = (auth: HostAuthenticationState): void => {
	// @ts-expect-error browser must retain the three-string Baileys tuple.
	const invalidBrowser: HostSocketConfig = { auth, browser: 42 }
	// @ts-expect-error unknown and misspelled socket options are not accepted.
	const misspelledOption: HostSocketConfig = { auth, connectTimoutMs: 10 }
	void invalidBrowser
	void misspelledOption
}

const acceptsCompleteHostSocketSurface = (socket: HostWASocket): void => {
	void socket.groupLeave('120@g.us')
	void socket.groupInviteCode('120@g.us')
	void socket.groupAcceptInvite('invite')
	void socket.communityFetchLinkedGroups('120@g.us')
	void socket.newsletterFollow('123@newsletter')
	void socket.user?.name
	void socket.authState.creds.registered
	void socket.isConnected
	void socket.isLoggedIn
	void socket.waClient
	void socket.ws.listenerCount('close')
	socket.ev.on('connection.update', update => {
		void update.connection
		// @ts-expect-error Known events are contextually typed, not the fallback payload.
		void update.notAConnectionField
	})
	const typedListener = (update: HostConnectionUpdate) => void update.qr
	socket.ev.on('connection.update', typedListener)
	socket.ev.on('consumer.extension', (payload: { ready: boolean }) => void payload.ready)
}

describe('host socket declarations', () => {
	it('include the complete callable operation surface', () => {
		assert.equal(typeof acceptsCompleteHostSocketSurface, 'function')
		assert.equal(typeof rejectsMalformedHostConfig, 'function')
		assert.deepEqual(incompleteBridge, {})
		assert.deepEqual(incompleteLong, {})
		assert.equal(typeof bridgeSurface.initWasmEngine, 'function')
		assert.equal(typeof longSurface.fromValue, 'function')
	})
})
