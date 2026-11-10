/**
 * `_registerActiveBridgeClient` is a module-level pointer to the most-recently
 * created bridge client, used by the standalone helpers
 * (`downloadContentFromMessage`, `downloadHistory`) that carry no socket.
 *
 * `sock.end()` calls `c.free()`. While the global still pointed at the freed
 * client, the next standalone call reached through a null wasm pointer and
 * failed with an opaque wasm-bindgen error instead of the actionable Boom —
 * and the global kept a strong reference to a client the socket had dropped.
 */

import { afterEach, describe, it } from 'node:test'

import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { _registerActiveBridgeClient, _unregisterActiveBridgeClient } from '../Utils/messages.ts'
import { downloadHistory } from '../Utils/process-history-message.ts'
import { expect } from './expect.ts'

const mediaNotification = {
	directPath: '/v/history',
	mediaKey: new Uint8Array(32),
	fileSha256: new Uint8Array(32),
	fileEncSha256: new Uint8Array(32),
	fileLength: 1
}

/** A client whose `downloadMediaStream` fails the way wasm-bindgen does after `free()`. */
const freedClient = (): WasmWhatsAppClient =>
	({
		downloadMediaStream: () => {
			throw new Error('null pointer passed to rust')
		}
	}) as unknown as WasmWhatsAppClient

const liveClient = (): WasmWhatsAppClient =>
	({
		downloadMediaStream: () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close()
				}
			})
	}) as unknown as WasmWhatsAppClient

/** Message of the error the standalone helper produces for the notification above. */
const downloadError = async (): Promise<string> => {
	try {
		await downloadHistory(mediaNotification, {})
		return '<no error>'
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
}

describe('_unregisterActiveBridgeClient', () => {
	// The pointer is module-global, so a test that leaves one registered makes
	// the next one order-dependent. Track what each test claimed and release it.
	const registered: WasmWhatsAppClient[] = []
	const register = (client: WasmWhatsAppClient) => {
		registered.push(client)
		_registerActiveBridgeClient(client)
		return client
	}

	afterEach(() => {
		for (const client of registered.splice(0)) _unregisterActiveBridgeClient(client)
	})

	it('leaves the standalone helper reporting "no bridge client" instead of reaching a freed pointer', async () => {
		const client = register(freedClient())

		// Before: the global still points at the freed client.
		expect(await downloadError()).toContain('null pointer passed to rust')

		// After: `sock.end()` unregisters, so the helper fails with the
		// actionable message rather than the wasm-bindgen one.
		_unregisterActiveBridgeClient(client)
		const message = await downloadError()
		expect(message).toContain('no bridge client available')
		expect(message.includes('null pointer passed to rust')).toBe(false)
	})

	it('is identity-checked: ending socket A must not unregister socket B', async () => {
		const a = register(freedClient())
		const b = register(liveClient()) // a second socket takes over the pointer

		_unregisterActiveBridgeClient(a) // the old socket's `end()`

		// B is still registered, so the download runs against it and fails
		// further downstream (empty payload) — not with "no bridge client".
		expect((await downloadError()).includes('no bridge client available')).toBe(false)

		// And B really is why: clearing it flips the failure back, which a bare
		// negative assertion would not have proven — it also passes when the
		// download simply succeeds.
		_unregisterActiveBridgeClient(b)
		expect(await downloadError()).toContain('no bridge client available')
	})

	it('is idempotent: a repeated unregister must not clear the next registration', async () => {
		const a = register(freedClient())
		_unregisterActiveBridgeClient(a)
		_unregisterActiveBridgeClient(a)

		const b = register(liveClient())
		expect((await downloadError()).includes('no bridge client available')).toBe(false)

		_unregisterActiveBridgeClient(b)
		expect(await downloadError()).toContain('no bridge client available')
	})
})
