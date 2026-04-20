/**
 * Drift detection between the bridge's `WhatsAppEvent` union (the runtime
 * contract) and our adapter's `KNOWN_BRIDGE_EVENT_TYPES` (the set of types
 * we explicitly handle).
 *
 * When the bridge ships a new event variant or removes an existing one, this
 * test fails with a precise diff — long before the missing handler shows up
 * as a silently-dropped event in production. Pair with
 * `bun run revalidate` so any bridge bump that changes the event surface is
 * caught before merge.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { KNOWN_BRIDGE_EVENT_TYPES } from '../adapt.ts'
import { expect } from '../../__tests__/expect.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Resolve `whatsapp_rust_bridge.d.ts` from the installed package. */
function loadBridgeDts(): string {
	const candidates = [
		path.resolve(__dirname, '../../../node_modules/whatsapp-rust-bridge/pkg/whatsapp_rust_bridge.d.ts'),
		path.resolve(__dirname, '../../../../whatsapp-rust-bridge/pkg/whatsapp_rust_bridge.d.ts')
	]
	for (const candidate of candidates) {
		try {
			return readFileSync(candidate, 'utf8')
		} catch {
			/* try next */
		}
	}
	throw new Error(`Could not find whatsapp_rust_bridge.d.ts. Tried:\n  ${candidates.join('\n  ')}`)
}

/**
 * Extract every discriminator string from the `WhatsAppEvent` union. The
 * bridge declares it as:
 *
 *   export type WhatsAppEvent =
 *     | { type: 'connected'; data: ... }
 *     | { type: 'disconnected'; data: ... }
 *     ...
 *     ;
 *
 * We slice from the `export type WhatsAppEvent =` line down to the
 * terminating `;` and pull out every quoted `type:` literal.
 */
function extractWhatsAppEventTypes(dts: string): string[] {
	const start = dts.indexOf('export type WhatsAppEvent =')
	if (start < 0) throw new Error('WhatsAppEvent union not found in .d.ts')
	const after = dts.slice(start)
	const end = after.indexOf(';\n')
	if (end < 0) throw new Error('WhatsAppEvent union has no terminator in .d.ts')
	const block = after.slice(0, end)

	// Match `type: 'foo'` or `type: "foo"` (the bridge currently uses single quotes
	// but stay forgiving).
	const re = /type:\s*['"]([a-z_]+)['"]/g
	const seen = new Set<string>()
	for (const m of block.matchAll(re)) {
		seen.add(m[1]!)
	}
	if (seen.size === 0) throw new Error('Failed to parse any variant from WhatsAppEvent union')
	// `[...seen]` is already a fresh copy — sorting it in place is safe.
	// eslint-disable-next-line unicorn/no-array-sort
	return [...seen].sort()
}

describe('Bridge .d.ts ↔ adapter drift', () => {
	const bridgeTypes = extractWhatsAppEventTypes(loadBridgeDts())

	it('every bridge event type from .d.ts is handled by the adapter', () => {
		const missing = bridgeTypes.filter(t => !KNOWN_BRIDGE_EVENT_TYPES.has(t))
		// If this fails, the bridge added a new variant we don't handle yet.
		// Add a `case` in `adaptBridgeEvent` and the matching string in
		// `KNOWN_BRIDGE_EVENT_TYPES`.
		expect(missing).toEqual([])
	})

	it('KNOWN_BRIDGE_EVENT_TYPES has no entries the bridge no longer ships', () => {
		const stale = [...KNOWN_BRIDGE_EVENT_TYPES].filter(t => !bridgeTypes.includes(t))
		// If this fails, the bridge removed a variant we still claim to handle.
		// Remove the corresponding `case` from `adaptBridgeEvent` and the entry
		// from `KNOWN_BRIDGE_EVENT_TYPES`.
		expect(stale).toEqual([])
	})

	it('parser found a non-trivial number of variants (sanity check)', () => {
		// If this drops to 0/few, the regex broke against a `.d.ts` reformat
		// and the two assertions above would silently pass.
		expect(bridgeTypes.length).toBeGreaterThanOrEqual(20)
	})
})
