/**
 * The bridge's own declarations, which several tests read as the contract the
 * core actually deserializes. Not a `.test.ts`, so the runner leaves it alone.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const CANDIDATES = [
	'../../node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge.d.ts',
	// Pre-0.6.0-alpha.39 packages shipped the declarations under pkg/.
	'../../node_modules/@oxidezap/whatsapp-rust-bridge/pkg/whatsapp_rust_bridge.d.ts',
	// Sibling checkout, for local development against an unpublished bridge.
	'../../../whatsapp-rust-bridge/pkg/whatsapp_rust_bridge.d.ts'
].map(candidate => path.resolve(import.meta.dirname, candidate))

/** Resolve `whatsapp_rust_bridge.d.ts` from the installed package. */
export const loadBridgeDts = (): string => {
	for (const candidate of CANDIDATES) {
		try {
			return readFileSync(candidate, 'utf8')
		} catch {
			/* try the next one */
		}
	}
	throw new Error(`Could not find whatsapp_rust_bridge.d.ts. Tried:\n  ${CANDIDATES.join('\n  ')}`)
}

/** The members of an `export type X = "a" | "b"`, in declaration order. */
export const bridgeStringUnion = (dts: string, name: string): string[] => {
	const declaration = new RegExp(`^export type ${name} = (.+);$`, 'mu').exec(dts)
	if (!declaration) throw new Error(`the bridge no longer declares ${name}`)
	return [...declaration[1]!.matchAll(/"([^"]*)"/gu)].map(match => match[1]!)
}
