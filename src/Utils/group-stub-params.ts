/**
 * Type-safe encoding for `messageStubParameters` of `GROUP_PARTICIPANT_*`
 * stub messages. Upstream Baileys (`messages-recv.ts:714`) serializes each
 * affected participant as `JSON.stringify({ id, phoneNumber? })` so
 * `process-message.ts` can `JSON.parse` it cleanly. The proto type is
 * `string[]` — too loose to catch a caller that forgets to encode (and
 * exactly the bug commit `cf8e9ca` shipped: raw JID instead of JSON).
 *
 * The brand carries no runtime cost; it just prevents an unbranded
 * `string` from being assigned where a `StubParticipantParam` is expected.
 */

declare const StubParticipantBrand: unique symbol

export type StubParticipantParam = string & { readonly [StubParticipantBrand]: never }

export interface StubParticipantPayload {
	id: string
	phoneNumber?: string
}

export const encodeStubParticipant = (p: StubParticipantPayload): StubParticipantParam => {
	const out: StubParticipantPayload = { id: p.id }
	if (p.phoneNumber) out.phoneNumber = p.phoneNumber
	return JSON.stringify(out) as StubParticipantParam
}

/**
 * Parse a raw `messageStubParameters[i]` back into its payload. Validates
 * the shape so a malformed/legacy raw-JID string fails loudly instead of
 * propagating a wrong type. Returns `null` on any decode failure — callers
 * decide whether that is an assertion failure or a fall-through.
 */
export const decodeStubParticipant = (raw: string | null | undefined): StubParticipantPayload | null => {
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (parsed === null || typeof parsed !== 'object') return null
	const obj = parsed as Record<string, unknown>
	if (typeof obj.id !== 'string') return null
	const out: StubParticipantPayload = { id: obj.id }
	if (typeof obj.phoneNumber === 'string') out.phoneNumber = obj.phoneNumber
	return out
}
