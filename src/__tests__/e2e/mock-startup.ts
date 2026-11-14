import { proto } from '../../index.ts'

interface HistorySource {
	ev: {
		on(event: 'messaging-history.set', listener: (update: { syncType?: number | null }) => void): unknown
		off(event: 'messaging-history.set', listener: (update: { syncType?: number | null }) => void): unknown
	}
}

/**
 * Bartender sends fresh phone sessions with its startup history sequence on
 * every login, including restored logins. Offline-drain completion precedes
 * that sequence. Starting traffic then can advance a session the mock is
 * still replacing, causing a DSM MAC failure and an error ACK instead of
 * delivery. Subscribe before connecting and wait for its final history chunk.
 * This is a mock readiness condition, not a production connection contract.
 */
export function waitForMockHistory(sock: HistorySource, timeoutMs = 30_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer)
			sock.ev.off('messaging-history.set', onHistory)
		}
		const onHistory = (update: { syncType?: number | null }) => {
			if (update.syncType !== proto.HistorySync.HistorySyncType.NON_BLOCKING_DATA) return
			cleanup()
			resolve()
		}
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error('Timed out waiting for mock startup history'))
		}, timeoutMs)
		sock.ev.on('messaging-history.set', onHistory)
	})
}

/** Observe both startup branches immediately, including a later second failure. */
export async function waitForMockStartup<T>(connection: Promise<T>, history: Promise<void>): Promise<T> {
	const [result] = await Promise.all([connection, history])
	return result
}
