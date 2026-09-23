import type { BrowsersMap } from '../Types/index.ts'
import { proto } from '../WAProto/runtime.ts'

const PLATFORM_MAP = {
	aix: 'AIX',
	darwin: 'Mac OS',
	win32: 'Windows',
	android: 'Android',
	freebsd: 'FreeBSD',
	openbsd: 'OpenBSD',
	sunos: 'Solaris',
	linux: undefined,
	haiku: undefined,
	cygwin: undefined,
	netbsd: undefined
}

export const Browsers: BrowsersMap = {
	ubuntu: browser => ['Ubuntu', browser, '22.04.4'],
	macOS: browser => ['Mac OS', browser, '14.4.1'],
	baileys: browser => ['Baileys', browser, '6.5.0'],
	windows: browser => ['Windows', browser, '10.0.22631'],
	android: osVersion => [osVersion, 'Android', ''],
	appropriate: browser => [
		PLATFORM_MAP[resolvePlatform() as keyof typeof PLATFORM_MAP] || 'Ubuntu',
		browser,
		resolveRelease()
	]
}

/**
 * Host-overridable platform identity behind `Browsers.appropriate()`.
 * Defaults to the Node values; hosts set it once via `setPlatformInfo()`
 * (stable Ubuntu fallback when unset) instead of branching on runtimes.
 */
let platformOverride: { os: string; release: string } | undefined

export const setPlatformInfo = (info: { os: string; release: string } | undefined): void => {
	platformOverride = info
}

const resolvePlatform = (): string => platformOverride?.os ?? nodePlatform()

const resolveRelease = (): string => platformOverride?.release ?? nodeRelease()

// Same lazy-builtin shape as the release below: `process.platform` is
// available on hosts that polyfill it, otherwise the stable fallback.
const nodePlatform = (): string => {
	try {
		const value = (
			globalThis as unknown as {
				process?: { platform?: unknown; getBuiltinModule?: (id: string) => { platform?: () => string } }
			}
		).process
		if (typeof value?.platform === 'string') return value.platform
		const builtin = value?.getBuiltinModule?.('os')?.platform?.()
		if (typeof builtin === 'string') return builtin
	} catch {
		/* fall through to the stable fallback */
	}
	return 'linux'
}

// `node:os` is the only reader: dynamic import keeps the static graph
// host-neutral (workerd has no node:os) while preserving the exact Node
// values. Synchronous require would reintroduce the static import.
let cachedRelease: string | undefined
const nodeRelease = (): string => {
	if (cachedRelease !== undefined) return cachedRelease
	try {
		const os = (
			globalThis as unknown as {
				process?: { getBuiltinModule?: (id: string) => { release?: () => string } }
			}
		).process?.getBuiltinModule?.('os')
		const value = os?.release?.()
		if (typeof value === 'string' && value.length > 0) {
			cachedRelease = value
			return value
		}
	} catch {
		/* fall through to the stable fallback */
	}
	cachedRelease = '22.04.4'
	return cachedRelease
}

export const getPlatformId = (browser: string): string => {
	// Generated enum objects support reverse name lookup at runtime.
	const platformType =
		proto.DeviceProps.PlatformType[browser.toUpperCase() as keyof typeof proto.DeviceProps.PlatformType]
	return platformType ? platformType.toString() : '1'
}
