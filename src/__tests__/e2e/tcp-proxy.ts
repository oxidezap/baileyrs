/**
 * A cuttable TCP proxy in front of the mock server.
 *
 * Simulating a network drop needs the connection to die underneath the socket
 * without anyone asking it to — no `end()`, no `setAutoReconnect`, so the
 * engine sees an unexpected read-loop exit and starts its Fibonacci backoff.
 * Reaching into the socket's own WebSocket wrapper does not do that: the
 * bridge owns the real transport, and closing the JS side is a request, not a
 * drop.
 *
 * Byte-level forwarding is enough even though the tunnel is `wss:` — TLS
 * terminates end to end between the client and the mock server, so the proxy
 * never has to understand it.
 */

import { connect, createServer, type Server, type Socket } from 'node:net'

export interface CuttableProxy {
	/** `wss://` URL to hand to `makeWASocket`, pointing at this proxy. */
	url: string
	/** Kill every live connection, the way a dropped network does. */
	cut: () => void
	/**
	 * Stop relaying server→client bytes while leaving the connection open — a
	 * black-holed link. Requests reach the server, replies never come back, so
	 * a bridge call stays pending inside wasm for as long as we want. That is
	 * the only way to hold the window open against a local mock, which answers
	 * everything faster than a teardown can race it.
	 */
	freeze: () => void
	/** Resume relaying. */
	thaw: () => void
	/** How many connections have been accepted since start. */
	connections: () => number
	close: () => Promise<void>
}

/**
 * @param targetPort port of the mock server (default 8080)
 * @param path       websocket path appended to the returned URL
 */
export async function startCuttableProxy(targetPort = 8080, path = '/ws/chat'): Promise<CuttableProxy> {
	const live = new Set<Socket>()
	/** Server-side halves, so `freeze()` can stall just the reply direction. */
	const upstreams = new Set<Socket>()
	let connections = 0
	let frozen = false

	const server: Server = createServer(client => {
		connections++
		const upstream = connect(targetPort, '127.0.0.1')
		live.add(client)
		live.add(upstream)
		upstreams.add(upstream)
		// A connection opened while frozen starts frozen too, so a reconnect
		// mid-test cannot quietly restore the link.
		if (frozen) upstream.pause()

		const drop = () => {
			live.delete(client)
			live.delete(upstream)
			upstreams.delete(upstream)
			client.destroy()
			upstream.destroy()
		}
		client.on('error', drop)
		upstream.on('error', drop)
		client.on('close', drop)
		upstream.on('close', drop)

		client.pipe(upstream)
		upstream.pipe(client)
	})
	server.on('error', () => {})

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (typeof address === 'string' || address === null) throw new Error('expected a TCP address')

	return {
		url: `wss://127.0.0.1:${address.port}${path}`,
		connections: () => connections,
		cut: () => {
			for (const socket of live) socket.destroy()
			live.clear()
			upstreams.clear()
		},
		freeze: () => {
			frozen = true
			for (const upstream of upstreams) upstream.pause()
		},
		thaw: () => {
			frozen = false
			for (const upstream of upstreams) upstream.resume()
		},
		close: async () => {
			frozen = false
			for (const socket of live) socket.destroy()
			live.clear()
			upstreams.clear()
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	}
}
