/**
 * Which `long` constructor the compatibility facade builds.
 *
 * Upstream Baileys and the protobufjs it bundles resolve `long` through
 * `require('long')` — the package's CommonJS entry (`umd/index.js`). An ESM
 * `import Long from 'long'` resolves to a *different* module instance
 * (`index.js`) whose constructor has its own prototype, so values it builds
 * fail `deepStrictEqual` against upstream's even when every word matches
 * ("same structure but not reference-equal" in
 * `proto-frompartial-long.test.ts` / `proto-runtime-compatibility.test.ts`).
 *
 * The base revision loaded that same export with a static
 * `createRequire(import.meta.url)('long')` from `node:module`. A static
 * `node:module` import would drag `node:` into the host-neutral graph
 * (workerd without `nodejs_compat` has no `node:` at all), so this resolves
 * it lazily through `process.getBuiltinModule('module')` — available on
 * every supported Node (`engines: >=22.0.0`) with no static import, the same
 * lazy-builtin shape `Utils/browser-utils.ts` uses for `node:os` — and
 * falls back to the ESM build on hosts, where there is no
 * upstream-constructor constraint to keep.
 */

import LongESM from 'long'

type LongConstructor = typeof LongESM

const loadCjsLongConstructor = (): LongConstructor | undefined => {
	try {
		const proc = (globalThis as { process?: unknown }).process as
			| { getBuiltinModule?: (id: string) => unknown }
			| undefined
		const getBuiltinModule = proc?.getBuiltinModule
		if (typeof getBuiltinModule !== 'function') return undefined
		const nodeModule = getBuiltinModule('module') as
			| { createRequire?: (base: string) => (specifier: string) => unknown }
			| undefined
		const createRequire = nodeModule?.createRequire
		if (typeof createRequire !== 'function') return undefined
		const loadModule = createRequire(import.meta.url)
		const loaded: unknown = loadModule('long')
		if (typeof loaded === 'function') return loaded as LongConstructor
		const namespaced = (loaded as { default?: unknown } | undefined)?.default
		if (typeof namespaced === 'function') return namespaced as LongConstructor
	} catch {
		// Hosts without process.getBuiltinModule (workerd without
		// nodejs_compat, browsers, Deno): fall through to the ESM build.
	}
	return undefined
}

let cached: LongConstructor | undefined
let settled = false

/** The `require('long')` constructor on Node; the ESM build everywhere else. */
export const getLongConstructor = (): LongConstructor => {
	if (!settled) {
		settled = true
		cached = loadCjsLongConstructor() ?? LongESM
	}
	return cached as LongConstructor
}

/**
 * What the facade materializes every 64-bit word as. A module-level const
 * (not per call) so every Long in the process shares one prototype.
 */
const LongRuntime: LongConstructor = getLongConstructor()

export default LongRuntime
