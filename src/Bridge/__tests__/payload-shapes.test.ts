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
		})

		it('mute_update: timestamp', () => {
			const iso = adapt({ type: 'mute_update', data: { jid: JID, timestamp: ISO, action: { muted: true } } })
			expect(iso).toMatchObject({ type: 'muteUpdate', timestamp: SECONDS, muted: true })
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

		it('a value past what a JS number holds exactly is dropped rather than rounded', () => {
			// high beyond 0 / -1 exceeds 2^53 once recombined. A wrong instant is
			// worse than a missing one.
			const huge = adapt({
				type: 'mute_update',
				data: {
					jid: JID,
					timestamp: ISO,
					action: { muted: true, muteEndTimestamp: { low: 1, high: 4096, unsigned: false } }
				}
			})
			expect((huge as { muteEndTimestamp?: number }).muteEndTimestamp).toBeUndefined()
		})
	})

	describe('a Duration crosses as { secs, nanos }', () => {
		it('temporary_ban: expire', () => {
			const structured = adapt({ type: 'temporary_ban', data: { code: 101, expire: { secs: 3600, nanos: 0 } } })
			expect(structured).toMatchObject({ type: 'temporaryBan', code: 101, expire: 3600 })
		})

		it('temporary_ban: expire, as a plain count of seconds', () => {
			const plain = adapt({ type: 'temporary_ban', data: { code: 101, expire: 3600 } })
			expect(plain).toMatchObject({ expire: 3600 })
		})

		it('an absent expire stays absent', () => {
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
