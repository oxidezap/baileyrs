import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { makeHttpClient } from '../Socket/transport.ts'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'

test('bridge HTTP rejects redirects before reaching their destination, including caller follow options', async () => {
	let destinationRequests = 0
	const server = createServer((request, response) => {
		if (request.url === '/redirect') {
			response.writeHead(302, { location: '/destination' }).end()
		} else {
			destinationRequests++
			response.end('ok')
		}
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	try {
		const address = server.address()
		assert.ok(address && typeof address === 'object')
		const url = `http://127.0.0.1:${address.port}`
		const client = makeHttpClient({ ...DEFAULT_CONNECTION_CONFIG, options: { redirect: 'follow' } })
		await assert.rejects(client.execute(`${url}/redirect`, 'GET', {}, null))
		assert.equal(destinationRequests, 0)
		const result = await client.execute(`${url}/destination`, 'GET', {}, null)
		assert.equal(result.statusCode, 200)
		assert.equal(new TextDecoder().decode(result.body), 'ok')
		assert.equal(destinationRequests, 1)
	} finally {
		await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
	}
})

test('bridge HTTP rejects opaque and status-zero responses from host fetch', async t => {
	for (const type of ['opaque', 'opaqueredirect', 'error'] as const) {
		t.mock.method(globalThis, 'fetch', async () => ({ type, status: 0 }))
		await assert.rejects(
			makeHttpClient(DEFAULT_CONNECTION_CONFIG).execute('https://example.invalid', 'GET', {}, null),
			/unobservable/
		)
		t.mock.restoreAll()
	}
})

test('bridge HTTP rejects the full 3xx range even without Location and releases the body', async t => {
	const client = makeHttpClient(DEFAULT_CONNECTION_CONFIG)
	for (const status of [300, 304, 399]) {
		const response = new Response(status === 304 ? null : 'moved', { status })
		const cancel = response.body && t.mock.method(response.body, 'cancel')
		t.mock.method(globalThis, 'fetch', async () => response)
		await assert.rejects(client.execute('https://example.invalid', 'GET', {}, null), /redirect/i)
		if (cancel) assert.equal(cancel.mock.callCount(), 1)
		t.mock.restoreAll()
	}
})

test('bridge HTTP preserves HTTP errors and their response bytes for the bridge', async t => {
	const body = Uint8Array.of(0, 255)
	t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 404 }))
	const client = makeHttpClient(DEFAULT_CONNECTION_CONFIG)
	assert.deepEqual(await client.execute('https://example.invalid', 'GET', {}, null), { statusCode: 404, body })
})
