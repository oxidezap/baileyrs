/**
 * A sender key is `<chatJid>:<signalAddress>`, and the chat is not always a
 * group: status updates and broadcast lists fan out through the very same
 * mechanism, so `status@broadcast:<address>` reaches this translator too.
 * The throw lands inside a storage operation, so it aborts whatever triggered
 * it — a welcome message to an unrelated group, for example.
 */

import { describe, it } from 'node:test'
import { NativeStore } from '../legacy-store/constants.ts'
import { legacyKey, nativeKey } from '../legacy-store/routing.ts'
import { expect } from '../../__tests__/expect.ts'

const GROUP = '120363000000000001@g.us'

/** `[label, native, legacy]` for every chat kind that owns a sender key. */
const ADDRESSES = [
	['group, PN sender', `${GROUP}:5511900000001@c.us.0`, `${GROUP}::5511900000001::0`],
	['group, LID sender', `${GROUP}:5511900000001@lid.0`, `${GROUP}::5511900000001_1::0`],
	['group, JID device', `${GROUP}:5511900000001:5@c.us.0`, `${GROUP}::5511900000001::5`],
	['status', 'status@broadcast:5511900000001:76@c.us.0', 'status@broadcast::5511900000001::76'],
	['broadcast list', '558694979017@broadcast:5511900000001@c.us.0', '558694979017@broadcast::5511900000001::0'],
	['status, hosted sender', 'status@broadcast:5511900000001:9@hosted.0', 'status@broadcast::5511900000001_128::9']
] as const

/** Shapes no translator can make sense of, paired so both directions face the
 *  same defect: `[label, native, legacy]`. */
const MALFORMED = [
	['no chat part', '5511900000001@c.us.0', '5511900000001.0'],
	['chat without a domain', 'nochat:5511900000001@c.us.0', 'nochat::5511900000001::0'],
	['chat without a user', '@g.us:5511900000001@c.us.0', '@g.us::5511900000001::0'],
	['non-numeric sender', `${GROUP}:notanumber@c.us.0`, `${GROUP}::notanumber::0`],
	['sender without a domain', `${GROUP}:5511900000001.0`, `${GROUP}::5511900000001::`]
] as const

describe('legacy-store sender-key routing', () => {
	it('translates every chat kind that owns a sender key', () => {
		for (const [label, native, legacy] of ADDRESSES) {
			expect(`${label}: ${legacyKey(NativeStore.SENDER_KEY, native)}`).toBe(`${label}: ${legacy}`)
		}
	})

	it('round-trips every chat kind back to the native key', () => {
		for (const [label, native, legacy] of ADDRESSES) {
			expect(`${label}: ${nativeKey(NativeStore.SENDER_KEY, legacy)}`).toBe(`${label}: ${native}`)
			expect(`${label}: ${nativeKey(NativeStore.SENDER_KEY, legacyKey(NativeStore.SENDER_KEY, native))}`).toBe(
				`${label}: ${native}`
			)
		}
	})

	it('translates chat domains it has no knowledge of', () => {
		// The chat namespace belongs to the core. A translator that only knows
		// today's chat domains turns tomorrow's into a storage failure.
		const native = '120363000000000001@futurechat:5511900000001@c.us.0'
		const legacy = '120363000000000001@futurechat::5511900000001::0'
		expect(legacyKey(NativeStore.SENDER_KEY, native)).toBe(legacy)
		expect(nativeKey(NativeStore.SENDER_KEY, legacy)).toBe(native)
	})

	it('rejects malformed addresses in both directions', () => {
		for (const [label, native, legacy] of MALFORMED) {
			expect(() => `${label}: ${legacyKey(NativeStore.SENDER_KEY, native)}`).toThrow(TypeError)
			expect(() => `${label}: ${nativeKey(NativeStore.SENDER_KEY, legacy)}`).toThrow(TypeError)
		}
	})

	it('names the sender-key address when the chat part is missing', () => {
		expect(() => legacyKey(NativeStore.SENDER_KEY, '5511900000001@c.us.0')).toThrow(/invalid native sender-key address/)
		expect(() => nativeKey(NativeStore.SENDER_KEY, '5511900000001.0')).toThrow(/invalid legacy sender-key address/)
	})
})
