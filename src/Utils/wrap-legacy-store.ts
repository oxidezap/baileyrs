/**
 * Compatibility facade for callers that still provide Baileys
 * `{ creds, keys }` authentication state.
 *
 * The implementation lives in `Compatibility/legacy-store/`: the WASM bridge sees only its
 * native byte-store contract, while every Baileys-specific projection remains
 * in this package.
 */

export { wrapLegacyStore } from '../Compatibility/legacy-store/adapter.ts'
export { useLegacyMultiFileAuthState } from '../Compatibility/legacy-store/multi-file.ts'
export {
	BRIDGE_INTERNAL_KEY_PREFIX,
	BRIDGE_INTERNAL_KEY_TYPES,
	isBridgeInternalKeyType
} from '../Compatibility/legacy-store/namespaces.ts'
export type { WrappedLegacyStore } from '../Compatibility/legacy-store/types.ts'
