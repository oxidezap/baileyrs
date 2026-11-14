/**
 * Drift detection between the bridge's `WhatsAppEvent` union (the runtime
 * contract) and our adapter's `KNOWN_BRIDGE_EVENT_TYPES` (the set of types
 * we explicitly handle).
 *
 * When the bridge ships a new event variant or removes an existing one, this
 * test fails with a precise diff — long before the missing handler shows up
 * as a silently-dropped event in production. Pair with
 * `npm test` so any bridge bump that changes the event surface is
 * caught before merge.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KNOWN_BRIDGE_EVENT_TYPES } from '../adapt.ts'
import { bridgeEventTypes, loadBridgeDts } from '../../__tests__/bridge-dts.ts'
import { expect } from '../../__tests__/expect.ts'

describe('Bridge .d.ts ↔ adapter drift', () => {
	const bridgeDts = loadBridgeDts()
	const bridgeTypes = bridgeEventTypes(bridgeDts)

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

	it('keeps the typed USync method connected to generated request and response declarations', () => {
		assert.match(bridgeDts, /export interface UsyncQuery\s*\{/u)
		assert.match(bridgeDts, /export interface UsyncResponse\s*\{/u)
		assert.match(bridgeDts, /queryUsync\(query: UsyncQuery\): Promise<UsyncResponse>;/u)
		assert.match(bridgeDts, /tc_token\?: Uint8Array \| null;/u)
	})

	it('keeps stanza response methods on the typed neutral node boundary', () => {
		assert.match(bridgeDts, /export interface BinaryNode\s*\{/u)
		assert.match(bridgeDts, /acknowledgeStanza\(stanza_js: BinaryNode\): Promise<void>;/u)
		assert.match(
			bridgeDts,
			/rejectStanza\(stanza_js: BinaryNode, error_code: number, failure_reason\?: number \| null\): Promise<void>;/u
		)
		assert.match(
			bridgeDts,
			/requestMessageRetry\(stanza_js: BinaryNode, force_include_keys\?: boolean \| null\): Promise<void>;/u
		)
	})
})
