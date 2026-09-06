import { encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { repairProtoMessage } from './proto-runtime.ts'

/**
 * `encodeProto`, with the three inputs the bridge codec refuses put back.
 *
 * From 0.8.0 the codec refuses an empty string where the schema declares a
 * 64-bit integer, and an unpaired surrogate in a text field. Both were written
 * before — as `0` and as U+FFFD — and upstream Baileys still encodes both, so a
 * message that used to reach the server would now throw in the caller's face.
 * The codec also refuses enum names where the schema declares an enum
 * (issue #109: `"NONE"` where an int32 goes on the wire), which upstream's
 * `fromObject` resolves and its direct `encode` coerces — that repair lives in
 * `repairProtoMessage`, next to the other two. This is where all three are
 * absorbed, so the strict contract stays true of the bridge and the tolerant
 * one stays true of this library.
 *
 * Repair on failure rather than check on write: the ordinary encode is exactly
 * the call it was before, with no scan of any field, and the repair runs only
 * for a message that was already going to throw. `encodeProto` returns finished
 * bytes rather than a lazy writer, so one try/catch covers it.
 */
export const encodeProtoCompat = (path: string, message: unknown): Uint8Array => {
	try {
		return encodeProto(path, message)
	} catch (error) {
		const repaired = repairProtoMessage(path, message)
		// Reference equality: nothing was coerced, so the failure is something this
		// does not explain — an unmodelled type, a number no int64 can hold, an
		// unknown enum name — and it has to keep propagating rather than be
		// retried into a second throw.
		if (repaired === message) throw error
		return encodeProto(path, repaired)
	}
}
