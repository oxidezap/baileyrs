/**
 * The shapes the bridge actually hands over, per field.
 *
 * A serde-serialized `DateTime<Utc>` crosses as an RFC 3339 string unless the
 * field names one of chrono's `ts_*` modules; a protobuf `int64` crosses as a
 * protobufjs `Long`, because 64 bits do not fit a JS number; a
 * `std::time::Duration` crosses as `{ secs, nanos }`. None of those is a
 * number, and the adapters read them with a strict number guard, so each one
 * reached a consumer as `undefined` — a field that reads as "the server did not
 * say" while the server did say.
 *
 * Both forms are pinned for every field, the one the bridge sends today and the
 * one it sent before, because these payloads have already changed shape once:
 * `whatsapp-rust-bridge` 0.10.0 moved an app-state mutation onto the proto
 * serializer, which is what turned `muteEndTimestamp` into a `Long`. An adapter
 * that only accepts today's form is one release away from the same bug.
 */

import { describe, it } from 'node:test'
import { adaptBridgeEvent } from '../adapt.ts'
import { expect } from '../../__tests__/expect.ts'

const logger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return logger
	}
}

const adapt = (event: unknown) => adaptBridgeEvent(event as never, logger as never)

const JID = { user: '5511900000001', server: 's.whatsapp.net' }
/** 2023-11-14T22:13:20Z, the same instant in both spellings. */
const ISO = '2023-11-14T22:13:20Z'
const SECONDS = 1_700_000_000

describe('bridge payload shapes', () => {
	describe('a DateTime crosses as an RFC 3339 string', () => {
		it('presence: last_seen', () => {
			const iso = adapt({ type: 'presence', data: { from: JID, unavailable: false, last_seen: ISO } })
			expect(iso).toMatchObject({ type: 'presence', lastSeen: SECONDS })
			// And the number form a `ts_seconds` field would send.
			const seconds = adapt({ type: 'presence', data: { from: JID, unavailable: false, last_seen: SECONDS } })
			expect(seconds).toMatchObject({ lastSeen: SECONDS })
		})

		it('server_ack: timestamp', () => {
			const iso = adapt({ type: 'server_ack', data: { id: 'A1', from: JID, timestamp: ISO } })
			expect(iso).toMatchObject({ type: 'serverAck', timestamp: SECONDS })
			const seconds = adapt({ type: 'server_ack', data: { id: 'A1', from: JID, timestamp: SECONDS } })
			expect(seconds).toMatchObject({ timestamp: SECONDS })
		})

		it('pin_update: timestamp', () => {
			const iso = adapt({ type: 'pin_update', data: { jid: JID, timestamp: ISO, action: { pinned: true } } })
			expect(iso).toMatchObject({ type: 'pinUpdate', timestamp: SECONDS, pinned: true })
			const seconds = adapt({ type: 'pin_update', data: { jid: JID, timestamp: SECONDS, action: { pinned: true } } })
			expect(seconds).toMatchObject({ type: 'pinUpdate', timestamp: SECONDS, pinned: true })
		})

		it('mute_update: timestamp', () => {
			const iso = adapt({ type: 'mute_update', data: { jid: JID, timestamp: ISO, action: { muted: true } } })
			expect(iso).toMatchObject({ type: 'muteUpdate', timestamp: SECONDS, muted: true })
			const seconds = adapt({ type: 'mute_update', data: { jid: JID, timestamp: SECONDS, action: { muted: true } } })
			expect(seconds).toMatchObject({ type: 'muteUpdate', timestamp: SECONDS, muted: true })
		})

		it('an absent timestamp stays absent rather than becoming the epoch', () => {
			const update = adapt({ type: 'presence', data: { from: JID, unavailable: true } })
			expect(update).toMatchObject({ type: 'presence' })
			expect((update as { lastSeen?: number }).lastSeen).toBeUndefined()
		})

		it('a timestamp that is neither is dropped, not guessed', () => {
			const update = adapt({ type: 'presence', data: { from: JID, unavailable: false, last_seen: 'not a date' } })
			expect((update as { lastSeen?: number }).lastSeen).toBeUndefined()
		})

		it('a string Date.parse would accept but chrono never writes is refused', () => {
			// `Date.parse('0')` is the year 2000 and `Date.parse('1')` is 2001, so
			// a numeric-string sentinel would otherwise surface as a plausible,
			// wrong instant.
			for (const sentinel of ['0', '1', '2023', 'Jan 1 2023']) {
				const update = adapt({ type: 'presence', data: { from: JID, unavailable: false, last_seen: sentinel } })
				expect((update as { lastSeen?: number }).lastSeen).toBeUndefined()
			}
		})

		it('refuses a day the calendar does not have, which Date.parse rolls forward', () => {
			// `Date.parse('2023-02-30T…')` is March 2, not NaN — so a malformed
			// producer would move an instant by days and still look believable.
			for (const impossible of ['2023-02-30T12:00:00Z', '2023-11-31T12:00:00Z', '2023-02-29T12:00:00Z']) {
				const update = adapt({ type: 'presence', data: { from: JID, unavailable: false, last_seen: impossible } })
				expect((update as { lastSeen?: number }).lastSeen).toBeUndefined()
			}
		})

		it('refuses the 24:00 rollover, which RFC 3339 does not allow', () => {
			// `Date.parse('2023-11-14T24:00:00Z')` is midnight on the 15th, so this
			// is the other component that moves the instant to another day.
			const rollover = adapt({
				type: 'presence',
				data: { from: JID, unavailable: false, last_seen: '2023-11-14T24:00:00Z' }
			})
			expect((rollover as { lastSeen?: number }).lastSeen).toBeUndefined()
			// The last instant the hour does allow still parses.
			const last = adapt({
				type: 'presence',
				data: { from: JID, unavailable: false, last_seen: '2023-11-14T23:59:59Z' }
			})
			expect(typeof (last as { lastSeen?: number }).lastSeen).toBe('number')
		})

		it('keeps the leap days that do exist, centuries included', () => {
			// 2000 is a leap year and 1900 is not, which is the rule a plain
			// `year % 4` check gets wrong.
			const leap = adapt({
				type: 'presence',
				data: { from: JID, unavailable: false, last_seen: '2024-02-29T12:00:00Z' }
			})
			expect(typeof (leap as { lastSeen?: number }).lastSeen).toBe('number')
			const century = adapt({
				type: 'presence',
				data: { from: JID, unavailable: false, last_seen: '2000-02-29T12:00:00Z' }
			})
			expect(typeof (century as { lastSeen?: number }).lastSeen).toBe('number')
			const notLeap = adapt({
				type: 'presence',
				data: { from: JID, unavailable: false, last_seen: '1900-02-29T12:00:00Z' }
			})
			expect((notLeap as { lastSeen?: number }).lastSeen).toBeUndefined()
		})

		it('accepts the offset form chrono writes for a non-UTC zone', () => {
			const offset = adapt({
				type: 'presence',
				data: { from: JID, unavailable: false, last_seen: '2023-11-14T23:13:20+01:00' }
			})
			expect(offset).toMatchObject({ lastSeen: SECONDS })
		})
	})

	describe('a proto int64 crosses as a Long', () => {
		it('mute_update: muteEndTimestamp, as the proto serializer sends it', () => {
			const long = adapt({
				type: 'mute_update',
				data: {
					jid: JID,
					timestamp: ISO,
					action: { muted: true, muteEndTimestamp: { low: SECONDS, high: 0, unsigned: false } }
				}
			})
			expect(long).toMatchObject({ muteEndTimestamp: SECONDS })
		})

		it('mute_update: muteEndTimestamp, as serde sent it before 0.10.0', () => {
			const plain = adapt({
				type: 'mute_update',
				data: { jid: JID, timestamp: ISO, action: { muted: true, mute_end_timestamp: SECONDS } }
			})
			expect(plain).toMatchObject({ muteEndTimestamp: SECONDS })
		})

		it('a Long carrying its own toNumber is read through it', () => {
			const long = adapt({
				type: 'mute_update',
				data: {
					jid: JID,
					timestamp: ISO,
					action: { muted: true, muteEndTimestamp: { low: 0, high: 0, toNumber: () => SECONDS } }
				}
			})
			expect(long).toMatchObject({ muteEndTimestamp: SECONDS })
		})

		it('reads the pair as one signed value, not as two halves', () => {
			// `high: -1, low: 0` is -2^32. Reading the halves separately reports
			// 0, which is a different instant and a plausible one.
			const negative = adapt({
				type: 'mute_update',
				data: {
					jid: JID,
					timestamp: ISO,
					action: { muted: true, muteEndTimestamp: { low: 0, high: -1, unsigned: false } }
				}
			})
			expect(negative).toMatchObject({ muteEndTimestamp: -(2 ** 32) })
		})

		it('a value past what a JS number holds exactly is dropped rather than rounded', () => {
			// 2^21 * 2^32 is 2^53, so this pair is the first value a JS number
			// cannot represent exactly. A wrong instant is worse than a missing one.
			const huge = adapt({
				type: 'mute_update',
				data: {
					jid: JID,
					timestamp: ISO,
					action: { muted: true, muteEndTimestamp: { low: 1, high: 2_097_152, unsigned: false } }
				}
			})
			expect((huge as { muteEndTimestamp?: number }).muteEndTimestamp).toBeUndefined()
		})

		it('a Long whose own toNumber rounds is refused too', () => {
			// protobufjs rounds rather than refusing, so the escape hatch has to
			// be checked as strictly as the pair.
			const rounded = adapt({
				type: 'mute_update',
				data: {
					jid: JID,
					timestamp: ISO,
					action: { muted: true, muteEndTimestamp: { low: 1, high: 2_097_152, toNumber: () => 2 ** 53 + 2 } }
				}
			})
			expect((rounded as { muteEndTimestamp?: number }).muteEndTimestamp).toBeUndefined()
		})
	})

	describe('a Duration crosses as { secs, nanos }, and the ban is reported as a deadline', () => {
		const HOUR = 3600

		/** The instant a ban of `HOUR` seconds starting now would lift. */
		const expectedDeadline = () => {
			const before = Math.floor(Date.now() / 1000) + HOUR
			return (actual: number | undefined) => {
				const after = Math.floor(Date.now() / 1000) + HOUR
				expect(typeof actual).toBe('number')
				expect(actual! >= before && actual! <= after).toBe(true)
			}
		}

		it('temporary_ban: expire', () => {
			const check = expectedDeadline()
			const structured = adapt({ type: 'temporary_ban', data: { code: 101, expire: { secs: HOUR, nanos: 0 } } })
			expect(structured).toMatchObject({ type: 'temporaryBan', code: 101 })
			check((structured as { expire?: number }).expire)
		})

		it('temporary_ban: expire, as a plain count of seconds', () => {
			const check = expectedDeadline()
			const plain = adapt({ type: 'temporary_ban', data: { code: 101, expire: HOUR } })
			check((plain as { expire?: number }).expire)
		})

		it('refuses a deadline a Date cannot hold', () => {
			// The socket formats this with `new Date(expire * 1000).toISOString()`,
			// which throws past ±8.64e15 ms — and that throw would land inside the
			// event dispatch. No deadline beats one that takes the dispatch down.
			const absurd = adapt({
				type: 'temporary_ban',
				data: { code: 101, expire: { secs: 8_640_000_000_000, nanos: 0 } }
			})
			expect((absurd as { expire?: number }).expire).toBeUndefined()
			// And the socket's own formatting stays safe on what does get through.
			const ban = adapt({ type: 'temporary_ban', data: { code: 101, expire: HOUR } })
			const expire = (ban as { expire?: number }).expire!
			expect(() => new Date(expire * 1000).toISOString()).not.toThrow()
		})

		it('an absent expire stays absent rather than becoming right now', () => {
			// `expire` gates the message the socket builds and the delay a
			// reconnect policy waits out; a ban with no duration must not read as
			// one that has already lifted.
			const ban = adapt({ type: 'temporary_ban', data: { code: 101 } })
			expect((ban as { expire?: number }).expire).toBeUndefined()
		})
	})

	describe('what already crossed as a number keeps crossing as one', () => {
		it('dirty_state: timestamp is a u64 in the core, not a DateTime', () => {
			expect(adapt({ type: 'dirty_state', data: { dirty_type: 'groups', timestamp: SECONDS } })).toMatchObject({
				type: 'dirtyState',
				timestamp: SECONDS
			})
		})
	})
})
