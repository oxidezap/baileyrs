import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'

/** Service HTTP readiness only. Each test must still await its own session sync. */
export function probeMock(url, timeoutMs) {
	return new Promise((resolve, reject) => {
		const endpoint = new URL(url)
		if (
			!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
			!['http:', 'https:'].includes(endpoint.protocol) ||
			endpoint.username ||
			endpoint.password
		) {
			reject(new Error('Mock readiness endpoint must be a loopback HTTP(S) URL'))
			return
		}

		// The private mock uses a self-signed certificate. This exception is local
		// to this loopback probe, never a process-wide TLS setting.
		const get = endpoint.protocol === 'https:' ? httpsGet : httpGet
		const request = get(endpoint, { rejectUnauthorized: false }, response => {
			response.on('error', reject)
			response.resume()
			response.on('end', () => {
				if (response.statusCode === 200) resolve()
				else reject(new Error(`Mock status endpoint returned HTTP ${response.statusCode}`))
			})
		})
		// An absolute request deadline also covers a peer that accepts TCP and
		// never sends headers, or streams a response without finishing it.
		const timer = setTimeout(() => request.destroy(new Error('Mock HTTP probe timed out')), timeoutMs)
		request.on('error', reject)
		request.on('close', () => clearTimeout(timer))
	})
}

export async function waitForMock(
	{ url = 'https://127.0.0.1:8080/api/status', budgetMs = 30_000, requestTimeoutMs = 2_000, intervalMs = 1_000 } = {},
	{ probe = probeMock, now = () => performance.now(), sleep = delay } = {}
) {
	const deadline = now() + budgetMs
	let lastError = new Error('No probe completed')
	while (now() < deadline) {
		try {
			await probe(url, Math.min(requestTimeoutMs, deadline - now()))
			return
		} catch (error) {
			lastError = error
		}
		const remaining = deadline - now()
		if (remaining > 0) await sleep(Math.min(intervalMs, remaining))
	}
	throw new Error('Mock HTTP service did not become ready within its deadline', { cause: lastError })
}

if (import.meta.main) {
	try {
		await waitForMock()
		console.log('Mock HTTP service is ready; client synchronization is checked by each test')
	} catch (error) {
		console.error(error.message, error.cause?.message ?? '')
		process.exitCode = 1
	}
}
