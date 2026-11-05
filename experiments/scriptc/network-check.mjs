import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const guard = fileURLToPath(new URL('./network-guard.mjs', import.meta.url))
test('offline guard rejects UDP, TCP and HTTP listeners as well as outbound connections', () => {
	const run = spawnSync(
		process.execPath,
		[
			'--import',
			guard,
			'--input-type=module',
			'-e',
			`
		import assert from 'node:assert/strict';
		import net from 'node:net';
		import dgram from 'node:dgram';
		import http from 'node:http';
		import https from 'node:https';
		import tls from 'node:tls';
		const blocked = /offline smoke attempted network access/;
		assert.throws(() => dgram.createSocket('udp4'), blocked);
		for (const method of ['bind', 'send', 'connect'])
			assert.throws(() => dgram.Socket.prototype[method].call({}, 0), blocked);
		for (const server of [net.createServer(), http.createServer()]) {
			assert.throws(() => server.listen(0, '127.0.0.1'), blocked);
			server.close();
		}
		assert.throws(() => net.connect(1, '127.0.0.1'), blocked);
		assert.throws(() => net.createConnection(1, '127.0.0.1'), blocked);
		assert.throws(() => tls.connect(1, '127.0.0.1'), blocked);
		for (const [client, scheme] of [[http, 'http'], [https, 'https']]) {
			assert.throws(() => client.request(scheme + '://127.0.0.1:1'), blocked);
			assert.throws(() => client.get(scheme + '://127.0.0.1:1'), blocked);
		}
		assert.throws(() => fetch('http://127.0.0.1'), blocked);
		assert.throws(() => new WebSocket('ws://127.0.0.1'), blocked);
	`
		],
		{ encoding: 'utf8', timeout: 10000 }
	)
	assert.equal(run.signal, null)
	assert.equal(run.status, 0, run.stderr)
})
