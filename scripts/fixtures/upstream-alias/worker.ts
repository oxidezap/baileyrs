import wasm from './bridge.wasm'
import { createAuthenticationState, makeWASocket, useMemoryStore } from '@whiskeysockets/baileys/host'
import { initSync } from '@oxidezap/whatsapp-rust-bridge/host'
import { DEFAULT_CONNECTION_CONFIG } from '@whiskeysockets/baileys/lib/Defaults/index.js'
import { makeHttpClient } from '@whiskeysockets/baileys/lib/Socket/transport.js'

initSync({ module: wasm })

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		if (url.pathname === '/blob') return new Response('history fixture')
		if (url.pathname === '/redirect') return Response.redirect(new URL('/blob', url), 302)

		const http = makeHttpClient(DEFAULT_CONNECTION_CONFIG)
		const download = (path: string) => http.execute(new URL(path, url).href, 'GET', {}, null)
		const blob = await download('/blob')
		if (blob.statusCode !== 200 || new TextDecoder().decode(blob.body) !== 'history fixture') {
			throw new Error('workerd direct download failed')
		}
		await expectRedirectRejection(download('/redirect'))

		const auth = await createAuthenticationState(useMemoryStore())
		const socket = makeWASocket({ auth })
		await socket.end(new Error('workerd packaged smoke complete'))
		return new Response('host initialized')
	}
}

async function expectRedirectRejection(download: Promise<unknown>) {
	try {
		await download
	} catch (error) {
		if (!(error instanceof TypeError) || !error.message.includes('302')) throw error
		return
	}
	throw new Error('workerd accepted a redirect')
}
