/**
 * Type-safe encoding for `messageStubParameters` of `GROUP_PARTICIPANT_*`
 * stub messages. Upstream Baileys (`messages-recv.ts:714`) serializes each
 * affected participant as a JSON-encoded `GroupParticipant` so
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
	lid?: string
	username?: string
	admin?: 'admin' | 'superadmin' | null
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== ''

export const encodeStubParticipant = (p: StubParticipantPayload): StubParticipantParam => {
	const out: StubParticipantPayload = { id: p.id }
	if (isNonEmptyString(p.phoneNumber)) out.phoneNumber = p.phoneNumber
	if (isNonEmptyString(p.lid)) out.lid = p.lid
	if (isNonEmptyString(p.username)) out.username = p.username
	if (p.admin === 'admin' || p.admin === 'superadmin' || p.admin === null) out.admin = p.admin
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
	if (isNonEmptyString(obj.phoneNumber)) out.phoneNumber = obj.phoneNumber
	if (isNonEmptyString(obj.lid)) out.lid = obj.lid
	if (isNonEmptyString(obj.username)) out.username = obj.username
	if (obj.admin === 'admin' || obj.admin === 'superadmin' || obj.admin === null) out.admin = obj.admin
	return out
}
