/**
 * Anti-corruption layer between the bridge runtime and baileyrs domain code.
 *
 * The actual mapping table lives in `./schema.ts` — this file is the
 * stable public entry point that consumers (notably `Socket/events.ts` and
 * the dts-drift test) import. Keeping it thin lets the schema evolve
 * (table-driven dispatch, additional validation, schema-derived types,
 * etc.) without rippling through call sites.
 */

import type { WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger.ts'
import type { CanonicalEvent } from './types.ts'
import {
	adaptBridgeEventViaSchema,
	adaptBridgeMessageWire,
	KNOWN_BRIDGE_EVENT_TYPES as KNOWN_FROM_SCHEMA
} from './schema.ts'

export { adaptBridgeMessageWire }

/**
 * Set of bridge event types the adapter explicitly handles. The
 * `dts-drift.test.ts` cross-checks this against the bridge's `.d.ts`
 * union so missing/extra entries surface as test failures instead of
 * silent drops.
 */
export const KNOWN_BRIDGE_EVENT_TYPES: ReadonlySet<string> = KNOWN_FROM_SCHEMA

/** Result is `null` on unrecoverable shape mismatch — caller should drop the event. */
export const adaptBridgeEvent = (event: WhatsAppEvent, logger?: ILogger): CanonicalEvent | null =>
	adaptBridgeEventViaSchema(event, logger)
