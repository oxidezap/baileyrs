import type { Logger, pino as PinoFactory } from 'pino'
import { createRequire } from 'node:module'

export interface ILogger {
	level: string
	child(obj: Record<string, unknown>): ILogger
	trace(obj: unknown, msg?: string): void
	debug(obj: unknown, msg?: string): void
	info(obj: unknown, msg?: string): void
	warn(obj: unknown, msg?: string): void
	error(obj: unknown, msg?: string): void
}

const DEFAULT_LEVEL = 'info'

const REDACTED_PATHS = [
	'creds',
	'authState',
	'noiseKey',
	'signedIdentityKey',
	'advSecretKey',
	'privateKey',
	'secretKey',
	'preKey.privateKey',
	'*.creds',
	'*.authState',
	'*.noiseKey',
	'*.signedIdentityKey',
	'*.advSecretKey',
	'*.privateKey',
	'*.secretKey'
]

/**
 * Deferred because building pino at module evaluation cost ~10 MB of RSS in every
 * importing process: ~4.5 MB for pino's module graph, the rest for the Date/ICU
 * machinery V8 materializes when the configured `timestamp` runs — which pino
 * calls while *constructing* the logger. Applications that pass their own
 * `SocketConfig.logger` never needed any of it.
 *
 * `require` rather than a dynamic `import`, because ILogger's methods are
 * synchronous: an async resolution would have to drop or queue the first lines.
 */
let rootLogger: Logger | undefined

const resolveRootLogger = (): Logger => {
	if (!rootLogger) {
		const requireFrom = createRequire(import.meta.url)
		const pino = requireFrom('pino') as typeof PinoFactory
		rootLogger = pino({
			name: 'baileyrs',
			level: process.env.BAILEYRS_LOG_LEVEL || DEFAULT_LEVEL,
			timestamp: () => `,"time":"${new Date().toJSON()}"`,
			redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' }
		})
	}
	return rootLogger
}

/**
 * Stands in for the pino logger without building it.
 *
 * A Proxy rather than a hand-written shim, because the default export is public
 * API (`@oxidezap/baileyrs/logger`) and must keep pino's whole surface — `fatal`,
 * `silent`, `flush`, `bindings`, `levels` — not just the six members ILogger
 * declares. Members are cached so a hot logging path costs a map lookup instead
 * of a fresh bound function per call.
 *
 * `child()` and reading `level` are answered without resolving, which is what
 * lets `DEFAULT_CONNECTION_CONFIG.logger` and `logger.level === 'trace'` guards
 * work while pino stays unbuilt until something actually logs.
 *
 * A child defers to its *parent* rather than to the root, so a level assigned to
 * the parent before either has resolved still reaches it — pino children inherit
 * the parent's level at creation, and resolving out of order would drop it.
 */
interface DeferredParent {
	level: () => string
	resolve: () => Logger
}

const createDeferredLogger = (bindings?: Record<string, unknown>, parent?: DeferredParent): Logger => {
	let resolved: Logger | undefined
	let pendingLevel: string | undefined
	const members = new Map<PropertyKey, unknown>()

	const resolve = (): Logger => {
		if (!resolved) {
			const source = parent ? parent.resolve() : resolveRootLogger()
			resolved = bindings ? source.child(bindings) : source
			if (pendingLevel !== undefined) resolved.level = pendingLevel
		}
		return resolved
	}
	const peekLevel = (): string =>
		resolved?.level ?? pendingLevel ?? parent?.level() ?? process.env.BAILEYRS_LOG_LEVEL ?? DEFAULT_LEVEL
	const self: DeferredParent = { level: peekLevel, resolve }

	// Typed as pino's Logger, not ILogger: narrowing would reject `logger.fatal(...)`
	// at compile time even though the proxy forwards it.
	const target = {} as Logger
	return new Proxy(target, {
		get(_target, property) {
			if (property === 'child') {
				return (extra: Record<string, unknown>): Logger => createDeferredLogger(extra, self)
			}
			if (property === 'level' && !resolved) return peekLevel()
			const cached = members.get(property)
			if (cached !== undefined) return cached
			const logger = resolve()
			const value = (logger as unknown as Record<PropertyKey, unknown>)[property]
			if (typeof value !== 'function') return value
			const bound = (value as (...args: unknown[]) => unknown).bind(logger)
			members.set(property, bound)
			return bound
		},
		set(_target, property, value) {
			if (property === 'level' && !resolved) {
				pendingLevel = value as string
				return true
			}
			;(resolve() as unknown as Record<PropertyKey, unknown>)[property] = value
			// Whole cache, not just this key: pino swaps its log methods for noops
			// when `level` changes, so a cached `info` would stay silent forever.
			members.clear()
			return true
		},
		has(_target, property) {
			return property === 'child' || property === 'level' || property in resolve()
		},
		deleteProperty(_target, property) {
			members.delete(property)
			delete (resolve() as unknown as Record<PropertyKey, unknown>)[property]
			return true
		},
		ownKeys() {
			return Reflect.ownKeys(resolve())
		},
		getOwnPropertyDescriptor(_target, property) {
			const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property)
			// Forced configurable: the proxy target is an empty extensible object,
			// and reporting a non-configurable key it does not own is a TypeError.
			return descriptor && { ...descriptor, configurable: true }
		}
	}) as Logger
}

export default createDeferredLogger()
