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

/** Options accepted by `child()`. A subset of the peer's own shape. */
export interface ChildLoggerOptions {
	level?: string
	[msgPrefix: string]: unknown
}

/**
 * The full logger surface behind the default export. Structural so both the
 * peer logger and the local fallback satisfy it; deliberately free of any
 * `pino` import so consumers typecheck with or without the peer installed.
 */
export interface Logger {
	level: string
	child(bindings: Record<string, unknown>, options?: ChildLoggerOptions): Logger
	trace(...args: unknown[]): void
	debug(...args: unknown[]): void
	info(...args: unknown[]): void
	warn(...args: unknown[]): void
	error(...args: unknown[]): void
	fatal(...args: unknown[]): void
	silent(...args: unknown[]): void
	flush(callback?: () => void): void
	bindings(): Record<string, unknown>
	levels: { values: Record<string, number>; labels: Record<number, string> }
	isLevelEnabled(level: string): boolean
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

const FALLBACK_LEVEL_VALUES: Record<string, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
	silent: Infinity
}

const FALLBACK_LEVEL_LABELS: Record<number, string> = Object.fromEntries(
	Object.entries(FALLBACK_LEVEL_VALUES).map(([name, value]) => [value, name])
)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const censorPath = (root: Record<string, unknown>, path: string): void => {
	if (path.startsWith('*.')) {
		const key = path.slice(2)
		for (const value of Object.values(root)) {
			if (isPlainObject(value) && key in value) value[key] = '[REDACTED]'
		}
		if (key in root) root[key] = '[REDACTED]'
		return
	}
	const segments = path.split('.')
	let current: unknown = root
	for (let index = 0; index < segments.length - 1; index++) {
		if (!isPlainObject(current)) return
		current = current[segments[index]!]
	}
	if (isPlainObject(current)) {
		const leaf = segments[segments.length - 1]!
		if (leaf in current) current[leaf] = '[REDACTED]'
	}
}

const redactForFallback = (value: unknown): unknown => {
	if (!isPlainObject(value)) return value
	const copy = structuredClone(value)
	for (const path of REDACTED_PATHS) censorPath(copy, path)
	return copy
}

interface FallbackState {
	level: string
	bindings: Record<string, unknown>
}

/**
 * Console-backed logger used only when `pino` is not installed. Emits one
 * JSON line per call with the same `level`/`time`/`msg` shape operators
 * already parse, redacts the same credential paths, and honors `level` and
 * `child` bindings so level-gated code keeps working.
 */
const createFallbackLogger = (state: FallbackState): Logger => {
	const isEnabled = (method: string): boolean => {
		if (state.level === 'silent') return false
		return (FALLBACK_LEVEL_VALUES[method] ?? 60) >= (FALLBACK_LEVEL_VALUES[state.level] ?? 30)
	}

	const write = (method: string, args: unknown[]): void => {
		if (!isEnabled(method)) return
		let logged: unknown
		let message: string | undefined
		const [first, second] = args
		if (typeof first === 'string') {
			message = args.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join(' ')
		} else {
			logged = redactForFallback(first)
			if (typeof second === 'string') message = second
		}
		const entry: Record<string, unknown> = {
			level: FALLBACK_LEVEL_VALUES[method] ?? 30,
			time: new Date().toJSON(),
			...state.bindings
		}
		if (isPlainObject(logged)) Object.assign(entry, logged)
		else if (logged !== undefined) entry.data = logged
		if (message !== undefined) entry.msg = message
		process.stdout.write(`${JSON.stringify(entry)}\n`)
	}

	const logger: Logger = {
		get level() {
			return state.level
		},
		set level(next: string) {
			state.level = next
		},
		child: (extra: Record<string, unknown>, options?: ChildLoggerOptions): Logger =>
			createFallbackLogger({
				level: options?.level ?? state.level,
				bindings: { ...state.bindings, ...extra }
			}),
		trace: (...args: unknown[]) => write('trace', args),
		debug: (...args: unknown[]) => write('debug', args),
		info: (...args: unknown[]) => write('info', args),
		warn: (...args: unknown[]) => write('warn', args),
		error: (...args: unknown[]) => write('error', args),
		fatal: (...args: unknown[]) => write('fatal', args),
		silent: () => {},
		flush: (callback?: () => void) => callback?.(),
		bindings: () => ({ ...state.bindings }),
		levels: { values: { ...FALLBACK_LEVEL_VALUES }, labels: { ...FALLBACK_LEVEL_LABELS } },
		isLevelEnabled: (level: string) => {
			if (state.level === 'silent') return false
			return (FALLBACK_LEVEL_VALUES[level] ?? Infinity) >= (FALLBACK_LEVEL_VALUES[state.level] ?? 30)
		}
	}
	return logger
}

type PinoFactory = (options: Record<string, unknown>) => Logger

const loadPinoPeer = (): PinoFactory | undefined => {
	try {
		return createRequire(import.meta.url)('pino') as PinoFactory
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND') return undefined
		throw error
	}
}

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
		const configuredLevel = process.env.BAILEYRS_LOG_LEVEL || DEFAULT_LEVEL
		const peer = loadPinoPeer()
		rootLogger = peer
			? peer({
					name: 'baileyrs',
					level: configuredLevel,
					timestamp: () => `,"time":"${new Date().toJSON()}"`,
					redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' }
				})
			: createFallbackLogger({ level: configuredLevel, bindings: { name: 'baileyrs' } })
	}
	return rootLogger
}

/**
 * Stands in for the built logger without building it.
 *
 * A Proxy rather than a hand-written shim, because the default export is public
 * API (`@oxidezap/baileyrs/logger`) and must keep the whole surface — `fatal`,
 * `silent`, `flush`, `bindings`, `levels` — not just the six members ILogger
 * declares. Members are cached so a hot logging path costs a map lookup instead
 * of a fresh bound function per call.
 *
 * `child()` and reading `level` are answered without resolving, which is what
 * lets `DEFAULT_CONNECTION_CONFIG.logger` and `logger.level === 'trace'` guards
 * work while the underlying logger stays unbuilt until something actually logs.
 *
 * A child defers to its *parent* rather than to the root, so a level assigned to
 * the parent before either has resolved still reaches it — pino children inherit
 * the parent's level at creation, and resolving out of order would drop it.
 */
interface DeferredParent {
	level: () => string
	resolve: () => Logger
}

const createDeferredLogger = (
	bindings?: Record<string, unknown>,
	parent?: DeferredParent,
	childOptions?: ChildLoggerOptions
): Logger => {
	let resolved: Logger | undefined
	let pendingLevel: string | undefined
	const members = new Map<PropertyKey, unknown>()

	const resolve = (): Logger => {
		if (!resolved) {
			const source = parent ? parent.resolve() : resolveRootLogger()
			resolved = bindings ? source.child(bindings, childOptions) : source
			if (pendingLevel !== undefined) resolved.level = pendingLevel
		}
		return resolved
	}
	const peekLevel = (): string =>
		resolved?.level ??
		pendingLevel ??
		childOptions?.level ??
		parent?.level() ??
		process.env.BAILEYRS_LOG_LEVEL ??
		DEFAULT_LEVEL
	const self: DeferredParent = { level: peekLevel, resolve }
	// Hoisted so `logger.child` keeps the stable identity a plain property has.
	const child = (extra: Record<string, unknown>, options?: ChildLoggerOptions): Logger =>
		createDeferredLogger(extra, self, options)

	// Typed as the full Logger, not ILogger: narrowing would reject
	// `logger.fatal(...)` at compile time even though the proxy forwards it.
	const target = {} as Logger
	return new Proxy(target, {
		get(_target, property) {
			if (property === 'child') return child
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
			// Whole cache, not just this key: the peer swaps its log methods for noops
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
		defineProperty(_target, property, descriptor) {
			// Forwarded, or the definition would land on the empty target while
			// every other trap kept answering from the resolved logger.
			members.clear()
			return Reflect.defineProperty(resolve(), property, descriptor)
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
