/**
 * Sender-key addresses are not exclusive to groups.
 *
 * Status updates and broadcast lists fan out through the same sender-key
 * mechanism as groups, so `status@broadcast:<address>` reaches the legacy-store
 * translator just like `<group>@g.us:<address>` does. Anchoring the chat part on
 * `@g.us:` made every status address throw `invalid native sender-key address`,
 * and since the throw surfaces inside a storage operation it aborts whatever
 * triggered it — a `sendMessage` to an unrelated group, for example.
 */

import { describe, it } from 'node:test'
import { NativeStore } from '../legacy-store/constants.ts'
import { legacyKey, nativeKey } from '../legacy-store/routing.ts'
import { expect } from '../../__tests__/expect.ts'

const GROUP_NATIVE = '120363000000000001@g.us:5511900000001@c.us.0'
const GROUP_LEGACY = '120363000000000001@g.us::5511900000001::0'

const STATUS_NATIVE = 'status@broadcast:5511900000001:76@c.us.0'
const STATUS_LEGACY = 'status@broadcast::5511900000001::76'

describe('legacy-store sender-key routing', () => {
	it('translates group addresses', () => {
		expect(legacyKey(NativeStore.SENDER_KEY, GROUP_NATIVE)).toBe(GROUP_LEGACY)
	})

	it('translates status addresses instead of throwing', () => {
		expect(legacyKey(NativeStore.SENDER_KEY, STATUS_NATIVE)).toBe(STATUS_LEGACY)
	})

	it('round-trips both chat kinds', () => {
		expect(nativeKey(NativeStore.SENDER_KEY, GROUP_LEGACY)).toBe(GROUP_NATIVE)
		expect(nativeKey(NativeStore.SENDER_KEY, STATUS_LEGACY)).toBe(STATUS_NATIVE)
	})

	it('still rejects an address with no chat terminator', () => {
		expect(() => legacyKey(NativeStore.SENDER_KEY, '5511900000001@c.us.0')).toThrow(/invalid native sender-key address/)
	})
})
