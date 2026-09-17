import { encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { projectProtoMessage, repairProtoMessage } from './proto-runtime.ts'

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
	// The codec writes a field by the name its own schema declares, and silently
	// drops a key it does not know. A message that came back through the facade's
	// decode carries the public spellings, so they have to be translated here,
	// before the encode rather than after a failure that never comes. Returns the
	// same reference when nothing is aliased, so an ordinary message pays only
	// for the keys it carries.
	const projected = projectProtoMessage(path, message)
	try {
		return encodeProto(path, projected)
	} catch (error) {
		// Repaired from the caller's message rather than from `projected`: the repair
		// walks the schema this library publishes, so it looks for the public names —
		// the projected object carries the codec's, which it would not find, and the
		// failure would propagate instead of being absorbed.
		const repaired = repairProtoMessage(path, message)
		// Reference equality: nothing was coerced, so the failure is something this
		// does not explain — an unmodelled type, a number no int64 can hold, an
		// unknown enum name — and it has to keep propagating rather than be
		// retried into a second throw.
		if (repaired === message) throw error
		return encodeProto(path, projectProtoMessage(path, repaired))
	}
}
