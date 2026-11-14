import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { test } from 'node:test'
import { probeMock, waitForMock } from '../ci/wait-for-mock.mjs'

async function listen(t, server) {
	const sockets = new Set()
	server.on('connection', socket => {
		sockets.add(socket)
		socket.on('close', () => sockets.delete(socket))
	})
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	t.after(
		() =>
			new Promise(resolve => {
				for (const socket of sockets) socket.destroy()
				server.close(resolve)
			})
	)
	return `http://127.0.0.1:${server.address().port}/api/status`
}

test('accepts a completed HTTP 200 from the status route', async t => {
	const url = await listen(
		t,
		createServer((request, response) => {
			assert.equal(request.url, '/api/status')
			response.writeHead(200).end('{"status":"ok"}')
		})
	)
	await probeMock(url, 500)
})

for (const status of [204, 301, 302, 404, 500, 503]) {
	test(`rejects HTTP ${status} instead of reporting readiness`, async t => {
		const url = await listen(
			t,
			createServer((_, response) => {
				response.writeHead(status, { location: '/api/status' }).end()
			})
		)
		await assert.rejects(probeMock(url, 500), new RegExp(`HTTP ${status}`))
	})
}

test('an open TCP port without an HTTP response is not ready', async t => {
	const server = createTcpServer(socket => {
		socket.on('error', () => {})
		t.after(() => socket.destroy())
	})
	const url = await listen(t, server)
	await assert.rejects(probeMock(url, 50), /timed out/)
})

test('a response that starts but never finishes is not ready', async t => {
	const url = await listen(
		t,
		createServer((_, response) => {
			response.writeHead(200)
			response.write('unfinished')
		})
	)
	await assert.rejects(probeMock(url, 50), /timed out|aborted/)
})

test('retries service errors and succeeds only after HTTP 200', async t => {
	let requests = 0
	const url = await listen(
		t,
		createServer((_, response) => {
			response.writeHead(++requests < 3 ? 503 : 200).end()
		})
	)
	await waitForMock({ url, budgetMs: 1000, requestTimeoutMs: 100, intervalMs: 1 })
	assert.equal(requests, 3)
})

for (const finalError of [
	new Error('Mock status endpoint returned HTTP 503'),
	new Error('Mock HTTP probe timed out')
]) {
	test(`permanent failure preserves the last error and exhausts the bounded budget: ${finalError.message}`, async () => {
		let time = 0
		const timeouts = []
		const sleeps = []
		await assert.rejects(
			waitForMock(
				{ url: 'http://127.0.0.1/api/status', budgetMs: 60, requestTimeoutMs: 20, intervalMs: 1 },
				{
					now: () => time,
					probe: async (url, timeoutMs) => {
						assert.equal(url, 'http://127.0.0.1/api/status')
						timeouts.push(timeoutMs)
						time += timeoutMs
						throw time >= 60 ? finalError : new Error('Mock status endpoint returned HTTP 503')
					},
					sleep: async ms => {
						sleeps.push(ms)
						time += ms
					}
				}
			),
			error => /deadline/.test(error.message) && error.cause === finalError
		)
		assert.equal(time, 60)
		assert.deepEqual(timeouts, [20, 20, 18])
		assert.deepEqual(sleeps, [1, 1])
	})
}

test('rejects remote endpoints before making a request', async () => {
	await assert.rejects(probeMock('https://example.test/api/status', 100), /loopback/)
})
