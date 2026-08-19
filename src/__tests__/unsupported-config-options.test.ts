/**
 * An option this library does not read should say so, once, instead of looking
 * configured.
 *
 * `SocketConfig` is the upstream Baileys shape, and a drop-in replacement has to
 * accept all of it — that is the point. But the engine owns keepalive, retry,
 * history sync, link previews and its own message and group caches, so a good
 * half of those keys have no reader on this side. Passing them is not an error
 * and must never throw. It is silently believing them that costs.
 *
 * Two real shapes that took a while to find in a consumer:
 *
 *   cachedGroupMetadata: async jid => myOwnCache.get(jid)   // never called
 *   getMessage: async key => myStore.get(key.id)            // never called
 *
 * Both had been dead for months, and the README's migration notes actively
 * encouraged keeping them ("you can still pass them — they're respected as
 * overrides"), which is the sentence this change makes true again by removing
 * it. `enableRecentMessageCache: true` reads worse still: it names a cache the
 * consumer believes it turned on.
 *
 * The warning is one line per socket, at construction, listing only keys the
 * caller passed explicitly; a default-only config is silent. Per socket and not
 * per process on purpose — `Socket/internals.ts` uses the same rule for its own
 * no-op notice, and a replacement socket after a terminal close is a new
 * configuration decision, not a repeat of the old one.
 */

import { describe, it } from 'node:test'

import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import {
	unsupportedConfigKeys,
	UNSUPPORTED_CONFIG_KEYS,
	READ_CONFIG_KEYS,
	warnUnsupportedConfig
} from '../Socket/unsupported-config.ts'
import { expect } from './expect.ts'

describe('unsupportedConfigKeys', () => {
	it('names an option the engine owns', () => {
		expect(unsupportedConfigKeys({ getMessage: async () => undefined })).toEqual(['getMessage'])
	})

	// Catalog order, not caller order: stable across consumers, so the warning
	// reads the same for the same set of options however the config was built.
	it('lists several in a stable order', () => {
		const keys = unsupportedConfigKeys({
			markOnlineOnConnect: true,
			browser: ['x', 'y', 'z'],
			cachedGroupMetadata: async () => undefined
		})

		expect(keys).toEqual(['markOnlineOnConnect', 'cachedGroupMetadata'])
	})

	it('stays quiet for a config of only supported options', () => {
		expect(unsupportedConfigKeys({ browser: ['x', 'y', 'z'], emitOwnEvents: false })).toEqual([])
	})

	it('stays quiet for an empty config', () => {
		expect(unsupportedConfigKeys({})).toEqual([])
	})

	it('ignores a key set to undefined, which reads as not passed', () => {
		expect(unsupportedConfigKeys({ getMessage: undefined })).toEqual([])
	})

	// A key that is not in `SocketConfig` would silently never fire. That is
	// caught at compile time by the `satisfies ReadonlyArray<keyof SocketConfig>`
	// on the catalog — stronger than a runtime check, which cannot see the
	// optional members (`msgRetryCounterCache` has no default, so it is absent
	// from `DEFAULT_CONNECTION_CONFIG` while being a perfectly real option).
	// What is worth asserting here is that the catalog is coherent with itself.
	it('is a catalog, not a list with repeats', () => {
		expect(new Set(UNSUPPORTED_CONFIG_KEYS).size).toBe(UNSUPPORTED_CONFIG_KEYS.length)
	})

	// The keys that do carry a default must match it exactly; a typo in one of
	// those is the mistake a compile-time check cannot make obvious.
	it('agrees with the defaults on every key that has one', () => {
		const withDefaults = UNSUPPORTED_CONFIG_KEYS.filter(key => key in DEFAULT_CONNECTION_CONFIG)

		expect(withDefaults.length > 10).toBe(true)
		expect(unsupportedConfigKeys(DEFAULT_CONNECTION_CONFIG)).toEqual(withDefaults)
	})

	it('does not claim an option the library reads', () => {
		for (const supported of ['browser', 'auth', 'version', 'logger', 'emitOwnEvents', 'shouldIgnoreJid']) {
			expect(UNSUPPORTED_CONFIG_KEYS.includes(supported as never)).toBe(false)
		}
	})
})

/**
 * The warning itself. One line, at construction, naming the keys — so the
 * consumer finds it the first time it looks at the log, not months later while
 * debugging why its `cachedGroupMetadata` never ran.
 */
describe('warnUnsupportedConfig', () => {
	const collect = (config: object) => {
		const warnings: Array<{ payload: Record<string, unknown>; message: string }> = []
		const logger = {
			trace() {},
			debug() {},
			info() {},
			warn(payload: Record<string, unknown>, message: string) {
				warnings.push({ payload, message })
			},
			error() {},
			child() {
				return logger
			}
		}
		warnUnsupportedConfig(config, logger as never)
		return warnings
	}

	it('names every unsupported key the caller passed', () => {
		const warnings = collect({ getMessage: async () => undefined, markOnlineOnConnect: true })

		expect(warnings.length).toBe(1)
		expect(warnings[0]?.payload.options).toEqual(['markOnlineOnConnect', 'getMessage'])
	})

	it('points at the engine rather than blaming the caller', () => {
		const warnings = collect({ getMessage: async () => undefined })

		expect(warnings[0]?.message.includes('engine')).toBe(true)
	})

	it('says nothing when there is nothing to say', () => {
		expect(collect({ browser: ['x', 'y', 'z'] }).length).toBe(0)
	})

	// A socket must never fail to build over a diagnostic — and that has to hold
	// for a logger that throws, not just one that is missing. A synchronous
	// transport failing inside `warn` would otherwise take down `makeWASocket`
	// itself, and only for consumers who passed an inert option: the one group
	// this warning exists to help.
	it('survives a logger without warn', () => {
		warnUnsupportedConfig({ getMessage: async () => undefined }, {} as never)
	})

	it('survives a logger whose warn throws', () => {
		const throwing = {
			warn() {
				throw new Error('logging transport is down')
			}
		}

		warnUnsupportedConfig({ getMessage: async () => undefined }, throwing as never)
	})
})

/**
 * Completeness, which is where the first version of this catalog went wrong.
 *
 * It shipped missing twelve keys — `connectTimeoutMs` among them, whose own
 * doc comment in `Socket/internals.ts` says it "reaches neither the transport
 * nor the core". A hand-maintained list that the README calls authoritative has
 * to be provably complete, or it quietly grants the same false confidence it
 * exists to remove.
 *
 * So every member of `SocketConfig` is classified as read or unread, and the
 * type-level assertion in the module fails the build when a new option belongs
 * to neither. These runtime checks cover the other half: no key claimed by both
 * lists, and none by neither among the ones that carry a default.
 */
describe('the classification covers SocketConfig', () => {
	it('never puts a key in both lists', () => {
		const unread = new Set<string>(UNSUPPORTED_CONFIG_KEYS)
		expect(READ_CONFIG_KEYS.filter(key => unread.has(key))).toEqual([])
	})

	it('classifies every option that carries a default', () => {
		const classified = new Set<string>([...UNSUPPORTED_CONFIG_KEYS, ...READ_CONFIG_KEYS])
		const unclassified = Object.keys(DEFAULT_CONNECTION_CONFIG).filter(key => !classified.has(key))

		expect(unclassified).toEqual([])
	})

	// The specific misses that motivated this block, so a regression names itself.
	it('catalogs the options the first version missed', () => {
		for (const key of [
			'connectTimeoutMs',
			'qrTimeout',
			'printQRInTerminal',
			'ignoreOfflineMessages',
			'downloadHistory',
			'mediaCache',
			'userDevicesCache',
			'callOfferCache',
			'placeholderResendCache',
			'agent',
			'fetchAgent',
			'mobile'
		]) {
			expect(UNSUPPORTED_CONFIG_KEYS.includes(key as never)).toBe(true)
		}
	})
})
