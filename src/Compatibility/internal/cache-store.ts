import type { CacheStore } from '../../Types/index.ts'
import { ExpiringLruMap } from './expiring-lru-map.ts'

/**
 * In-process cache for the explicitly standalone `makeCacheableSignalKeyStore`
 * facade. Connected clients keep their authoritative cache in the core.
 */
export const makeStandaloneCacheStore = (ttlSeconds: number): CacheStore => {
	const entries = new ExpiringLruMap<string, unknown>({ ttl: ttlSeconds * 1000 })

	return {
		get: <T>(key: string) => entries.get(key) as T | undefined,
		set: <T>(key: string, value: T) => {
			entries.set(key, value)
			return true
		},
		del: (key: string) => (entries.delete(key) ? 1 : 0),
		flushAll: () => entries.clear(),
		close: () => entries.clear()
	}
}
