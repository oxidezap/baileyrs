import { createRequire } from 'node:module'

/** Resolution and loading behind {@link loadOptionalPeer}. Injected in tests. */
export interface PeerLoader {
	resolveSpecifier(specifier: string): string
	requireSpecifier(specifier: string): unknown
}

/** Filesystem-backed loader, rooted at the importing module. */
export const nodePeerLoader = (baseUrl: string): PeerLoader => {
	const requireFrom = createRequire(baseUrl)
	return {
		resolveSpecifier: specifier => requireFrom.resolve(specifier),
		requireSpecifier: specifier => requireFrom(specifier)
	}
}

const isAbsent = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND'

/**
 * Load an optional peer, distinguishing "not installed" from
 * "installed but broken".
 *
 * Presence is probed through the package manifest, which resolves whenever
 * the package is installed regardless of the state of its entry point. Only
 * a missing manifest falls back. Anything else — a broken entry point, a
 * missing nested dependency — surfaces as an explicit error naming the
 * peer, so a damaged installation is never silently hidden behind the
 * fallback.
 */
export const loadOptionalPeer = <Module>(
	specifier: string,
	loader: PeerLoader = nodePeerLoader(import.meta.url)
): Module | undefined => {
	try {
		loader.resolveSpecifier(`${specifier}/package.json`)
	} catch (error) {
		if (isAbsent(error)) return undefined
		throw error
	}
	try {
		return loader.requireSpecifier(specifier) as Module
	} catch (error) {
		throw new Error(
			`Failed to load optional peer '${specifier}': it is installed but broken. ` +
				`Reinstall it, or remove it to use the built-in fallback.`,
			{ cause: error }
		)
	}
}
