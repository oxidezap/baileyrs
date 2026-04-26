/**
 * In-test "phone simulator" that reads the first QR a `makeWASocket` client
 * publishes via `connection.update` and POSTs it to the mock server's
 * `/admin/mock-phone/scan-qr` endpoint.
 *
 * Mock servers that follow the scan-driven pairing model only send
 * `<pair-success>` after a scan is submitted; external e2e harnesses
 * without a real phone need this helper to unblock pairing. The endpoint
 * accepts the raw 5-field QR string in the request body.
 */

import type { makeWASocket } from '../../index.ts'

type WASocket = ReturnType<typeof makeWASocket>

/** Translate a `ws[s]://host:port/ws/chat` URL into the matching admin
 * `https?://host:port/admin/mock-phone/scan-qr` URL the mock exposes. */
export function mockAdminScanQrUrl(socketUrl: string): string {
	const httpScheme = socketUrl.startsWith('wss://') ? 'https://' : 'http://'
	const afterScheme = socketUrl.split('://')[1] ?? socketUrl
	const hostPort = afterScheme.split('/')[0] ?? afterScheme
	return `${httpScheme}${hostPort}/admin/mock-phone/scan-qr`
}

/**
 * Subscribe to `sock.ev.on('connection.update', …)` and forward the first QR
 * to `mockAdminScanQrUrl(socketUrl)`. Returns an unsubscribe function so
 * tests can clean up on teardown.
 *
 * The test:e2e script sets `NODE_TLS_REJECT_UNAUTHORIZED=0` so `fetch`
 * accepts the mock's self-signed certificate.
 */
export function attachQrAutoresponder(sock: WASocket, socketUrl: string): () => void {
	const url = mockAdminScanQrUrl(socketUrl)
	let succeeded = false
	let inflight = false

	const listener = async (update: { qr?: string }) => {
		// `succeeded` permanently latches once the mock acks the scan; `inflight`
		// just prevents racing duplicate POSTs while one is still pending. A
		// failed first attempt must remain retryable because WA rotates QR
		// values on a timer and the listener will see each rotation.
		if (succeeded || inflight || !update.qr) return
		inflight = true
		try {
			const resp = await fetch(url, {
				method: 'POST',
				body: update.qr,
				headers: { 'content-type': 'text/plain' }
			})
			if (resp.ok) {
				succeeded = true
			} else {
				const text = await resp.text().catch(() => '')
				console.error(`qr-autoresponder: admin POST returned ${resp.status}: ${text}`)
			}
		} catch (e) {
			console.error(`qr-autoresponder: admin POST failed: ${(e as Error).message}`)
		} finally {
			inflight = false
		}
	}

	sock.ev.on('connection.update', listener)
	return () => sock.ev.off('connection.update', listener)
}
