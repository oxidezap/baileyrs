import wasm from './bridge.wasm'
import { createAuthenticationState, makeWASocket, useMemoryStore } from '@whiskeysockets/baileys/host'
import { initSync } from '@oxidezap/whatsapp-rust-bridge/host'

initSync({ module: wasm })

export default {
	async fetch(): Promise<Response> {
		const auth = await createAuthenticationState(useMemoryStore())
		const socket = makeWASocket({ auth })
		await socket.end(new Error('workerd packaged smoke complete'))
		return new Response('host initialized')
	}
}
