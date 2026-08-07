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
export async function startCuttableProxy(
	targetPort = 8080,
	path = '/ws/chat',
	/** Where to report infrastructure failures the proxy would otherwise swallow. */
	logger: ((message: string) => void) | undefined = message => console.error(message)
): Promise<CuttableProxy> {
	const live = new Set<Socket>()
	/**
	 * Server-side half → its client half. `freeze()` detaches the reply pipe
	 * rather than pausing the socket: `pipe()` manages flow on its own and
	 * resumes the source on `'drain'`, with no idea a manual `pause()` ever
	 * happened — so a drain arriving after `freeze()` would silently reopen the
	 * black hole the teardown test depends on staying shut.
	 */
	const replyPipes = new Map<Socket, Socket>()
	let connections = 0
	let frozen = false

	const server: Server = createServer(client => {
		connections++
		const upstream = connect(targetPort, '127.0.0.1')
		// A mock server that is down would otherwise surface as a test that
		// simply never connects, minutes later, with nothing to read.
		upstream.on('error', err => {
			logger?.(`tcp-proxy: upstream connect failed: ${(err as Error).message}`)
		})
		live.add(client)
		live.add(upstream)
		replyPipes.set(upstream, client)

		const drop = () => {
			live.delete(client)
			live.delete(upstream)
			replyPipes.delete(upstream)
			client.destroy()
			upstream.destroy()
		}
		client.on('error', drop)
		upstream.on('error', drop)
		client.on('close', drop)
		upstream.on('close', drop)

		client.pipe(upstream)
		// A connection opened while frozen starts frozen too, so a reconnect
		// mid-test cannot quietly restore the link.
		if (!frozen) upstream.pipe(client)
	})
	// Bind failures reject `startCuttableProxy` instead of being swallowed:
	// a proxy that never listened makes every test in the file time out.
	const listening = new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', reject)
			// Past bind, per-connection errors are expected (we cut them
			// ourselves) and must not take the server down.
			server.on('error', err => logger?.(`tcp-proxy: server error: ${(err as Error).message}`))
			resolve()
		})
	})
	await listening
	const address = server.address()
	if (typeof address === 'string' || address === null) throw new Error('expected a TCP address')

	return {
		url: `wss://127.0.0.1:${address.port}${path}`,
		connections: () => connections,
		cut: () => {
			for (const socket of live) socket.destroy()
			live.clear()
			replyPipes.clear()
		},
		freeze: () => {
			if (frozen) return
			frozen = true
			for (const [upstream, client] of replyPipes) upstream.unpipe(client)
		},
		thaw: () => {
			// Guarded, because `pipe()` does not dedupe its destination: piping
			// an already-piped pair adds a second `'data'` listener and every
			// server reply reaches the client twice, corrupting the wss stream
			// into failures nowhere near this file.
			if (!frozen) return
			frozen = false
			for (const [upstream, client] of replyPipes) upstream.pipe(client)
		},
		close: async () => {
			frozen = false
			for (const socket of live) socket.destroy()
			live.clear()
			replyPipes.clear()
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	}
}
