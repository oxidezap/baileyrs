// Public classifier for the namespaces the bridge parks in a consumer's key store.
import { StoreCatalog } from './constants.ts'

/**
 * Namespace prefix reserved for bridge-internal state. Every namespace the
 * routing catalog writes back to a legacy key store starts with it, and no
 * Baileys Signal namespace does, so the prefix is treated as reserved: a
 * namespace added to the catalog later is classified without a code change.
 */
export const BRIDGE_INTERNAL_KEY_PREFIX = 'bridge-'

/**
 * Every namespace `wrapLegacyStore` can write that is not a Signal key.
 * Derived from the routing catalog so it cannot drift from what is written.
 */
export const BRIDGE_INTERNAL_KEY_TYPES: readonly string[] = Object.freeze(
	[...new Set(Object.values(StoreCatalog).map(route => route.nativeType))].toSorted()
)

const internalTypes = new Set<string>(BRIDGE_INTERNAL_KEY_TYPES)

/**
 * Whether a `SignalKeyStore` namespace holds bridge-internal state rather than
 * Signal key material. Custom stores use it to skip those rows when they
 * enumerate, count or migrate. Never throws: anything that is not a known
 * namespace, including a non-string, is reported as not internal.
 */
export function isBridgeInternalKeyType(type: unknown): boolean {
	if (typeof type !== 'string' || type.length === 0) return false
	return type.startsWith(BRIDGE_INTERNAL_KEY_PREFIX) || internalTypes.has(type)
}
