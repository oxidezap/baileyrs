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
 * Coerce a timestamp value into unix seconds. Accepts both numbers and ISO
 * strings — the bridge serializes `DateTime<Utc>` as ISO unless explicitly
 * typed with `ts_seconds`, so being lenient here insulates us from drift.
 */
export const toUnixSeconds = (raw: unknown): number => {
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw
	if (typeof raw === 'string') {
		const ms = Date.parse(raw)
		if (Number.isFinite(ms)) return Math.floor(ms / 1000)
	}
	return 0
}

/**
 * Same as `toUnixSeconds`, but absence stays absent.
 *
 * The optional timestamps — `last_seen`, a server ack's `t`, an app-state
 * mutation's own time — mean "the server did not say" when missing, which is
 * not the same claim as the epoch.
 */
export const asUnixSeconds = (raw: unknown): number | undefined => {
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw
	if (typeof raw === 'string') {
		const ms = Date.parse(raw)
		if (Number.isFinite(ms)) return Math.floor(ms / 1000)
	}
	return undefined
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
	if (typeof x === 'number') return Number.isFinite(x) ? x : undefined
	if (!isObject(x)) return undefined
	if (typeof x.toNumber === 'function') {
		const value = (x.toNumber as () => unknown)()
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined
	}
	const low = x.low
	const high = x.high
	if (typeof low !== 'number') return undefined
	if (high === 0) return low >>> 0
	if (high === -1) return low | 0
	return undefined
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
