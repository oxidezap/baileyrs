// Codec registry private to the compatibility boundary.
import type { ProjectedStoreName } from '../constants.ts'
import type { LegacyCodec } from '../types.ts'
import { createBasicCodecs } from './basic.ts'
import { createSignalCodecs, type SignalRecordDefaults } from './signal.ts'

/** Compile-time exhaustive registry: adding a projected store requires a codec. */
export function createLegacyCodecs(defaults?: SignalRecordDefaults): Record<ProjectedStoreName, LegacyCodec> {
	return { ...createBasicCodecs(), ...createSignalCodecs(defaults) }
}
