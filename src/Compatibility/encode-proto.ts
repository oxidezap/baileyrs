import { encodeProto } from '@oxidezap/whatsapp-rust-bridge/host'
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
 * The three do not all follow the same reference, and the difference is worth
 * stating. The surrogate becomes a single U+FFFD — what any UTF-8 encoder
 * produces, and what the client sends — while upstream protobufjs writes three
 * WTF-8 bytes instead, which is the artifact `replaceLoneSurrogates` in the fuzz
 * registry folds away when it compares. The empty string becoming `0` is the other
 * direction: the client never writes it and the bridge refuses it on purpose, so
 * that one substitution is Baileys compatibility rather than client compliance.
 * It stays because a message that used to reach the server should not start
 * throwing, and it is written down here so it is a decision rather than an accident.
 *
 * Repair on failure rather than check on write: the ordinary encode is exactly
 * the call it was before, with no scan of any field, and the repair runs only
 * for a message that was already going to throw. `encodeProto` returns finished
 * bytes rather than a lazy writer, so one try/catch covers it.
 */
export const encodeProtoCompat = (path: string, message: unknown): Uint8Array => {
	// The codec drops a key it does not know without throwing, so a public spelling has
	// to be translated before the encode: a repair after a throw never runs. Same
	// reference when nothing is aliased.
	const projected = projectProtoMessage(path, message)
	try {
		return encodeProto(path, projected)
	} catch (error) {
		// Repaired from the caller's message: this repair walks the schema this library
		// publishes, so the projected names would not be found and the failure would
		// propagate instead of being absorbed.
		const repaired = repairProtoMessage(path, message)
		// Reference equality: nothing was coerced, so the failure is something this
		// does not explain and it has to keep propagating rather than be retried.
		if (repaired === message) throw error
		return encodeProto(path, projectProtoMessage(path, repaired))
	}
}
