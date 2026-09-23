import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as hostBridge from '@oxidezap/whatsapp-rust-bridge/host'
import Long from 'long'
import type {
	HostAnyMessageContent,
	HostAuthenticationState,
	HostBridgeRuntime,
	HostConnectionUpdate,
	HostLongConstructor,
	HostMessageGenerationOptions,
	HostRuntime,
	HostSocketConfig,
	HostWASocket
} from '../host-types.ts'
import type { WAMessage } from '../host-shared.ts'
import { makeMediaCryptoRuntime } from '../host-surface.ts'

const bridgeSurface: HostBridgeRuntime = hostBridge
const longSurface: HostLongConstructor = Long

// @ts-expect-error A custom host runtime must provide the bridge operations the socket calls.
const incompleteBridge: HostRuntime['bridge'] = {}
// @ts-expect-error The event path requires Long.fromValue and Long instances.
const incompleteLong: HostRuntime['Long'] = {}

const acceptsCustomRuntimeCrypto = (runtime: HostRuntime): void => {
	const crypto = makeMediaCryptoRuntime(runtime)
	const digest = crypto.sha256(new Uint8Array())
	void crypto.hkdf(new Uint8Array(), 32, { info: 'test' })
	void crypto.aesGcm256Encrypt(new Uint8Array(), new Uint8Array(), new Uint8Array(), digest)
}

const rejectsMalformedHostConfig = (auth: HostAuthenticationState): void => {
	// @ts-expect-error browser must retain the three-string Baileys tuple.
	const invalidBrowser: HostSocketConfig = { auth, browser: 42 }
	// @ts-expect-error unknown and misspelled socket options are not accepted.
	const misspelledOption: HostSocketConfig = { auth, connectTimoutMs: 10 }
	void invalidBrowser
	void misspelledOption
}

const acceptsCompleteHostSocketSurface = (socket: HostWASocket, priorMessage: WAMessage): void => {
	const sentMessage: Promise<WAMessage> = socket.sendMessage('120@g.us', { text: 'hello' })
	void sentMessage.then(message => void message.key.id)
	const content: HostAnyMessageContent = { text: 'hello' }
	const options: HostMessageGenerationOptions = { messageId: 'MSG1', quoted: priorMessage, broadcast: true }
	void socket.sendMessage('120@g.us', { text: 'reply' }, { quoted: priorMessage })
	void socket.sendMessage('status@broadcast', { text: 'status' }, { broadcast: true })
	void content
	void options
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
	socket.ev.on('messages.upsert', upsert => void upsert.messages[0]?.key.id)
	socket.ev.on('consumer.extension', (payload: { ready: boolean }) => void payload.ready)
	// @ts-expect-error Buffered listener registration returns void and cannot be chained.
	socket.ev.on('connection.update', () => undefined).on('connection.update', () => undefined)
	// @ts-expect-error The Baileys buffered facade requires the event to remove.
	socket.ev.removeAllListeners()
	// @ts-expect-error The buffered socket facade does not expose EventEmitter.once().
	socket.ev.once('connection.update', () => undefined)
}

describe('host socket declarations', () => {
	it('include the complete callable operation surface', () => {
		assert.equal(typeof acceptsCompleteHostSocketSurface, 'function')
		assert.equal(typeof acceptsCustomRuntimeCrypto, 'function')
		assert.equal(typeof rejectsMalformedHostConfig, 'function')
		assert.deepEqual(incompleteBridge, {})
		assert.deepEqual(incompleteLong, {})
		assert.equal(typeof bridgeSurface.initWasmEngine, 'function')
		assert.equal(typeof longSurface.fromValue, 'function')
		assert.equal(longSurface.fromValue(123).toNumber(), 123)
	})
})
