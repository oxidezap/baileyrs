import { AsyncLocalStorage } from 'node:async_hooks'
import { AsyncMutex, SerialQueue } from '../internal/async-primitives.ts'
import { makeStandaloneCacheStore } from '../internal/cache-store.ts'
import { DEFAULT_CACHE_TTLS } from '../../Defaults/index.ts'
import type {
	AuthenticationCreds,
	CacheStore,
	SignalDataSet,
	SignalDataTypeMap,
	SignalKeyStore,
	SignalKeyStoreWithTransaction,
	TransactionCapabilityOptions
} from '../../Types/index.ts'
import { Boom } from '../../Utils/boom.ts'
import { delay } from '../../Utils/generics.ts'
import type { ILogger } from '../../Utils/logger.ts'
import { PreKeyManager } from './pre-key-manager.ts'

type TransactionContext = {
	cache: SignalDataSet
	mutations: SignalDataSet
	dbQueries: number
}

export function makeCacheableSignalKeyStore(
	store: SignalKeyStore,
	logger?: ILogger,
	_cache?: CacheStore
): SignalKeyStore {
	const cache = _cache ?? makeStandaloneCacheStore(DEFAULT_CACHE_TTLS.SIGNAL_STORE)
	const cacheMutex = new AsyncMutex()
	const getUniqueId = (type: string, id: string) => `${type}.${id}`

	return {
		async get(type, ids) {
			return cacheMutex.runExclusive(async () => {
				const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
				const idsToFetch: string[] = []
				for (const id of ids) {
					const item = await cache.get<SignalDataTypeMap[typeof type]>(getUniqueId(type, id))
					if (typeof item !== 'undefined') data[id] = item
					else idsToFetch.push(id)
				}
				if (idsToFetch.length) {
					logger?.trace({ items: idsToFetch.length }, 'loading from store')
					const fetched = await store.get(type, idsToFetch)
					for (const id of idsToFetch) {
						const item = fetched[id]
						if (item) {
							data[id] = item
							await cache.set(getUniqueId(type, id), item)
						}
					}
				}
				return data
			})
		},
		async set(data) {
			await cacheMutex.runExclusive(async () => {
				let keys = 0
				for (const type in data) {
					const typeData = data[type as keyof SignalDataTypeMap]
					for (const id in typeData) {
						await cache.set(getUniqueId(type, id), typeData![id]!)
						keys++
					}
				}
				logger?.trace({ keys }, 'updated cache')
				await store.set(data)
			})
		},
		async clear() {
			await cache.flushAll()
			await store.clear?.()
		}
	}
}

export const addTransactionCapability = (
	state: SignalKeyStore,
	logger: ILogger,
	{ maxCommitRetries, delayBetweenTriesMs }: TransactionCapabilityOptions
): SignalKeyStoreWithTransaction => {
	const txStorage = new AsyncLocalStorage<TransactionContext>()
	const keyQueues = new Map<string, SerialQueue>()
	const txMutexes = new Map<string, AsyncMutex>()
	const txMutexRefCounts = new Map<string, number>()
	const preKeyManager = new PreKeyManager(state, logger)

	const getQueue = (key: string) => {
		let queue = keyQueues.get(key)
		if (!queue) {
			queue = new SerialQueue()
			keyQueues.set(key, queue)
		}
		return queue
	}
	const getTxMutex = (key: string) => {
		let mutex = txMutexes.get(key)
		if (!mutex) {
			mutex = new AsyncMutex()
			txMutexes.set(key, mutex)
			txMutexRefCounts.set(key, 0)
		}
		return mutex
	}
	const acquireTxMutexRef = (key: string) => txMutexRefCounts.set(key, (txMutexRefCounts.get(key) ?? 0) + 1)
	const releaseTxMutexRef = (key: string) => {
		const count = (txMutexRefCounts.get(key) ?? 1) - 1
		txMutexRefCounts.set(key, count)
		const mutex = txMutexes.get(key)
		if (count <= 0 && mutex && !mutex.isLocked()) {
			txMutexes.delete(key)
			txMutexRefCounts.delete(key)
		}
	}
	const isInTransaction = () => !!txStorage.getStore()

	const commitWithRetry = async (mutations: SignalDataSet) => {
		if (!Object.keys(mutations).length) {
			logger.trace('no mutations in transaction')
			return
		}
		logger.trace('committing transaction')
		for (let attempt = 0; attempt < maxCommitRetries; attempt++) {
			try {
				await state.set(mutations)
				logger.trace({ mutationCount: Object.keys(mutations).length }, 'committed transaction')
				return
			} catch (error) {
				const retriesLeft = maxCommitRetries - attempt - 1
				logger.warn(`failed to commit mutations, retries left=${retriesLeft}`)
				if (!retriesLeft) throw error
				await delay(delayBetweenTriesMs)
			}
		}
	}

	return {
		get: async (type, ids) => {
			const ctx = txStorage.getStore()
			if (!ctx) return state.get(type, ids)
			const cached = ctx.cache[type] || {}
			const missing = ids.filter(id => !(id in cached))
			if (missing.length) {
				ctx.dbQueries++
				logger.trace({ type, count: missing.length }, 'fetching missing keys in transaction')
				const fetched = await getTxMutex(type).runExclusive(() => state.get(type, missing))
				ctx.cache[type] ||= {} as never
				Object.assign(ctx.cache[type]!, fetched)
			}
			const result: Record<string, SignalDataTypeMap[typeof type]> = {}
			for (const id of ids) {
				const value = ctx.cache[type]?.[id]
				if (value !== undefined && value !== null) result[id] = value
			}
			return result
		},
		set: async data => {
			const ctx = txStorage.getStore()
			if (!ctx) {
				const types = Object.keys(data)
				for (const type_ of types) {
					const type = type_ as keyof SignalDataTypeMap
					if (type === 'pre-key') await preKeyManager.validateDeletions(data, type)
				}
				await Promise.all(
					types.map(type =>
						getQueue(type).add(async () => {
							await state.set({ [type]: data[type as keyof SignalDataTypeMap] } as SignalDataSet)
						})
					)
				)
				return
			}
			logger.trace({ types: Object.keys(data) }, 'caching in transaction')
			for (const key_ in data) {
				const key = key_ as keyof SignalDataTypeMap
				ctx.cache[key] ||= {} as never
				ctx.mutations[key] ||= {} as never
				if (key === 'pre-key') {
					await preKeyManager.processOperations(data, key, ctx.cache, ctx.mutations, true)
				} else {
					Object.assign(ctx.cache[key]!, data[key])
					Object.assign(ctx.mutations[key]!, data[key])
				}
			}
		},
		isInTransaction,
		transaction: async (work, key) => {
			if (txStorage.getStore()) {
				logger.trace('reusing existing transaction context')
				return work()
			}
			const mutex = getTxMutex(key)
			acquireTxMutexRef(key)
			try {
				return await mutex.runExclusive(async () => {
					const ctx: TransactionContext = { cache: {}, mutations: {}, dbQueries: 0 }
					logger.trace('entering transaction')
					try {
						const result = await txStorage.run(ctx, work)
						await commitWithRetry(ctx.mutations)
						logger.trace({ dbQueries: ctx.dbQueries }, 'transaction completed')
						return result
					} catch (error) {
						logger.error({ error }, 'transaction failed, rolling back')
						throw error
					}
				})
			} finally {
				releaseTxMutexRef(key)
			}
		}
	}
}

export const assertMeId = (creds: AuthenticationCreds): string => {
	const id = creds.me?.id
	if (!id) {
		throw new Boom('Cannot proceed: socket is not authenticated yet (creds.me.id is missing)', { statusCode: 401 })
	}
	return id
}
