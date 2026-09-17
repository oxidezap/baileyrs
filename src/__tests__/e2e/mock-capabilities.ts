/**
 * Which mock image the e2e suite talks to, probed live.
 *
 * The barback-based image answers an admin benchmark status route the older
 * mock never had; anything else (connection refused, 404, TLS failure)
 * reads as the legacy image. Capability gates below use this to skip tests
 * the connected mock cannot back, instead of timing out against it.
 */

const adminBase = (socketUrl: string): string => {
	const http = socketUrl.startsWith('wss://') ? 'https://' : 'http://'
	const afterScheme = socketUrl.split('://')[1] ?? socketUrl
	return `${http}${afterScheme.split('/')[0] ?? afterScheme}`
}

/** True when the mock answers the barback admin benchmark route. */
export const isBarbackMock = async (socketUrl: string): Promise<boolean> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 5000)
	try {
		const response = await fetch(`${adminBase(socketUrl)}/admin/benchmark`, {
			signal: controller.signal
		})
		return response.status !== 404
	} catch {
		return false
	} finally {
		clearTimeout(timer)
	}
}
