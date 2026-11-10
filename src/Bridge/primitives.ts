/**
 * Type guards and coercion helpers shared by all bridge adapters.
 *
 * Adapters treat the bridge payload as `unknown` and validate field-by-field
 * here so a bridge schema drift (renamed field, lost serde rename_all,
 * timestamp serializer change) surfaces as `null` from one adapter instead
 * of a silent type lie that propagates downstream.
 */

/**
 * Plain-object guard. `typeof null === "object"` so we exclude it
 * explicitly; arrays return `true` here so callers must check
 * `Array.isArray` first if they need to distinguish.
 */
export const isObject = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x)

/** Treat any non-string as missing rather than coercing (no `String(x)`). */
export const asString = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined)

/** Treat any non-number (including booleans, NaN) as missing. */
export const asNumber = (x: unknown): number | undefined =>
	typeof x === 'number' && Number.isFinite(x) ? x : undefined

/** Strict bool — does not coerce truthy values like `1` or `'true'`. */
export const asBool = (x: unknown): boolean | undefined => (typeof x === 'boolean' ? x : undefined)

/** Same as `asBool` but defaults to `false` for missing/invalid input. */
export const asBoolOr = (x: unknown, fallback: boolean): boolean => asBool(x) ?? fallback

/**
 * Bridge JID struct — `user@server`, plus optional `agent`/`device`/
 * `integrator` for multi-device addressing. We always drop the latter when
 * stringifying so canonical JIDs are device-stripped (matching how Baileys
 * consumers index and compare).
 */
export interface BridgeJid {
	user: string
	server: string
	agent?: number
	device?: number
	integrator?: number
}

/** Type guard for the bridge's `Jid` shape. Required fields only. */
export const isBridgeJid = (x: unknown): x is BridgeJid =>
	isObject(x) && typeof x.user === 'string' && typeof x.server === 'string'

/** `null`-tolerant `BridgeJid` extractor — bridge payloads sometimes carry `null`. */
export const asBridgeJid = (x: unknown): BridgeJid | undefined => (isBridgeJid(x) ? x : undefined)

/** Stringify a bridge JID into the canonical `user@server` form. Drops device/agent. */
export const bridgeJidToString = (j: BridgeJid): string => `${j.user}@${j.server}`

/** Combined: validate & stringify in one step. Returns `undefined` on invalid input. */
export const asJidString = (x: unknown): string | undefined => {
	const j = asBridgeJid(x)
	return j ? bridgeJidToString(j) : undefined
}

/** Preserve the addressable-device portion when a JID is used for signaling. */
export const bridgeJidToAddressString = (j: BridgeJid): string => {
	if (!j.user) return j.server
	const rendersAgent =
		j.server !== 's.whatsapp.net' && j.server !== 'lid' && j.server !== 'hosted' && j.server !== 'hosted.lid'
	const agent = rendersAgent && Number.isInteger(j.agent) && (j.agent ?? 0) > 0 ? `.${j.agent}` : ''
	const device = Number.isInteger(j.device) && (j.device ?? 0) > 0 ? `:${j.device}` : ''
	return `${j.user}${agent}${device}@${j.server}`
}

/** Validate and stringify a signaling JID without discarding its device. */
export const asJidAddressString = (x: unknown): string | undefined => {
	const j = asBridgeJid(x)
	return j ? bridgeJidToAddressString(j) : undefined
}

/**
 * The shape chrono writes for a `DateTime` it serializes plainly.
 *
 * Checked before parsing because `Date.parse` accepts far more than that, and
 * silently: `Date.parse('0')` is the year 2000, so a numeric-string sentinel
 * would become a plausible, wrong instant instead of being refused.
 */
const RFC_3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})$/

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Gregorian, so a century is only a leap year when it divides by 400. */
const daysInMonth = (year: number, month: number): number =>
	month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : (MONTH_LENGTHS[month - 1] ?? 0)

/** Fixed-width digits at a known offset, which the pattern above guarantees. */
const digits2 = (raw: string, at: number): number => (raw.charCodeAt(at) - 48) * 10 + (raw.charCodeAt(at + 1) - 48)

const parseRfc3339Seconds = (raw: string): number | undefined => {
	// `test` rather than `exec`: the components come out of fixed offsets
	// below, and asking the engine for capture groups costs more than the whole
	// rest of this function.
	if (!RFC_3339.test(raw)) return undefined
	// `Date.parse` refuses month 13, hour 25 and second 61, but rolls a day
	// past the end of its month forward instead: `2023-02-30` comes back as
	// March 2. That is the one component worth checking here.
	const year = digits2(raw, 0) * 100 + digits2(raw, 2)
	if (digits2(raw, 8) > daysInMonth(year, digits2(raw, 5))) return undefined
	// The other one it rolls forward rather than refusing: RFC 3339 stops the
	// hour at 23, while `2023-11-14T24:00:00Z` parses as midnight the next day.
	if (digits2(raw, 11) > 23) return undefined
	const ms = Date.parse(raw)
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/**
 * Coerce a timestamp value into unix seconds. Accepts both numbers and RFC 3339
 * strings — the bridge serializes `DateTime<Utc>` as a string unless the field
 * names one of chrono's `ts_*` modules, so being lenient about which of the two
 * arrives insulates us from drift.
 *
 * Absence and unparseable input stay absent (`undefined`): a missing,
 * malformed, or non-finite timestamp must never become the epoch, which
 * would place the event at 1970 and corrupt timeline ordering. Callers
 * apply the per-field policy explicitly — required timestamps (message,
 * receipt, call, group action) drop the event, optional ones (presence
 * `last_seen`, server-ack time, pin/mute time) omit the field.
 */
export const asUnixSeconds = (raw: unknown): number | undefined => {
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw
	if (typeof raw === 'string') return parseRfc3339Seconds(raw)
	return undefined
}

/**
 * Validated coercion to unix seconds for external consumers that need a
 * plain number (no `undefined` branch).
 *
 * Accepts the same inputs as `asUnixSeconds` — a finite number or an RFC
 * 3339 string — and rejects everything else by throwing `RangeError`
 * instead of fabricating the epoch: a missing, malformed, or non-finite
 * timestamp must never become 1970-01-01 and corrupt timeline ordering.
 * Internal adapters do not use this; they take `asUnixSeconds` with an
 * explicit per-field policy (required timestamps drop the event, optional
 * ones omit the field).
 */
export const toUnixSeconds = (raw: unknown): number => {
	const parsed = asUnixSeconds(raw)
	if (parsed === undefined) {
		const preview = typeof raw === 'string' ? `: ${raw.slice(0, 80)}` : ''
		throw new RangeError(`toUnixSeconds: cannot coerce ${typeof raw}${preview} to unix seconds`)
	}
	return parsed
}

/**
 * A 64-bit proto field, however the bridge chose to carry it.
 *
 * A protobuf `int64` reaches JavaScript as a protobufjs `Long`
 * (`{ low, high, unsigned }`, sometimes with `toNumber`), because 64 bits do
 * not fit a JS number. A plain number is accepted too: the same field arrived
 * that way while these payloads crossed through serde, and a bridge is free to
 * go back to it.
 *
 * Reconstructed from the pair only when `high` is 0 or -1, the range a JS
 * number represents exactly. Beyond that the value would be silently rounded,
 * and a wrong timestamp is worse than a missing one.
 */
export const asInt64 = (x: unknown): number | undefined => {
	if (typeof x === 'number') return Number.isSafeInteger(x) ? x : undefined
	if (!isObject(x)) return undefined
	if (typeof x.toNumber === 'function') {
		const value = (x.toNumber as () => unknown)()
		// `Long.toNumber` rounds rather than refusing, so a value past 2^53
		// comes back finite and wrong. Only exact ones are worth reporting.
		return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
	}
	const low = x.low
	if (typeof low !== 'number') return undefined
	const high = typeof x.high === 'number' ? x.high : 0
	// The pair is `high * 2^32 + (low >>> 0)`, signed through `high`. Reading
	// the halves separately gets the sign right only by accident: `high: -1`
	// with `low: 0` is -2^32, not 0.
	const value = high * 2 ** 32 + (low >>> 0)
	return Number.isSafeInteger(value) ? value : undefined
}

/**
 * A `std::time::Duration`, in whole seconds.
 *
 * Serde writes one as `{ secs, nanos }`, and the bridge's own declaration for
 * these fields says `number` — so a consumer reading the declared type off a
 * plain-serialized event gets an object where it expected a count. Both are
 * accepted here rather than betting on which side moves first; sub-second
 * precision is dropped because every caller of this is a ban or a backoff
 * measured in seconds.
 */
export const asDurationSeconds = (x: unknown): number | undefined => {
	if (typeof x === 'number') return Number.isFinite(x) ? x : undefined
	if (!isObject(x)) return undefined
	const secs = asInt64(x.secs)
	return secs === undefined ? undefined : secs
}

/**
 * Lowercase a discriminator string defensively — handles both the current
 * lowercase wire-tag form and any legacy PascalCase form an older bridge
 * might still emit.
 */
export const normalizeDiscriminator = (x: unknown): string | undefined => {
	const s = asString(x)
	return s ? s.toLowerCase() : undefined
}

/**
 * Turn a duration in seconds into the unix-seconds instant it ends at.
 *
 * The bridge reports a temporary ban the way the wire states it, as how long
 * the ban lasts. Consumers are promised the deadline: the socket formats it
 * with `new Date(expire * 1000)` and a reconnect policy subtracts `Date.now()`
 * from it, so handing either of them a relative count puts the ban in 1970 and
 * lets a bot retry immediately.
 */
export const absoluteFromDuration = (seconds: number | undefined): number | undefined => {
	if (seconds === undefined) return undefined
	const deadline = Math.floor(Date.now() / 1000) + seconds
	// A deadline `Date` cannot hold is worse than none: the socket formats this
	// with `new Date(expire * 1000).toISOString()`, which throws a RangeError
	// past ±8.64e15 ms and would take the event dispatch down with it.
	return Number.isSafeInteger(deadline) && Math.abs(deadline) <= MAX_DATE_SECONDS ? deadline : undefined
}

/** `Date` holds ±8.64e15 ms, which is this many whole seconds. */
const MAX_DATE_SECONDS = 8_640_000_000_000

/** Wire collection names and the like: anything that is not a string is not one. */
export const asStringArray = (x: unknown): string[] =>
	Array.isArray(x) ? x.filter((item): item is string => typeof item === 'string') : []
