/**
 * Known-divergence registry.
 *
 * Not every difference from upstream Baileys is a bug — some are the reason
 * baileyrs exists. Without a place to record those on purpose, a differential
 * fuzzer reports them on every run and the whole suite becomes noise people
 * learn to skip.
 *
 * An entry is a claim with an owner and a date, not a mute button:
 *   - `reason` says why the difference is correct, in prose someone else can audit.
 *   - `review` is when the claim expires. Past that date the suite says so, and
 *     under `FUZZ_STRICT_ALLOWLIST=1` (the nightly job) it fails, which is what
 *     forces the entry to be re-argued instead of inherited forever.
 *
 * A run also reports entries that never matched: an allowlist that outlives the
 * divergence it excused is how a real regression slips back in unnoticed.
 */

import { normalise } from './compare.ts'

export interface Divergence {
	/** Fuzzer-scoped identity, e.g. `jid:jidDecode` or `proto:Message.roundTrip`. */
	readonly target: string
	/** The generated input that produced the difference. */
	readonly input: unknown
	/** What baileyrs produced. */
	readonly local: unknown
	/** What upstream Baileys produced. */
	readonly upstream: unknown
	/** Short human-readable summary of the difference. */
	readonly detail?: string
}

/**
 * `intended` — baileyrs behaves differently on purpose and the difference is
 * correct. Silence is the right outcome.
 *
 * `open` — a real difference nobody has decided about yet. It is recorded so the
 * suite stays green and the next run does not re-report it as news, but it is
 * printed on *every* run and listed by `scripts/fuzz/report.ts`. An open entry is
 * a tracked bug, not a resolved one; the distinction exists so that "we know
 * about it" can never quietly become "it is fine".
 */
export type DivergenceStatus = 'intended' | 'open'

export interface KnownDivergence {
	/** Stable id, referenced from commit messages and issues. */
	readonly id: string
	/** Matches `Divergence.target` exactly, or by pattern for a family of targets. */
	readonly target: string | RegExp
	/** Whether the difference is deliberate, or merely known. */
	readonly status: DivergenceStatus
	/** Why this difference is intended, or what is still undecided about it. */
	readonly reason: string
	/** ISO date (YYYY-MM-DD) after which the claim has to be re-argued. */
	readonly review: string
	/** Narrows the entry to the specific difference; omit to accept the whole target. */
	readonly when?: (divergence: Divergence) => boolean
}

/**
 * Fields upstream encodes and the bridge writes nothing for.
 *
 * Listed exactly, so a twelfth one fails the suite instead of joining them
 * quietly. Found by the `proto:field-numbers` sweep once it stopped skipping the
 * case where only the bridge produced no bytes.
 */
const NOT_ENCODED_FIELDS: readonly string[] = [
	'Message.AudioMessage.mediaKeyDomain',
	'Message.DocumentMessage.mediaKeyDomain',
	'Message.ImageMessage.mediaKeyDomain',
	'Message.MMSThumbnailMetadata.mediaKeyDomain',
	'Message.StickerMessage.mediaKeyDomain',
	'Message.VideoMessage.mediaKeyDomain',
	'Message.MessageHistoryMetadata.oldestMessageTimestamp',
	'Message.PaymentExtendedMetadata.messageParamsJson',
	'SyncActionValue.businessBroadcastAssociationAction',
	'SyncActionValue.AgentAction.deviceID',
	'SyncActionValue.ChatAssignmentAction.deviceAgentID'
]

/**
 * The exact fields the bridge round-trips under another name.
 *
 * Enumerated rather than pattern-matched: "the names differ" would excuse any
 * future rename, which is the failure this entry exists to catch. The list comes
 * from the exhaustive `proto:field-names` sweep, so it is complete as of writing
 * and any addition to it will fail the suite first.
 */
const RENAMED_PROTO_FIELDS: readonly (readonly [upstream: string, bridge: string])[] = [
	['deviceAgentID', 'deviceAgentId'],
	['deviceID', 'deviceId'],
	['oldestMessageTimestamp', 'oldestMessageTimestampInWindow']
]

/**
 * Rewrites the bridge's spelling of every renamed field back to upstream's,
 * recursively.
 *
 * The point is what happens after: if the two sides are then equal, the rename is
 * the entire difference and the entry legitimately explains it. If anything else
 * still differs, the finding contains a second defect and must not be excused —
 * matching on "both names appear somewhere in the text" alone would have let a
 * decode regression ride along beside a known rename.
 */
export const undoRenames = (value: unknown, depth = 0): unknown => {
	if (depth > 12 || typeof value !== 'object' || value === null) return value
	if (Array.isArray(value)) return value.map(item => undoRenames(item, depth + 1))
	const out: Record<string, unknown> = {}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		const rename = RENAMED_PROTO_FIELDS.find(([, bridgeName]) => bridgeName === key)
		Object.defineProperty(out, rename ? rename[0] : key, {
			value: undoRenames(nested, depth + 1),
			enumerable: true,
			writable: true,
			configurable: true
		})
	}
	return out
}

/**
 * The keys a decoded object may be missing, qualified by where they sit.
 *
 * Deliberately NOT the leaves of `NOT_ENCODED_FIELDS`, for two reasons that a
 * leaf-name set gets wrong in opposite directions.
 *
 * That list is the *encoder* gap, and three of its entries — `deviceID`,
 * `deviceAgentID`, `oldestMessageTimestamp` — are decoded under a renamed
 * property rather than dropped. Taking its leaves would let one valid rename
 * stand in for a key genuinely missing somewhere else: a `SyncActionValue`
 * showing the expected `AgentAction.deviceId` alongside a newly absent
 * `ChatAssignmentAction.deviceAgentID` would pass, because `undoRenames`
 * restores the first and the set forgives the second.
 *
 * And a leaf name is not unique. `messageParamsJson` is unwritten on
 * `Message.PaymentExtendedMetadata`, while the schema declares another on
 * `Message.InteractiveMessage.NativeFlowMessage` — so accepting the bare leaf
 * at any nesting depth would excuse a new drop of the second as though it were
 * the documented first.
 *
 * Keyed by `<decoded type>.<key path>` and measured rather than derived: this
 * is the absence the decode targets actually produced. A drop anywhere else,
 * including the same leaf under a different holder, still fails.
 */
const DECODE_OMITTED_PATHS: ReadonlySet<string> = new Set([
	'SyncActionValue.businessBroadcastAssociationAction',
	// Measured after the 0.8.0 bump, on a ContextInfo whose quoted message is a
	// video: `Message.VideoMessage.mediaKeyDomain` is one of the eleven the bridge
	// never writes, and this is the path a generative draw puts it at. Listed
	// rather than matched by leaf, so the same field under another holder is still
	// a drop nobody has looked at.
	'ContextInfo.quotedMessage.videoMessage.mediaKeyDomain'
])

/**
 * True when the two decodes agree once the documented absences are allowed on
 * the bridge's side, and nothing else differs.
 *
 * Directional on purpose. Upstream may carry a key this side lacks, and only at
 * a path `DECODE_OMITTED_PATHS` names; this side carrying a key upstream lacks
 * is a decoder inventing a property, which is a different defect. Any value that
 * differs where both sides have the key fails outright, so this can never excuse
 * a misread — only an absence that is already on the record.
 */
const sameExceptUnwrittenFields = (local: unknown, upstream: unknown, path: string, depth = 0): boolean => {
	if (depth > 12) return sameShape(local, upstream)
	if (Array.isArray(local) || Array.isArray(upstream)) {
		if (!Array.isArray(local) || !Array.isArray(upstream) || local.length !== upstream.length) return false
		// The index is not part of the path: a repeated field's elements all share
		// the declaring field, and numbering them would make the set unwritable.
		return local.every((item, index) => sameExceptUnwrittenFields(item, upstream[index], path, depth + 1))
	}
	const ourKeys = plainObject(local)
	const theirKeys = plainObject(upstream)
	if (ourKeys === undefined || theirKeys === undefined) return sameShape(local, upstream)
	const ours = local as Record<string, unknown>
	const theirs = upstream as Record<string, unknown>
	for (const key of theirKeys) {
		const here = `${path}.${key}`
		if (!Object.hasOwn(ours, key)) {
			if (!DECODE_OMITTED_PATHS.has(here)) return false
			continue
		}
		if (!sameExceptUnwrittenFields(ours[key], theirs[key], here, depth + 1)) return false
	}
	return ourKeys.every(key => Object.hasOwn(theirs, key))
}

/**
 * The keys of a plain object, or `undefined` for anything else.
 *
 * Predicates that want to say "decoded nothing" have to distinguish an empty
 * message from a `null`, a string or an array — `Object.keys` answers all four
 * and only one of them is the claim being made.
 */
const plainObject = (value: unknown): string[] | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : undefined

/** `showOutcome` renders a thrown result as this prefix; a returned value is passed through raw. */
const isThrow = (value: unknown): value is string => typeof value === 'string' && value.startsWith('<throw ')

/**
 * The `path` a proto finding names, however that target spells its input.
 *
 * The sweeps disagree on shape — the type inventory passes a bare path string,
 * the codec targets pass `{ path, message }` — and a substring match over the
 * serialised form is no substitute: `text()` stringifies without spaces, so a
 * pattern written against the pretty-printed report matches nothing at all, and
 * a bare `includes('Message')` matches every nested type there is.
 */
const inputPath = (input: unknown): string | undefined => {
	if (typeof input === 'string') return input
	const path = (input as { path?: unknown } | null | undefined)?.path
	return typeof path === 'string' ? path : undefined
}

/**
 * The ten explicit-presence fields the bridge encoder drops at their zero value.
 *
 * Enumerated rather than left to the target name. The `proto:presence` sweep
 * covers all 1696 proto3-optional fields, and the whole value of a sweep is that
 * an eleventh has to fail rather than be absorbed into the entry describing the
 * ten. (`BotAvatarMetadata`'s five presence fields are not here: the bridge does
 * not implement that type at all, so they route to the unknown-type entry.)
 */
const PRESENCE_DROPPED_FIELDS: readonly string[] = [
	'Message.AudioMessage.mediaKeyDomain',
	'Message.DocumentMessage.mediaKeyDomain',
	'Message.ImageMessage.mediaKeyDomain',
	'Message.MMSThumbnailMetadata.mediaKeyDomain',
	'Message.StickerMessage.mediaKeyDomain',
	'Message.VideoMessage.mediaKeyDomain',
	'Message.MessageHistoryMetadata.oldestMessageTimestamp',
	'Message.PaymentExtendedMetadata.messageParamsJson',
	'SyncActionValue.AgentAction.deviceID',
	'SyncActionValue.ChatAssignmentAction.deviceAgentID'
]

/** The message type the bridge codec does not implement. */
const UNKNOWN_CODEC_TYPES: readonly string[] = ['BotAvatarMetadata']

/** The messages whose schema reaches it — where a `{ path, message }` finding names the holder. */
const UNKNOWN_CODEC_HOLDERS: readonly string[] = ['BotMetadata', 'Message', 'MessageContextInfo']

/** The individual fields the sweeps name, either on the missing type or holding one. */
const UNKNOWN_CODEC_FIELDS: readonly string[] = [
	'BotAvatarMetadata.action',
	'BotAvatarMetadata.behaviorGraph',
	'BotAvatarMetadata.intensity',
	'BotAvatarMetadata.sentiment',
	'BotAvatarMetadata.wordCount',
	'BotMetadata.avatarMetadata'
]

/**
 * True when a finding names a type the bridge codec does not implement.
 *
 * Three input shapes reach this entry and they match differently, which is why
 * the lists are separate rather than one prefix test: the inventory sweep passes
 * a bare type name, the field sweeps pass `Type.field` (with the presence sweep
 * appending ` = <zero>`), and the byte-level classifier passes `{ path }` naming
 * the *holder*. Prefix-matching the holders instead would make `Message` cover
 * every nested message type in the schema.
 *
 * Pinned rather than left to the runtime probe behind the target: that probe is
 * what makes the entry self-retiring once the bridge implements the type, but it
 * would equally route a type the bridge *loses* straight into this entry as
 * though it had always been here.
 */
const namesUnknownCodecType = (input: unknown): boolean => {
	if (typeof input === 'string') {
		const spec = input.split(' = ')[0]!
		return UNKNOWN_CODEC_TYPES.includes(spec) || UNKNOWN_CODEC_FIELDS.includes(spec)
	}
	const path = inputPath(input)
	return path !== undefined && (UNKNOWN_CODEC_TYPES.includes(path) || UNKNOWN_CODEC_HOLDERS.includes(path))
}

/**
 * The two key fields `cleanMessage` re-encodes through `jidNormalizedUser`.
 *
 * Both, not just `remoteJid`: the same empty-user rewrite is observable on
 * `participant`, and an entry scoped to one field reported the other as an
 * unrelated finding. Measured — `{ key: { participant: '@hosted' } }` with an
 * empty meId leaves `@hosted` in baileyrs and becomes `@s.whatsapp.net`
 * upstream, exactly as `remoteJid` does.
 */
const CLEANED_JID_FIELDS = new Set(['remoteJid', 'participant'])

/**
 * True when upstream is baileyrs plus JID keys that all hold the empty string.
 *
 * That is the whole of the `cleanMessage` difference: for a key with no
 * remoteJid or participant, upstream writes `jidNormalizedUser(undefined)` —
 * `''` — onto the caller's object where baileyrs leaves the property absent.
 * Anything else, including a changed value or a key upstream is missing, is a
 * different defect and still fails.
 *
 * "JID keys" is the part that has to be checked rather than assumed. Without it
 * the rule read "upstream has an extra key holding `''`", which is also true of
 * a dropped empty `conversation` or `reactionMessage.text` — measured, both were
 * excused as the known missing-JID difference. Only the two fields
 * `cleanMessage` actually normalises may appear this way.
 */
const addsOnlyEmptyStrings = (local: unknown, upstream: unknown, depth = 0): boolean => {
	if (depth > 12) return false
	if (Array.isArray(local) || Array.isArray(upstream)) {
		if (!Array.isArray(local) || !Array.isArray(upstream) || local.length !== upstream.length) return false
		return local.every(
			(item, index) => sameShape(item, upstream[index]) || addsOnlyEmptyStrings(item, upstream[index], depth + 1)
		)
	}
	if (typeof local !== 'object' || typeof upstream !== 'object' || local === null || upstream === null) {
		return sameShape(local, upstream)
	}
	const a = local as Record<string, unknown>
	const b = upstream as Record<string, unknown>
	// A key baileyrs has and upstream does not is the reverse of the claim.
	for (const key of Object.keys(a)) if (!Object.hasOwn(b, key) && a[key] !== undefined) return false
	for (const key of Object.keys(b)) {
		if (!Object.hasOwn(a, key) || a[key] === undefined) {
			if (b[key] !== '' || !CLEANED_JID_FIELDS.has(key)) return false
			continue
		}
		if (!sameShape(a[key], b[key]) && !addsOnlyEmptyStrings(a[key], b[key], depth + 1)) return false
	}
	return true
}

/**
 * Replaces every normalised key JID with a sentinel, recursively.
 *
 * Lets a predicate say "apart from those JIDs, these agree" without
 * hand-walking the argument tuple the mutation target reports.
 */
const maskKeyJids = (value: unknown, depth = 0): unknown => {
	if (depth > 12 || typeof value !== 'object' || value === null) return value
	if (Array.isArray(value)) return value.map(item => maskKeyJids(item, depth + 1))
	const out: Record<string, unknown> = {}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		Object.defineProperty(out, key, {
			// The empty string is left alone rather than masked. It is the *other*
			// entry's subject — upstream materialising a missing JID as `''` — and
			// masking it to the same sentinel as a real JID stopped
			// `addsOnlyEmptyStrings` from recognising it, so a key that hit both
			// differences at once matched neither entry.
			value:
				CLEANED_JID_FIELDS.has(key) && typeof nested === 'string' && nested !== ''
					? '<jid>'
					: maskKeyJids(nested, depth + 1),
			enumerable: true,
			writable: true,
			configurable: true
		})
	}
	return out
}

/**
 * Every non-empty normalised key JID a divergence side carries, by path.
 *
 * Keyed by path rather than collected into a list, because the two sides are
 * then compared field to field: a `remoteJid` on one side lining up with a
 * `participant` on the other is a different defect from the one this documents,
 * and must not be excused by it.
 */
const keyJids = (value: unknown, prefix = '', found = new Map<string, string>(), depth = 0): Map<string, string> => {
	if (depth > 12 || typeof value !== 'object' || value === null) return found
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) keyJids(item, `${prefix}[${index}]`, found, depth + 1)
		return found
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		const path = `${prefix}.${key}`
		if (CLEANED_JID_FIELDS.has(key) && typeof nested === 'string') {
			if (nested !== '') found.set(path, nested)
		} else keyJids(nested, path, found, depth + 1)
	}
	return found
}

/**
 * Substitutes U+FFFD for every unpaired surrogate in every string, recursively.
 *
 * Three of them per surrogate, not one: upstream copies content through
 * `proto.Message.decode(proto.Message.encode(content))`, protobufjs writes the
 * surrogate as three WTF-8 bytes, and decoding those back as UTF-8 yields three
 * replacement characters. Measured on `\ud800`.
 */
const replaceLoneSurrogates = (value: unknown, depth = 0): unknown => {
	if (depth > 12) return value
	if (typeof value === 'string') {
		return value.replaceAll(
			/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/gu,
			'\ufffd\ufffd\ufffd'
		)
	}
	if (Array.isArray(value)) return value.map(item => replaceLoneSurrogates(item, depth + 1))
	if (typeof value !== 'object' || value === null) return value
	const out: Record<string, unknown> = {}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		Object.defineProperty(out, key, {
			value: replaceLoneSurrogates(nested, depth + 1),
			enumerable: true,
			writable: true,
			configurable: true
		})
	}
	return out
}

/** The largest finite float32; anything above it is what the bridge refuses. */
const FLT_MAX = 3.4028234663852886e38

/**
 * True when the generated input carries a number the float32 range cannot hold.
 *
 * Walked structurally rather than matched in the serialised text: the codec
 * targets pass `{ path, message }` and the presence sweep passes a
 * `Path.field = value` string, and in both the interesting part is a magnitude,
 * not a substring.
 */
const carriesOutOfRangeFloat = (value: unknown, depth = 0): boolean => {
	if (depth > 12) return false
	if (typeof value === 'number') return !Number.isFinite(value) || Math.abs(value) > FLT_MAX
	if (typeof value === 'string') {
		const parsed = Number(value.split(' = ').at(-1))
		return Number.isFinite(parsed) ? Math.abs(parsed) > FLT_MAX : false
	}
	if (Array.isArray(value)) return value.some(item => carriesOutOfRangeFloat(item, depth + 1))
	if (typeof value !== 'object' || value === null) return false
	return Object.values(value as Record<string, unknown>).some(nested => carriesOutOfRangeFloat(nested, depth + 1))
}

/**
 * Every top-level field the bridge encoder is known to drop.
 *
 * Measured rather than sampled: nine seeds and 21,000 generated cases produce
 * exactly these twelve `path#number` pairs and no others. A thirteenth is new
 * data loss and must be looked at, which is the entire point of listing them.
 */
const KNOWN_OMITTED_FIELDS: ReadonlySet<string> = new Set([
	'BotMetadata#1',
	'Message.AudioMessage#23',
	'Message.DocumentMessage#22',
	'Message.ImageMessage#33',
	'Message.MMSThumbnailMetadata#8',
	'Message.MessageHistoryMetadata#2',
	'Message.PaymentExtendedMetadata#3',
	'Message.StickerMessage#23',
	'Message.VideoMessage#32',
	'SyncActionValue#65',
	'SyncActionValue.AgentAction#2',
	'SyncActionValue.ChatAssignmentAction#1'
])

/**
 * True when a finding carries a classification its target computed for it.
 *
 * Targets append `[tag]` to the detail — and `[tag-a; tag-b]` when more than one
 * applies, which is why this looks inside the brackets rather than matching them
 * whole. An earlier version anchored on `[tag]` and silently stopped matching
 * the moment a second classification joined it, quietly un-excusing a
 * documented difference.
 */
const hasTag = (divergence: Divergence, tag: string): boolean => {
	const detail = divergence.detail ?? ''
	const start = detail.lastIndexOf('[')
	if (start < 0 || !detail.endsWith(']')) return false
	return detail
		.slice(start + 1, -1)
		.split('; ')
		.includes(tag)
}

/**
 * True when `value` holds a 64-bit magnitude outside ±(2^53−1).
 *
 * Strings as well as numbers: the generator seeds 64-bit fields as decimal
 * strings, because that is how protobufjs renders them and how a caller would
 * supply one. `9007199254740991` is inside the range and must not match — it is
 * the exact boundary the entry says still decodes.
 */
const carriesBeyondSafeInteger = (value: unknown, depth = 0): boolean => {
	if (depth > 12) return false
	if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER
	if (typeof value === 'bigint')
		return value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)
	if (typeof value === 'string') {
		if (!/^-?\d+$/u.test(value)) return false
		const parsed = BigInt(value)
		return parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < -BigInt(Number.MAX_SAFE_INTEGER)
	}
	if (Array.isArray(value)) return value.some(item => carriesBeyondSafeInteger(item, depth + 1))
	if (typeof value !== 'object' || value === null) return false
	return Object.values(value as Record<string, unknown>).some(nested => carriesBeyondSafeInteger(nested, depth + 1))
}

/** Removes one property wherever it appears, so a predicate can ask what is left. */
const withoutKey = (value: unknown, name: string, depth = 0): unknown => {
	if (depth > 12) return value
	if (Array.isArray(value)) return value.map(item => withoutKey(item, name, depth + 1))
	if (typeof value !== 'object' || value === null) return value
	const out: Record<string, unknown> = {}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key === name) continue
		Object.defineProperty(out, key, {
			value: withoutKey(nested, name, depth + 1),
			enumerable: true,
			writable: true,
			configurable: true
		})
	}
	return out
}

/**
 * Replaces every string with a placeholder, leaving the structure.
 *
 * The two decoders resolve invalid UTF-8 into *different characters*, not into a
 * known substitution — the bridge writes one U+FFFD per bad byte, protobufjs
 * runs its own reader and produces whatever it makes of them. So there is no
 * character class to fold: what can be checked is that the difference is
 * confined to text at all. Masking the strings and requiring the rest to agree
 * rules out a dropped field, a changed number, a different nesting — everything
 * except the text itself.
 *
 * The residual gap is a regression that changed some *other* string field while
 * one field happened to hold invalid UTF-8. Closing that needs the decoders to
 * report which bytes they could not read.
 */
const maskStrings = (value: unknown, depth = 0): unknown => {
	if (depth > 12) return value
	if (typeof value === 'string') return '<text>'
	if (Array.isArray(value)) return value.map(item => maskStrings(item, depth + 1))
	if (typeof value !== 'object' || value === null) return value
	const out: Record<string, unknown> = {}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		Object.defineProperty(out, key, {
			value: maskStrings(nested, depth + 1),
			enumerable: true,
			writable: true,
			configurable: true
		})
	}
	return out
}

/**
 * True when two poll aggregates hold the same options and voters, in any order.
 *
 * The entry claims ordering and nothing else, so that is what has to be checked:
 * a voter moved to the wrong bucket, a dropped voter or a renamed option all
 * change the multiset and must still be reported.
 */
const samePollAggregate = (left: unknown, right: unknown): boolean => {
	if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
	const key = (entry: unknown): string => {
		if (typeof entry !== 'object' || entry === null) return text(entry)
		const record = entry as Record<string, unknown>
		const voters = Array.isArray(record.voters) ? record.voters.map(voter => text(voter)).toSorted() : record.voters
		return text({ ...record, voters })
	}
	return text(left.map(key).toSorted()) === text(right.map(key).toSorted()) && text(left) !== text(right)
}

/**
 * True when `value` holds a number an int64 field cannot represent exactly.
 *
 * Which is what makes the two implementations disagree: `1.5`, `NaN`,
 * `Infinity` and `1e300` are all numbers, and none of them is a 64-bit integer.
 * Safe integers and numeric strings are excluded, because both sides handle
 * those identically — measured on `senderTimestampMs`, where `12345`, `'12345'`,
 * `0`, `null` and `undefined` all encode byte-for-byte the same.
 */
const carriesInexactInt64 = (value: unknown, depth = 0): boolean => {
	if (depth > 12) return false
	if (typeof value === 'number') return !Number.isSafeInteger(value)
	if (Array.isArray(value)) return value.some(item => carriesInexactInt64(item, depth + 1))
	if (typeof value !== 'object' || value === null) return false
	return Object.values(value as Record<string, unknown>).some(nested => carriesInexactInt64(nested, depth + 1))
}

/**
 * Replaces each side's int64 truncation with one sentinel, in place of the pair.
 *
 * A sentinel rather than a verdict, so this composes with the key-presence entry
 * instead of duplicating it: one message can exhibit both differences at once —
 * measured on `{ pollUpdateMessage: { pollCreationMessageKey: { remoteJidAlt:
 * '' }, senderTimestampMs: -1.5 } }`, where the round trip both truncates the
 * timestamp and drops the empty alt JID — and a predicate that demanded matching
 * key sets then matched neither entry.
 *
 * `normalise` folds a safe integer into a bigint and leaves everything else a
 * number, so "baileyrs kept a float, upstream holds an integer" is exactly
 * `typeof local === 'number'` against `typeof upstream === 'bigint'`. A changed
 * *integer*, a changed string, or a dropped field is none of those, stays
 * unmasked, and still fails.
 */
const maskInt64Truncations = (local: unknown, upstream: unknown, depth = 0): [unknown, unknown] => {
	if (depth > 12) return [local, upstream]
	// The leaf rule: a non-integer (or NaN/Infinity) against any integer, and
	// `null` against the field's zero default, which is what the round trip writes
	// for a numeric field that was not set to a number at all.
	if (typeof local === 'number' && typeof upstream === 'bigint') return ['<int64>', '<int64>']
	if (local === null && upstream === 0n) return ['<int64>', '<int64>']
	if (Array.isArray(local) && Array.isArray(upstream) && local.length === upstream.length) {
		const pairs = local.map((item, index) => maskInt64Truncations(item, upstream[index], depth + 1))
		return [pairs.map(pair => pair[0]), pairs.map(pair => pair[1])]
	}
	if (typeof local !== 'object' || typeof upstream !== 'object' || local === null || upstream === null) {
		return [local, upstream]
	}
	if (Array.isArray(local) || Array.isArray(upstream)) return [local, upstream]
	const a = local as Record<string, unknown>
	const b = upstream as Record<string, unknown>
	const maskedLocal: Record<string, unknown> = {}
	const maskedUpstream: Record<string, unknown> = {}
	// Only the keys both carry are paired up. A key on one side alone is the
	// key-presence entry's subject and is passed through untouched, so that entry
	// still has to account for it.
	for (const key of Object.keys(a)) maskedLocal[key] = a[key]
	for (const key of Object.keys(b)) maskedUpstream[key] = b[key]
	for (const key of Object.keys(a)) {
		if (!Object.hasOwn(b, key)) continue
		const [left, right] = maskInt64Truncations(a[key], b[key], depth + 1)
		maskedLocal[key] = left
		maskedUpstream[key] = right
	}
	return [maskedLocal, maskedUpstream]
}

/**
 * What `generateForwardMessageContent`'s two copy strategies are allowed to
 * differ by, once every documented normalisation has been undone.
 *
 * One helper rather than three predicates, because the differences co-occur.
 * Upstream copies through `proto.Message.decode(proto.Message.encode(content))`
 * and baileyrs shallow-clones, so a single message can show all of them at once
 * — measured on `{ pollUpdateMessage: { pollCreationMessageKey: { remoteJid:
 * '\ud83d' }, senderTimestampMs: -1.5 } }`, where the round trip substitutes the
 * lone surrogate, truncates the timestamp *and* drops the added `contextInfo`.
 * Each entry below still needs its own trigger to say which difference it is
 * about; what they share is what is allowed to remain afterwards.
 *
 * Anything the normalisations do not explain — a changed body, a changed
 * integer, a dropped field with a value — survives and still fails.
 */
const copyStrategyResidue = (local: unknown, upstream: unknown): boolean => {
	const [mine, theirs] = maskInt64Truncations(replaceLoneSurrogates(local), upstream)
	return differsOnlyByKeyPresence(mine, theirs)
}

/**
 * The two event kinds whose buffered merges resolve differently.
 *
 * Not every kind: `chats.update` twice, and a `groups.update` whose later event
 * carries *nothing but the id*, were measured alongside these and agree. The
 * id-only case agrees because there is no field to merge — an update carrying
 * any other field, `announce` included, diverges. Listing the two kinds rather
 * than allowing any kind is what stops this entry from covering a consolidation
 * difference nobody has looked at.
 */
const MERGE_PRECEDENCE_KINDS: ReadonlySet<string> = new Set(['contacts.upsert', 'groups.update'])

/**
 * The fields whose *value* the two buffers are allowed to disagree on.
 *
 * `subject` on a group, and nothing else. `name` on a contact was here until the
 * `contacts.upsert` fold was corrected to apply a buffered update *before* the
 * upsert that follows it; the two now agree on every value a contact carries and
 * differ only by the fields upstream drops. Leaving `name` pinned would have
 * meant the fuzzer excusing a regression of exactly that fix.
 *
 * Everything else about a paired release has to match, so a consolidation that
 * started emitting a wrong `announce`, `id` or timestamp is reported rather than
 * folded into this entry. Pinning the field is the same treatment
 * `KNOWN_OMITTED_FIELDS` and `PRESENCE_DROPPED_FIELDS` get, and for the same
 * reason: "some field differs" is not a description of a defect.
 */
const MERGE_PRECEDENCE_VALUE_FIELDS: ReadonlySet<string> = new Set(['subject'])

/**
 * True when `mine` is `theirs` plus fields, disagreeing only on the pinned ones.
 *
 * Directional on purpose. What this entry documents is upstream *losing* data —
 * a field it dropped on merge is present here — so a release where **this** side
 * lost a field is not this divergence and must fail. Accepting any textual
 * difference, which is what the predicate did before, meant a regression that
 * dropped a field here, or wrote a wrong value into any field at all, was
 * suppressed in both directions.
 */
const addsFieldsOrPinnedValues = (mine: unknown, theirs: unknown): boolean => {
	if (Array.isArray(mine) || Array.isArray(theirs)) {
		if (!Array.isArray(mine) || !Array.isArray(theirs) || mine.length !== theirs.length) return false
		return mine.every((entry, index) => addsFieldsOrPinnedValues(entry, theirs[index]))
	}
	if (typeof mine !== 'object' || typeof theirs !== 'object' || mine === null || theirs === null) {
		return text(mine) === text(theirs)
	}
	const ours = mine as Record<string, unknown>
	const upstream = theirs as Record<string, unknown>
	for (const [key, value] of Object.entries(upstream)) {
		if (!Object.hasOwn(ours, key)) return false
		if (text(ours[key]) === text(value)) continue
		if (!MERGE_PRECEDENCE_VALUE_FIELDS.has(key)) return false
	}
	return true
}

/**
 * True when the two released sequences differ only in the fields of those
 * kinds, for the same ids.
 *
 * Position-sensitive. It was not always: the two buffers used to interleave
 * kinds differently, so the finding that motivated this entry had
 * `contacts.upsert` and `message-receipt.update` swapped *and* a contact field
 * differing, and pairing by index matched neither entry. `consolidateEvents`
 * now writes its keys in upstream's order, so the release sequences line up and
 * the slack is gone: a reordering is no longer a documented difference, and an
 * entry that still tolerated one would be the thing excusing it.
 *
 * Narrow: the kinds have to match in sequence, the ids have to match, at least
 * one field has to actually differ, and any difference on any other release
 * fails.
 */
const mergePrecedenceFieldsOnly = (local: unknown, upstream: unknown): boolean => {
	if (!Array.isArray(local) || !Array.isArray(upstream) || local.length !== upstream.length) return false

	const idsOf = (data: unknown): string =>
		Array.isArray(data)
			? text(data.map(entry => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : entry)))
			: text(data)

	// A contacts.upsert pairs on its ids alone; everything else pairs on its whole
	// content, so a changed payload elsewhere cannot find a partner and fails.
	const pairKey = (item: unknown): string => {
		const released = (item as { released?: unknown })?.released
		return typeof released === 'string' && MERGE_PRECEDENCE_KINDS.has(released)
			? `${released}\u0000${idsOf((item as { data?: unknown }).data)}`
			: text(item)
	}

	let differing = 0
	for (const [index, mine] of local.entries()) {
		const theirs = upstream[index]
		// A release that moved is a reordering, and nothing documents one now.
		if (pairKey(mine) !== pairKey(theirs)) return false
		if (text(mine) === text(theirs)) continue
		if (!addsFieldsOrPinnedValues((mine as { data?: unknown })?.data, (theirs as { data?: unknown })?.data)) {
			return false
		}
		differing++
	}
	// Something has to have differed *inside* one of the pinned kinds. Without
	// this the entry would excuse two identical sequences, which is not a finding.
	return differing > 0
}

/**
 * True when two values agree on every key they share, differing only by which
 * keys are present.
 *
 * Neither side needs to be a subset of the other. The two copy strategies in
 * `generateForwardMessageContent` differ in both directions at once — upstream's
 * protobuf round trip materialises empty repeated fields and drops undeclared
 * ones — so a one-directional subset test does not describe it. Any *value* the
 * two both carry and disagree on still fails.
 */
const differsOnlyByKeyPresence = (left: unknown, right: unknown): boolean => {
	// Counts the shared keys the walk actually compared. Without it the object
	// branch returns `true` vacuously for two objects that share no key at all —
	// the loop body never runs — so `{ conversation: 'x' }` against
	// `{ imageMessage: {} }` reads as "differs only by key presence" and a
	// content object replaced wholesale would be excused. Nothing was compared,
	// so nothing was verified, and the entry must not claim otherwise.
	const state = { compared: 0 }
	return walkKeyPresence(left, right, 0, state) && state.compared > 0
}

const walkKeyPresence = (left: unknown, right: unknown, depth: number, state: { compared: number }): boolean => {
	if (depth > 12) return false
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
		return left.every((item, index) => {
			if (sameShape(item, right[index])) {
				state.compared++
				return true
			}
			return walkKeyPresence(item, right[index], depth + 1, state)
		})
	}
	if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
		return sameShape(left, right)
	}
	const a = left as Record<string, unknown>
	const b = right as Record<string, unknown>
	const shared = Object.keys(a).filter(key => Object.hasOwn(b, key))

	// Every unmatched key, checked against what the round trip actually does:
	// it materialises fields the schema declares (an empty repeated field, so
	// `[]`) and drops properties it does not (the scalars a caller tacked on).
	//
	// Applied to every level, not only to a level with no shared keys — which is
	// where this used to stop. With one key in common the loop below ran and the
	// unmatched ones were never looked at, so a *dropped message body* was
	// excused: `{ extendedTextMessage: { contextInfo } }` against
	// `{ extendedTextMessage: { text: 'the body', contextInfo } }` shares
	// `contextInfo`, and `text` went unexamined. Losing a message body is the
	// single thing this suite exists to catch, so it now has to be one of the two
	// documented artifacts or nothing.
	for (const key of Object.keys(b)) {
		if (Object.hasOwn(a, key)) continue
		// Upstream-only: the materialised empty repeated field, and nothing else.
		if (!Array.isArray(b[key]) || (b[key] as unknown[]).length > 0) return false
	}
	for (const key of Object.keys(a)) {
		if (Object.hasOwn(b, key)) continue
		// baileyrs-only: a scalar the schema does not declare, which is what the
		// round trip drops. An object here would be a whole subtree upstream lost.
		if (typeof a[key] === 'object' && a[key] !== null) return false
	}

	for (const key of shared) {
		state.compared++
		if (!sameShape(a[key], b[key]) && !walkKeyPresence(a[key], b[key], depth + 1, state)) return false
	}
	return true
}

/** Structural equality over the plain values a divergence carries. */
const sameShape = (left: unknown, right: unknown): boolean => {
	if (typeof left !== typeof right) return false
	if (typeof left !== 'object' || left === null || right === null) return Object.is(left, right)
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
		return left.every((item, index) => sameShape(item, right[index]))
	}
	const a = left as Record<string, unknown>
	const b = right as Record<string, unknown>
	const keys = Object.keys(a)
	if (keys.length !== Object.keys(b).length) return false
	return keys.every(key => Object.hasOwn(b, key) && sameShape(a[key], b[key]))
}

/**
 * Renders either side of a divergence for a predicate to match against.
 *
 * `String(value)` yields "[object Object]" for the decoded objects these
 * predicates inspect, which silently makes every `includes` check false — the
 * entry then excuses nothing and the finding reappears as unexplained.
 */
const text = (value: unknown): string => {
	if (typeof value === 'string') return value
	try {
		return (
			JSON.stringify(value, (_key, nested: unknown) => (typeof nested === 'bigint' ? nested.toString() : nested)) ?? ''
		)
	} catch {
		return ''
	}
}

/**
 * An unpaired UTF-16 surrogate, which is what the newsletter encoder differs on.
 *
 * Serialised input renders surrogates as `\udXXX` escapes, so the check runs
 * against both the raw character and its escaped form.
 */
const LONE_SURROGATE =
	/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]|\\ud[89ab][0-9a-f]{2}|\\ud[c-f][0-9a-f]{2}/iu

/**
 * True when the bridge kept fields upstream dropped, and nothing else differs.
 *
 * Directional and total: upstream may not carry a key the bridge lacks, no value
 * both sides hold may differ, and at least one field has to have been kept — so
 * this can never excuse a misread, only a retention.
 */
const keptFieldsUpstreamDropped = (local: unknown, upstream: unknown, depth = 0): number | undefined => {
	if (depth > 12) return sameShape(local, upstream) ? 0 : undefined
	if (Array.isArray(local) || Array.isArray(upstream)) {
		// Merging concatenates repeated fields, so the bridge's array is upstream's
		// with the later copy's elements appended. A prefix, exactly: every element
		// upstream produced has to match at its own index, and upstream being the
		// longer side is the bridge losing elements, which still fails.
		if (!Array.isArray(local) || !Array.isArray(upstream) || local.length < upstream.length) return undefined
		let kept = local.length - upstream.length
		for (const [index, item] of upstream.entries()) {
			const inner = keptFieldsUpstreamDropped(local[index], item, depth + 1)
			if (inner === undefined) return undefined
			kept += inner
		}
		return kept
	}
	const ourKeys = plainObject(local)
	const theirKeys = plainObject(upstream)
	if (ourKeys === undefined || theirKeys === undefined) return sameShape(local, upstream) ? 0 : undefined
	const ours = local as Record<string, unknown>
	const theirs = upstream as Record<string, unknown>
	// A key only upstream produced is the bridge losing data, which is the
	// opposite defect and must still be reported.
	if (theirKeys.some(key => !Object.hasOwn(ours, key))) return undefined
	let kept = ourKeys.length - theirKeys.length
	for (const key of theirKeys) {
		const inner = keptFieldsUpstreamDropped(ours[key], theirs[key], depth + 1)
		if (inner === undefined) return undefined
		kept += inner
	}
	return kept
}

/**
 * The registry.
 *
 * Every entry below was produced by a run of these fuzzers, not by guesswork,
 * and most carry a minimised reproducer under `src/__fuzz__/corpus/`.
 *
 * Several of the proto entries are *rediscoveries*, not discoveries: the
 * schema-level gaps — the mediaKeyDomain presence drops, the three renamed
 * fields, the pollResultSnapshotMessageV3 field number, the unimplemented
 * BotAvatarMetadata — are already tracked by `KNOWN_WIRE_GAPS` and
 * `KNOWN_UNSUPPORTED_CODECS` in `scripts/compatibility/proto-runtime-audit.ts`,
 * and pinned by `scripts/compatibility/__tests__/wire-fidelity.test.ts`. Each
 * such entry says so. That the fuzzers reached them independently, from
 * generated input, is evidence the sweeps work — it is not new information, and
 * recording it as new would misrepresent what this suite found.
 */
/**
 * Whether a finding is about the renamed favicon field, whatever shape it took.
 *
 * Walked rather than serialized: a decoded message carries BigInt for its 64-bit
 * fields, and `JSON.stringify` throws on one — inside `applyAllowlist`, which
 * has no catch, so the run fails with an error about the predicate rather than
 * about the finding.
 */
const mentionsFavicon = (value: unknown, depth = 0): boolean => {
	if (depth > 6) return false
	if (typeof value === 'string') return value.toLowerCase().includes('favicon')
	if (Array.isArray(value)) return value.some(item => mentionsFavicon(item, depth + 1))
	if (value === null || typeof value !== 'object') return false
	for (const [key, item] of Object.entries(value)) {
		if (key.toLowerCase().includes('favicon')) return true
		if (mentionsFavicon(item, depth + 1)) return true
	}
	return false
}

/** Every step of a mutation chain, which `mutate` records as `a → b`. */
const mutatorChain = (input: unknown): readonly string[] => {
	const mutator = (input as { mutator?: unknown } | undefined)?.mutator
	return typeof mutator === 'string' ? mutator.split('\u2192').map(step => step.trim()) : []
}

/** The mutator that shaped the bytes, which is the last one of the chain. */
const lastMutator = (input: unknown): string | undefined => {
	const mutator = (input as { mutator?: unknown } | undefined)?.mutator
	if (typeof mutator !== 'string') return undefined
	const steps = mutator.split('→')
	return steps[steps.length - 1]?.trim()
}

export const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [
	{
		id: 'proto-lying-length-salvage',
		target: 'proto:mutation-agreement',
		status: 'open',
		reason:
			'The `lying-length` mutator rewrites a length prefix so a submessage claims a different extent, and the result still frames as protobuf — so it lands here rather than under mutation-interpretation. Both decoders then salvage the overlapping bytes, and they salvage different things: the bridge reads fields out of the region the prefix now covers that protobufjs steps past, and each side replaces the invalid UTF-8 it meets with its own substitution. No wire this library sends produces those bytes, and neither reading is more correct than the other, since the sender never wrote either value. Open rather than intended because nobody has decided whether the bridge should refuse a submessage whose declared length disagrees with its content, which is the only answer that would make the two agree.',
		review: '2026-11-12',
		when: divergence => lastMutator(divergence.input) === 'lying-length'
	},
	{
		id: 'favicon-mms-metadata-rename',
		// Every proto sweep reaches it: the name differs, so the number is written
		// by one side only, the bytes differ, and a decode reads a different key.
		target: /^proto:/,
		status: 'open',
		reason:
			"WhatsApp renamed `Message.ExtendedTextMessage#33` from `faviconMMSMetadata` to `faviconMmsMetadata` in schema 2.3000.1044659339, which bridge 0.10.0 regenerated against. Field 33 is unchanged, so the wire is identical; only the key differs, and baileys 7.0.0-rc13 still declares the old spelling. Nothing here can reconcile them: accepting the upstream spelling on encode means walking the message tree to find it, on every send, for a link-preview favicon — and the divergence disappears on its own when upstream regenerates its proto. Open rather than intended: the cost of carrying it is a caller who wrote `faviconMMSMetadata` against upstream's declaration and gets no bytes for it, which is worth revisiting if anyone reports it.",
		review: '2026-11-12',
		when: divergence => mentionsFavicon(divergence)
	},
	{
		id: 'to-number-high-word',
		target: 'pure:toNumber',
		status: 'intended',
		reason:
			"Upstream returns `t.low` for a Long without a toNumber method, silently dropping the high word and truncating any value past 2^32 (a millisecond timestamp, for one). baileyrs reconstructs `high * 2^32 + (low >>> 0)`, which is documented at the call site. Upstream also returns its argument unchanged for a non-Long, non-number input, where baileyrs returns 0 to honour its `number` return type. And on a falsy *number* the two part ways for the same reason: `t || 0` treats it as absent, so upstream answers `+0` where baileyrs hands the argument straight back. `toNumber(-0)` is `-0` here and `+0` upstream, observable through `Object.is` and `1 / result`; `toNumber(NaN)` is `NaN` here and `0` upstream, which is the sharper of the two — a caller's arithmetic error stays visible instead of being silently rounded into a real timestamp. `0` itself agrees, since `+0` is what both return.",
		review: '2027-02-01',
		when: divergence => {
			// `??` only replaces null/undefined, and a corpus entry or a shrunk input
			// need not be an array. Destructuring a plain object here would throw
			// inside applyAllowlist, which has no catch, and fail the run with an
			// error unrelated to the finding.
			if (!Array.isArray(divergence.input)) return false
			const [argument] = divergence.input as unknown[]
			// The outcomes, not just the input shape. Both rules are spelled out and
			// each side is held to its own: matching on "the argument was a Long"
			// alone excused a regression that threw, reconstructed the wrong sign or
			// returned a different constant — on the very inputs the entry is about.
			if (isThrow(divergence.local) || isThrow(divergence.upstream)) return false
			if (typeof argument === 'object' && argument !== null) {
				// With a `toNumber` method both call it, so they agree or both throw.
				// Neither outcome is this entry.
				if ('toNumber' in argument) return false
				const { low, high } = argument as { low?: unknown; high?: unknown }
				// Upstream is `t.low` verbatim, including `undefined` for an object
				// carrying no such property — which is most generated objects.
				if (!sameShape(divergence.upstream, low)) return false
				return typeof low === 'number'
					? Object.is(divergence.local, (typeof high === 'number' ? high : 0) * 0x1_0000_0000 + (low >>> 0))
					: divergence.local === 0
			}
			// `-0` and `NaN` are the numbers the two disagree on, for one reason:
			// upstream's `t || 0` treats every falsy number as absent and hands back
			// `+0`, where baileyrs returns the argument — a `number` in is the one
			// case with nothing to convert. `0` is falsy too and agrees, because `+0`
			// is what it returns anyway. `-0` surfaced once `normalise` stopped
			// folding the sign away under strict comparison; `NaN` only in deep mode,
			// which is the one that draws it.
			if (Object.is(argument, -0)) {
				return Object.is(divergence.local, -0) && Object.is(divergence.upstream, 0)
			}
			// Not `Object.is(local, NaN)` on the upstream side: it returns `+0` here,
			// and holding each side to its own rule is what stops this clause from
			// excusing a run where *both* went to NaN, or where baileyrs started
			// manufacturing a number of its own.
			if (typeof argument === 'number' && Number.isNaN(argument)) {
				return Number.isNaN(divergence.local) && Object.is(divergence.upstream, 0)
			}
			if (typeof argument === 'number') return false
			// Non-object, non-number: upstream is `t || 0`, baileyrs is 0.
			return divergence.local === 0 && sameShape(divergence.upstream, argument || 0)
		}
	},
	{
		id: 'newsletter-encode-lone-surrogate',
		// Two helpers, one encoder behaviour. `generateForwardMessageContent` copies
		// upstream's content through the protobuf codec, so a lone surrogate in any
		// string field comes back as U+FFFD there too — measured, `\ud800` becomes
		// three replacement characters upstream and stays raw in baileyrs, which does
		// not round-trip. The predicate keeps this to inputs that actually carry one.
		//
		// From bridge 0.8.0 the substitution is deliberate rather than incidental:
		// the codec refuses the surrogate outright, and `encodeProtoCompat` puts
		// U+FFFD back so the bytes are the ones this library has always sent.
		// Upstream writes the surrogate raw as WTF-8 (`edbfbf` against this side's
		// `efbfbd`), which is not valid UTF-8 — the difference the entry describes
		// is unchanged, only its cause moved.
		target: /^pure:(encodeNewsletterMessage|generateForwardMessageContent)$/u,
		status: 'open',
		// Scoped to the surrogate, not the whole helper. Without a predicate this
		// excused every return-value difference from the encoder, so a regression
		// that changed ordinary text or dropped a field would have been counted as
		// the known WTF-8 case.
		// The documented substitution, checked as such. `LONE_SURROGATE.test(input)`
		// alone excused every difference on a message that merely contained one, so
		// a regression that changed ordinary text or dropped a field rode along.
		//
		// Two shapes reach here. The encoder returns bytes: the Rust side writes the
		// well-formed `ef bf bd` where protobufjs writes the WTF-8 form, so the
		// local output has to carry the replacement sequence and the upstream one
		// must not. The forwarding helper returns content: substituting U+FFFD for
		// each lone surrogate on the baileyrs side has to close the gap, since the
		// protobuf round trip upstream expands one surrogate into three replacement
		// characters.
		when: divergence => {
			if (!LONE_SURROGATE.test(text(divergence.input))) return false
			if (isThrow(divergence.local) || isThrow(divergence.upstream)) return false
			if (divergence.local instanceof Uint8Array && divergence.upstream instanceof Uint8Array) {
				// Byte-for-byte apart from the substitution itself. Testing only that
				// `ef bf bd` appears on one side and not the other let any other byte
				// difference ride along whenever some field happened to hold a lone
				// surrogate. Both spellings collapse to the same placeholder, and what
				// is left has to be identical.
				const fold = (bytes: Uint8Array) =>
					// Byte pairs, space-separated, so a match can never begin on an odd
					// nibble. Unanchored, `ed[ab][0-9a-f]{3}` matched inside `0edab012`
					// and consumed the low half of one byte plus part of the next —
					// removing bytes that are not substitutions, on one side only, so
					// the two folds no longer cancel and a real byte difference could
					// pass as this entry.
					(Buffer.from(bytes).toString('hex').match(/../gu) ?? [])
						.join(' ')
						// The Rust encoder's U+FFFD, and protobufjs's WTF-8 surrogate,
						// spelled out in full: `ed a0 80` .. `ed bf bf`. The trailing byte
						// is a UTF-8 continuation, so it is `80`..`bf` — not any byte.
						// Leaving it as `[0-9a-f]{2}` folded `ed a0 00`, which is not a
						// surrogate at all, and folding a non-substitution on one side
						// only is exactly what stops the two folds from cancelling.
						.replaceAll(/ef bf bd|ed [ab][0-9a-f] [89ab][0-9a-f]/gu, '<sub>')
				const mine = fold(divergence.local)
				return mine === fold(divergence.upstream) && mine.includes('<sub>')
			}
			// Composed with the sibling copy-strategy entries rather than duplicating
			// them: once the surrogate substitution is undone, what is allowed to
			// remain is the key presence and int64 conversion those entries already
			// document. A changed body still fails all of them.
			return copyStrategyResidue(normalise(divergence.local), normalise(divergence.upstream))
		},
		reason:
			'A string field holding an unpaired UTF-16 surrogate is handled differently on each side. Encoding: protobufjs emits the WTF-8 form (U+DFFF becomes ed bf bf, which is not valid UTF-8) where the Rust encoder substitutes U+FFFD (ef bf bd) — the Rust output is the well-formed one, but the wire bytes differ. Copying: `generateForwardMessageContent` shows the same thing from the other side, because upstream copies content through the protobuf codec and baileyrs does not, so `\ud800` survives in baileyrs and becomes U+FFFD upstream. Needs a maintainer call on whether to match upstream or keep sanitising.',
		review: '2026-11-01'
	},
	{
		id: 'binary-node-messages-tolerates-bad-payload',
		target: 'pure:getBinaryNodeMessages',
		status: 'open',
		// Exactly one side throwing, *and* a stanza that actually carries a payload
		// the reference decoder cannot read back. One-sided-throw alone was not the
		// whole claim: the generator builds `<message>` children carrying real,
		// populated WebMessageInfo bytes in its dominant branch, so a regression
		// that started throwing on a perfectly good stanza satisfied it too.
		//
		// Whether a payload is well-formed cannot be decided here — a truncated
		// WebMessageInfo prefix is still valid protobuf, so a structural parse
		// cannot tell it from a whole one, and this module deliberately depends on
		// nothing but the harness. So the target tags its own input, where both
		// libraries are already imported, and this reads the tag. Measured over 400
		// draws: all 42 one-sided throws carry a malformed payload, none is tagged
		// `well-formed payloads`.
		//
		// If both decoded and disagreed, that is a decode difference on a payload
		// they both accepted, and it still fails.
		when: divergence =>
			isThrow(divergence.local) !== isThrow(divergence.upstream) && hasTag(divergence, 'malformed payload'),
		reason:
			'The two decoders disagree about which malformed `<message>` payloads are readable, in both directions. Upstream throws "illegal buffer" where baileyrs returns an empty message object; and for a truncated length prefix (`2a 16` with no body) baileyrs throws RangeError "premature EOF" where upstream returns `[{ participant: "" }]`. Whichever way round, a corrupt stanza becomes an empty message on one side and an exception on the other, so a caller cannot write one handler that works against both. Needs a maintainer call on which contract the stanza handlers should rely on.',
		review: '2026-11-01'
	},
	{
		id: 'clean-message-empty-jid-normalisation',
		target: /^pure:cleanMessage/u,
		status: 'open',
		// One substitution, checked as such. Without a predicate the pattern excused
		// every difference on every generated message, so altered content or a
		// mis-normalised JID was absorbed — which is exactly what had been hiding
		// the empty-user server difference below.
		when: divergence =>
			!isThrow(divergence.local) &&
			!isThrow(divergence.upstream) &&
			addsOnlyEmptyStrings(normalise(divergence.local), normalise(divergence.upstream)),
		reason:
			'For a message key with no remoteJid/participant, upstream writes the empty string (via jidNormalizedUser(undefined)) while baileyrs writes undefined. Both are falsy and downstream behaviour matches, but the key objects differ for anything that inspects them. Only reachable with a malformed key.',
		review: '2026-11-01'
	},
	{
		id: 'clean-message-empty-user-jid-server',
		target: /^pure:cleanMessage/u,
		status: 'open',
		// Found by narrowing the entry above, which had been excusing every
		// difference on the target and so was covering this one too.
		when: divergence => {
			if (isThrow(divergence.local) || isThrow(divergence.upstream)) return false
			const mine = keyJids(normalise(divergence.local))
			const theirs = keyJids(normalise(divergence.upstream))
			// Same JID fields on both sides. A JID baileyrs writes where upstream
			// writes nothing at all — or the reverse — is not this.
			if (mine.size === 0 || mine.size !== theirs.size) return false
			let rewritten = 0
			for (const [path, jid] of mine) {
				const other = theirs.get(path)
				if (other === undefined) return false
				if (other === jid) continue
				// Differing: both must be the empty-user form this entry is about.
				if (!jid.startsWith('@') || !other.startsWith('@')) return false
				rewritten++
			}
			// At least one, or nothing here is the documented rewrite and whatever
			// else differs is being excused for free.
			if (rewritten === 0) return false
			return addsOnlyEmptyStrings(maskKeyJids(normalise(divergence.local)), maskKeyJids(normalise(divergence.upstream)))
		},
		reason:
			"For a message key whose remoteJid or participant normalises to an empty user, the two write different servers onto the caller's key. Measured directly: `_99:1@hosted` becomes `@hosted` in baileyrs and `@s.whatsapp.net` upstream; `_1@hosted.lid` becomes `@hosted.lid` in baileyrs and `@lid` upstream; `{ key: { participant: '@hosted' } }` shows the same rewrite on the participant field. `jidNormalizedUser` agrees on all of those in isolation, so the difference is in cleanMessage's own re-encoding, and baileyrs is the side that preserves what the server actually sent. A consumer keying chats by remoteJid therefore files these under different chats depending on the library. Only reachable with a JID whose user part is empty.",
		review: '2026-11-01'
	},
	{
		id: 'forward-message-content-copy-shape',
		target: 'pure:generateForwardMessageContent',
		status: 'open',
		// Confined to key presence, in either direction — which is exactly what the
		// two copy strategies differ by. A changed *value*, a dropped body or wrong
		// forwarding metadata is not a subset either way round, and still fails.
		// Keyed on the target's own round-trip check, not on a structural guess.
		// The registry has no protobuf runtime, so it cannot tell a declared field
		// from an undeclared one — and that is the whole difference between an
		// artifact of the copy and a lost message body. The target answers instead:
		// it re-runs upstream's copy over baileyrs' result and tags whether that
		// reproduces upstream's. A structural rule got this wrong in both directions
		// before, first excusing a dropped `extendedTextMessage.text` and then
		// reporting a legitimately dropped undeclared property.
		when: divergence => hasTag(divergence, 'copy strategy'),
		reason:
			"The same root cause as the mutation entry, seen in the return value: upstream copies the content through `proto.Message.decode(proto.Message.encode(content))` while baileyrs shallow-clones with `{ ...content }`. The round trip changes the key set in both directions — it drops properties the schema does not declare, and it materialises empty repeated fields the schema does declare. Measured on `{ extendedTextMessage: {} }`: upstream's result carries `endCardTiles: []`, baileyrs' does not; on `{ extendedTextMessage: { text: 'x', notAField: 1 } }` baileyrs keeps `notAField` and upstream loses it. Schema-valid content with no empty repeated fields agrees exactly, so callers are largely unaffected — but it is a second observable of one defect, and the mutation entry's over-broad target had been excusing it.",
		review: '2026-11-01'
	},
	{
		id: 'forward-message-content-int64-truncation',
		target: 'pure:generateForwardMessageContent',
		status: 'open',
		// A third observable of the copy strategy, on values rather than keys, so it
		// needs its own predicate: the sibling entry above is confined to key
		// presence and a changed value is exactly what it must never excuse.
		//
		// Composed with that entry rather than restating it. One message commonly
		// shows both — the round trip truncates a timestamp *and* drops an empty alt
		// JID — so this masks the truncations and then requires what is left to be
		// the key-presence difference that entry already documents. A changed
		// integer, a changed string or a changed body survives the mask and fails.
		when: divergence => {
			if (isThrow(divergence.local) || isThrow(divergence.upstream)) return false
			if (!carriesInexactInt64(divergence.input)) return false
			const mine = normalise(divergence.local)
			const [masked] = maskInt64Truncations(mine, normalise(divergence.upstream))
			// The mask has to have fired: without this the entry would excuse any
			// pure key-presence difference, which is the sibling entry's job.
			if (text(masked) === text(mine)) return false
			return copyStrategyResidue(mine, normalise(divergence.upstream))
		},
		reason:
			"For a 64-bit integer field holding a number that is not a 64-bit integer, the two copy strategies disagree on the value as well as the key set. Upstream's `proto.Message.decode(proto.Message.encode(content))` converts through Long, so `senderTimestampMs: 1.5` comes back as 1, `-1.5` as -1, and `NaN`, `Infinity` and `1e300` all as 0; baileyrs shallow-clones and hands back the float it was given. Measured on `pollUpdateMessage.senderTimestampMs`. Safe integers, numeric strings, `null` and `undefined` agree exactly on both sides, so only a caller passing a fractional or non-finite timestamp is affected — but the two then forward different values, and the same conversion applies to every int64 field in the schema.",
		review: '2026-11-01'
	},
	{
		id: 'newsletter-encode-rejects-inexact-int64',
		target: 'pure:encodeNewsletterMessage',
		status: 'open',
		// The rejecting side, one of the two rejection messages, *and* an input that
		// actually carries such a number. The error text alone would let a
		// regression that started throwing the same error on an ordinary integer be
		// excused as this; `carriesInexactInt64` is what stops that.
		//
		// Two messages, because the bridge rejects in two places: the BigInt
		// conversion catches a non-integer or non-finite value, and its own range
		// check catches an integer-valued double outside int64. Both are "a number
		// an int64 cannot carry", so both belong here; a *third* message would not
		// be covered and would surface, which is the intent.
		when: divergence =>
			isThrow(divergence.local) &&
			!isThrow(divergence.upstream) &&
			/cannot be converted to a BigInt|invalid int64/iu.test(text(divergence.local)) &&
			carriesInexactInt64(divergence.input),
		reason:
			'For a 64-bit integer field holding a number that is not a 64-bit integer, the bridge encoder throws where upstream converts and encodes. Two rejections, one cause: `1.5`, `NaN` and `Infinity` fail the BigInt conversion (`RangeError: The number … cannot be converted to a BigInt`), and `1e300`, `2**63` and `1.5625e19` fail the range check (`Error: invalid int64: …`). Upstream accepts every one of them — `1.5` as 1, `NaN`/`Infinity`/`1e300` as 0, and `1.5625e19` as a wrapped value that is not the number it was given. Safe integers, numeric strings, `null` and `undefined` are byte-identical on both sides. Measured on `pollUpdateMessage.senderTimestampMs`. baileyrs is plainly the more correct side here — upstream silently sends a wrong value where baileyrs refuses — but it is caller-visible either way: the same content sends on Baileys and throws on baileyrs. Same shape as the float32 entry, and the pair should be decided together.',
		review: '2026-11-01'
	},
	{
		id: 'event-buffer-merge-precedence',
		target: 'buffer:differential',
		status: 'open',
		// Confined to the fields inside a `contacts.upsert` or `groups.update`
		// release, for the same ids. Everything else in the released sequence has to
		// match, so a lost event, a changed id, or a difference on any other release
		// still fails.
		when: divergence => mergePrecedenceFieldsOnly(divergence.local, divergence.upstream),
		reason:
			"The two buffers consolidate `groups.update` and `contacts.upsert` differently, and on both kinds it is upstream that loses data rather than the two picking different winners. On groups, upstream stores only the *first* update for an id and discards every later one: `src/Utils/event-buffer.ts` merges with `Object.assign(data.groupUpdates[id] || {}, update)` where upstream guards the whole assignment with `if (!data.groupUpdates[id])`, which makes its own merge unreachable. Measured by buffering each pair and flushing: two updates for the same id with subjects 'first' then 'second' release 'second' here and 'first' upstream; and with *disjoint* fields — a subject then an announce — this releases both while upstream releases only the subject and drops the announce outright. On contacts, a `contacts.update` buffered before a `contacts.upsert` for the same id contributes the fields only *it* carried: measured with an update carrying `notify` and a later upsert carrying `name`, this releases both fields and upstream releases only `name`. The two agree on every field both carry — the upsert wins, because it arrived last — so this is an added-field difference and no longer a value one. baileyrs is the accumulating side on both, which is what the surrounding branches do for chats and messages and what 'consolidate' means for a buffer; matching upstream would mean deliberately dropping updates a consumer sent. `chats.update` twice, a `groups.update` whose second event carries nothing but the id, and the four message-level consolidation branches all agree, measured at the same time — the id-only case agreeing because there is no field to merge, which is why the `announce` case above does not. Found only once the buffer generator started drawing ids from a shared pool: before that no two buffered events ever referred to the same entity, so none of this ran.",
		review: '2026-11-01'
	},
	{
		id: 'proto-decode-above-max-safe-integer',
		// Also matched on the wire fuzzer, where the same ceiling stops the library
		// reading back bytes it just sent.
		target: /^(proto|wire):/u,
		status: 'open',
		reason:
			'The bridge decoder throws "Value is larger than Number.MAX_SAFE_INTEGER" (or the MIN_SAFE_INTEGER counterpart) for any 64-bit field outside +/-(2^53-1), where protobufjs decodes it to a Long. The boundary is exact: 9007199254740991 decodes, 9007199254740992 throws. This is not a precision difference — the whole message fails to decode, so a legitimate server payload with a large fileLength or a microsecond timestamp becomes an error rather than a message. The most severe finding in this suite.',
		review: '2026-10-01',
		// The rejecting side, the error, *and* a value that is actually outside the
		// range the reason names. Keyed on the text alone, a decoder that started
		// raising the same error at the wrong threshold — on 9007199254740991, which
		// this entry says decodes, or on an ordinary small integer — was
		// indistinguishable from the documented case, on every proto and wire
		// target. The bridge is the side with the ceiling, so an upstream mention
		// does not qualify either.
		//
		// The magnitude is looked for in the input *or* in what upstream produced,
		// because the targets hand this entry different shapes: the encode-side ones
		// carry the generated message, while decode-parity carries raw bytes — there
		// the offending value appears only in upstream's decoded object, which is
		// still evidence independent of the side that threw.
		when: divergence =>
			text(divergence.local).includes('SAFE_INTEGER') &&
			(carriesBeyondSafeInteger(divergence.input) || carriesBeyondSafeInteger(divergence.upstream))
	},
	{
		id: 'proto-field-renamed-and-dropped',
		// Any proto target: the rename surfaces on the naming sweep, on decode
		// parity, and on round-trip, always as two objects carrying the same value
		// under different keys. The `when` predicate below is what keeps the entry
		// narrow — it names the three fields exactly.
		target: /^proto:/u,
		status: 'open',
		when: divergence => {
			const named = RENAMED_PROTO_FIELDS.some(
				([upstreamName, bridgeName]) =>
					text(divergence.local).includes(bridgeName) && text(divergence.upstream).includes(upstreamName)
			)
			if (!named) return false
			// Naming both spellings is not enough on its own. The rename has to be the
			// *whole* difference: undo it and the two sides must agree, or this finding
			// is carrying a second defect that the entry does not explain.
			//
			// The field-name sweep reports strings rather than objects — the decoded
			// key list against the expected key — and there the name match *is* the
			// finding. But it has to be the whole key list, not a substring of it.
			//
			// `local` is `keys.join(', ')`, so a decoder that materialised *both*
			// spellings reported `deviceAgentID, deviceAgentId` against upstream's
			// `deviceAgentID`, and the substring test above passed on the joined
			// string. That is not this entry's rename — it is a decoder inventing a
			// duplicate property, which the sweep even reports under its own detail
			// ("plus keys upstream never encoded") — and it was being excused.
			//
			// Exact equality on both sides: one declared name in, one renamed key out.
			if (typeof divergence.local !== 'object' || typeof divergence.upstream !== 'object') {
				return (
					divergence.target === 'proto:field-names' &&
					RENAMED_PROTO_FIELDS.some(
						([upstreamName, bridgeName]) => divergence.local === bridgeName && divergence.upstream === upstreamName
					)
				)
			}
			// `sameExceptUnwrittenFields`, not bare `sameShape`: the generative decode
			// targets draw whole messages, so a SyncActionValue carrying a renamed
			// field usually carries `businessBroadcastAssociationAction` as well —
			// which the bridge never writes, and which `proto-field-not-encoded`
			// already documents. Two known gaps in one message explained neither, and
			// the finite sweeps never saw the pair because they vary one field at a
			// time. Composing here is what the buffer entries do, for the same reason.
			// The composition stays exact: only the paths `DECODE_OMITTED_PATHS`
			// enumerates may be absent, only from this side, and any value both
			// sides carry must match.
			// Rooted at the decoded type, so a documented absence is pinned to the
			// message it was measured in rather than to a bare property name.
			const decoded = inputPath(divergence.input)
			if (decoded === undefined) return false
			return sameExceptUnwrittenFields(undoRenames(divergence.local), undoRenames(divergence.upstream), decoded)
		},
		reason:
			'Three fields round-trip under a different property name than upstream declares, and the bridge encoder silently drops the upstream spelling: SyncActionValue.ChatAssignmentAction.deviceAgentID becomes deviceAgentId, SyncActionValue.AgentAction.deviceID becomes deviceId, and Message.MessageHistoryMetadata.oldestMessageTimestamp becomes oldestMessageTimestampInWindow. The property name is the public API — code written against the upstream types reads undefined, and writes are lost with no error at all. On the generative decode targets the rename arrives beside a field the bridge never writes, because one drawn message carries both; that half is NOT_ENCODED_FIELDS and has its own entry, and this predicate composes with it rather than either one covering the pair alone. ALREADY TRACKED: all three renames are in KNOWN_WIRE_GAPS in scripts/compatibility/proto-runtime-audit.ts; the sweep rediscovered them from generated input rather than finding them.',
		review: '2026-10-01'
	},
	{
		id: 'proto-explicit-presence-zero-dropped',
		target: 'proto:presence',
		status: 'open',
		// Named, not target-wide. The sweep's whole point is that it covers every
		// proto3-optional field; an entry matching the target alone would route an
		// eleventh drop into the finding that describes the ten and leave the
		// nightly green on a new regression.
		when: divergence =>
			typeof divergence.input === 'string' &&
			PRESENCE_DROPPED_FIELDS.some(
				field => divergence.input === `${field} = 0` || divergence.input === `${field} = ""`
			),
		reason:
			'An explicit-presence (proto3 optional) field set to its zero value is not encoded by the bridge, where protobufjs writes it. 10 of the 1696 such fields are affected, including mediaKeyDomain on all six media message types (image, video, audio, document, sticker, thumbnail). Explicit presence exists precisely so a zero can be distinguished from unset, so this loses information the schema was written to carry. ALREADY TRACKED: every affected field appears in KNOWN_WIRE_GAPS in scripts/compatibility/proto-runtime-audit.ts. What is new here is only the count and the exhaustive sweep behind it.',
		review: '2026-10-01'
	},
	{
		id: 'proto-field-not-encoded',
		// Both finite sweeps see it: the number sweep as "nothing encoded", the name
		// sweep as "nothing decoded". One absent field, two views of it.
		target: /^proto:field-(names|numbers)$/u,
		status: 'open',
		// Enumerated, not pattern-matched: the value of the sweep is that it covers
		// every non-map field, so a twelfth field joining this list has to fail
		// rather than be absorbed.
		//
		// And the outcome is pinned as well as the field. Each sweep reports several
		// different things — a wrong field number, a rename, a one-sided rejection —
		// so matching on the field name alone would have excused a *renumbering* of
		// any of these eleven, which is a different and worse defect with its own
		// entry.
		when: divergence =>
			(divergence.local === '<nothing encoded>' || divergence.local === '<no keys decoded>') &&
			NOT_ENCODED_FIELDS.some(field => text(divergence.input).includes(field)),
		reason:
			'Upstream encodes these fields and the bridge writes nothing at all for them. Eleven of 2421 non-map fields: mediaKeyDomain on all six media types, MessageHistoryMetadata.oldestMessageTimestamp, PaymentExtendedMetadata.messageParamsJson, SyncActionValue.businessBroadcastAssociationAction, AgentAction.deviceID and ChatAssignmentAction.deviceAgentID. ALREADY TRACKED: every one is in KNOWN_WIRE_GAPS in scripts/compatibility/proto-runtime-audit.ts — the six presence drops and the two renames also have their own entries here, seen from a different angle. The sweep previously skipped the case where only the bridge produced no bytes, so it reported exhaustive coverage of fields it had not checked; this entry is what that skip was hiding.',
		review: '2026-10-01'
	},
	{
		id: 'proto-field-omission',
		target: 'proto:field-omission',
		status: 'open',
		// Named, not target-wide. The structural classifier proves the bridge's bytes
		// are upstream's *minus whole fields*, which rules out a changed value but not
		// a newly dropped one — so a future regression dropping a field nothing else
		// covers counted as another hit of this entry and left the nightly green.
		//
		// Pinning the *message* path was tried and reverted on measurement: one smoke
		// seed named 17, four named 29, and the set kept growing. The omitted *field*
		// is a different question with a different answer — 12 distinct `path#number`
		// pairs, identical across nine seeds and 21,000 generated cases. The
		// encode-bytes target reports them; a finding that omits anything else is not
		// this entry.
		when: divergence => {
			const detail = divergence.detail ?? ''
			const marker = detail.indexOf('omits ')
			// The views that carry no byte-level tag keep the structural bound alone:
			// round-trip and the field sweeps compare decoded objects, where the omitted
			// field numbers are not available. Narrowing those needs the same treatment
			// and is the remaining gap in this entry.
			if (marker < 0) return true
			const listed = detail
				.slice(marker + 'omits '.length)
				.split(/[;\]]/u)[0]!
				.split(',')
			return listed.every(entry => KNOWN_OMITTED_FIELDS.has(entry.trim()))
		},
		reason:
			'Cases where the bridge output is upstream output minus whole fields — an empty nested message, a sub-field of a type it models differently. Classified by structural subset rather than by name, so a *changed* value can never land here: those still fail as encode-bytes or decode-parity. The twelve top-level fields it covers are listed in KNOWN_OMITTED_FIELDS and were measured, not sampled: identical across nine seeds and 21,000 generated cases. Overlaps the presence and unknown-type entries, which are themselves already tracked in KNOWN_WIRE_GAPS.',
		review: '2026-10-01'
	},
	{
		id: 'proto-float32-out-of-range-rejected',
		// The wire fuzzer too, for the same reason `proto-decode-above-max-safe-integer`
		// covers both: the send path encodes through the same bridge, so a float above
		// FLT_MAX makes `relayMessage` throw there exactly as `encodeProto` throws
		// here. It only started surfacing once `wire:upstream-readable` stopped
		// discarding its own relay failures on the assumption that `wire:fidelity`
		// had seen the same input — the two targets draw from different streams.
		target: /^(proto|wire):/u,
		status: 'open',
		reason:
			'For a 32-bit float field given a double above FLT_MAX (3.4028234663852886e38), the bridge throws "invalid float32" and protobufjs encodes it anyway — silently, to Infinity. baileyrs is the stricter and arguably the correct one here, but the difference is caller-visible: the same value sends on Baileys and throws on baileyrs. Exact FLT_MAX itself is accepted by both; an earlier version of this entry claimed otherwise because the generator emitted the rounded literal 3.4028235e38, which is a larger double.',
		review: '2026-11-01',
		// The message, the rejecting side, *and* a value that is actually out of
		// range. The message alone let a regression that started rejecting an
		// in-range 1.5, 0.1 or exact FLT_MAX with the same generic error be
		// classified as this known difference, on every proto target.
		when: divergence => text(divergence.local).includes('invalid float32') && carriesOutOfRangeFloat(divergence.input)
	},
	{
		id: 'proto-concatenated-message-merge',
		target: 'proto:mutation-agreement',
		status: 'intended',
		reason:
			'Protobuf defines concatenation as merging: "for embedded message fields, the parser merges multiple instances of the same field, as if with the Message::MergeFrom method". From bridge 0.8.1 the codec does that — a singular message field read twice merges instead of the second read replacing the first — and protobufjs assigns, dropping everything the earlier instance carried. So on a payload carrying the same message field twice, the bridge returns the merged object and upstream returns only the last one. The same rule applies to repeated fields, which merging concatenates rather than replaces: on a payload carrying three copies of a Message.PollCreationMessage, contextInfo.mentionedJid holds both elements here and only the last one upstream. Measured across six mutated payloads after the 0.8.1 bump: SyncActionValue, MessageContextInfo, Message.ReactionMessage, Message.ExtendedTextMessage and Message.PollCreationMessage, retaining between one and nine fields. This is the one entry in the registry where the *reference* implementation is the non-conforming side, so it is intended rather than open: aligning would mean deliberately dropping fields the wire format says are there.',
		review: '2027-02-01',
		// The mutator as well as the shape. Merge semantics is the justification, and
		// it only applies to a payload that actually carries the message twice —
		// without this, any other mutator that made the bridge invent a field or an
		// array element produced the same retention shape and was filed as the
		// intended concatenation difference. Both reviewers caught it independently.
		//
		// *Contains* concatenate, not ends with it. Both reviewers proposed the last
		// step, and that is too strict: concatenation is what put the message in
		// twice, and a bit flipped afterwards does not undo it. Measured — scoping
		// to the final step left `concatenate → flip-bit` and
		// `concatenate → replace-byte` unexcused, both pure retentions.
		//
		// Retention only, and it has to be the whole difference. Upstream carrying a
		// key the bridge lacks is the bridge losing data — the opposite defect —
		// and any value that differs where both sides hold the key is a misread.
		// Both still fail. Without the `> 0` this would also excuse two identical
		// decodes, which is not a finding at all.
		when: divergence =>
			mutatorChain(divergence.input).includes('concatenate') &&
			(keptFieldsUpstreamDropped(divergence.local, divergence.upstream) ?? 0) > 0
	},
	{
		id: 'proto-decode-invalid-utf8',
		target: 'proto:mutation-agreement',
		status: 'open',
		reason:
			'When a string field carries bytes that are not valid UTF-8, the two decoders produce different strings: the bridge substitutes U+FFFD per undecodable byte, protobufjs runs its own reader and resolves the same bytes into different characters. Both accept the payload, so a peer sending malformed UTF-8 hands the two libraries different text. Same root cause as the lone-surrogate difference on the encode side, and the pair should be decided together.',
		review: '2026-11-01',
		// The substitution has to be the *only* difference. A mutated payload can
		// carry several populated fields, so keying on "a replacement character
		// appears somewhere" let a decoder regression that also dropped or changed
		// another field ride alongside one U+FFFD. Both sides have their
		// undecodable text folded to a single placeholder, and the rest must agree.
		when: divergence => {
			if (!text(divergence.local).includes('\uFFFD')) return false
			return sameShape(maskStrings(normalise(divergence.local)), maskStrings(normalise(divergence.upstream)))
		}
	},
	{
		id: 'proto-malformed-interpretation',
		target: 'proto:mutation-interpretation',
		status: 'intended',
		reason:
			'Bytes that do not frame as protobuf at all — a length prefix longer than the buffer, a varint with no terminator — have no defined meaning, so two decoders that both salvage something from them are not required to salvage the same thing. Payloads that *are* well-formed protobuf are held to strict agreement under proto:mutation-agreement, which is where a real decoder bug would land.',
		review: '2027-02-01'
	},
	{
		id: 'proto-field-number-mismatch',
		// `wire:upstream-readable` specifically, not every wire target. That one
		// compares two decodes of the *same* bytes, which is the only place a field
		// number disagreement can be the cause: `wire:fidelity` compares the bridge
		// against itself and `wire:message-builder` compares objects keyed by name,
		// so a real regression on either would have been excused whenever the
		// generated input happened to carry this field.
		target: /^proto:|^wire:upstream-readable$/u,
		status: 'open',
		reason:
			'Message.pollResultSnapshotMessageV3 is field 115 in the bridge codec and field 114 upstream — the only such disagreement across all 2421 non-map fields. ALREADY TRACKED, and documented in exactly these terms: scripts/compatibility/__tests__/wire-fidelity.test.ts pins it as KNOWN_DIVERGENT and proto-runtime-audit.ts lists it in KNOWN_WIRE_GAPS. The proto:field-numbers sweep exists because it proves the question is answered exhaustively rather than by a hand-kept list — it found this one and nothing else, which is the useful result.',
		review: '2026-10-01',
		// The field numbers, not just the name. Any finding mentioning the field was
		// accepted, so a rejection of it, a corrupted value, or a decode difference
		// with another cause was absorbed by the entry that describes a renumbering.
		// The field numbers where the finding carries them, and the documented
		// outcome where it does not. `proto:field-numbers` reports `field 115`
		// against `field 114`, and requiring that stops a rejection or a corrupted
		// value on the same field being absorbed. The other two views never see a
		// number — the name sweep reports the key list, `wire:upstream-readable`
		// two decodes of the same bytes — so there the claim is that the bridge
		// read nothing where upstream read the field.
		when: divergence => {
			if (!text(divergence.input).includes('pollResultSnapshotMessageV3')) return false
			if (divergence.target === 'proto:field-numbers') {
				return text(divergence.local).includes('115') && text(divergence.upstream).includes('114')
			}
			// The other views never carry a number. The name sweep reports the key list
			// and `proto:decode-parity` two decodes of the same bytes, where the field
			// number disagreement shows as the key being present on exactly one side.
			// Removing it has to close the gap completely.
			if (text(divergence.local).includes('<no keys decoded>')) return true
			if (text(divergence.local).includes('<nothing encoded>')) return true
			// The byte-level targets render the wire as `field:wireType:value`, and
			// the renumbering cannot be pinned from that rendering: the renderer
			// descends into a nested message *by field number*, so upstream's 114 is
			// parsed to `{4:0:0}` where the bridge's 115 stays raw hex — the same
			// bytes spelled two ways, as a direct consequence of the renumbering being
			// excused. Splitting on commas does not work either, since the commas
			// inside a nested group split with it.
			//
			// A comment here used to say pinning this needed the target's own tooling
			// and left it as a bare name match. It now has that: the target deletes
			// the field, re-encodes on both sides, and tags whether the encodings then
			// agree. If they do, the renumbering was the whole difference; a corrupted
			// value or a second changed field survives the deletion and is not tagged.
			if (typeof divergence.local === 'string' && typeof divergence.upstream === 'string') {
				return (
					(divergence.detail ?? '').includes('[renumbering only') ||
					(divergence.detail ?? '').includes('; renumbering only')
				)
			}
			const mine = withoutKey(normalise(divergence.local), 'pollResultSnapshotMessageV3')
			const theirs = withoutKey(normalise(divergence.upstream), 'pollResultSnapshotMessageV3')
			return sameShape(mine, theirs) && !sameShape(normalise(divergence.local), normalise(divergence.upstream))
		}
	},
	{
		id: 'proto-wire-type-mismatch-ignored-upstream',
		target: 'proto:mutation-agreement',
		status: 'intended',
		reason:
			"protobufjs ignores the wire type of a field it recognises; the bridge honours it. Minimal case, verified directly: `0a 02 08 20` against SyncActionValue is field 1 (`optional int64 timestamp`) written as wire type 2, wrapping the legal `08 20`. protobufjs runs its generated `case 1: reader.int64()` regardless of the wire type, reads the length byte as the value, then meets the inner `08 20` at the next tag and overwrites it — so the wrapper is flattened away and it reports `timestamp: 32` at any nesting depth. The bridge sees a varint field arriving as length-delimited, treats it as unknown, and reports `{}`. The spec is on the bridge's side: a wire type that does not match the declared one makes the field unknown, and silently reinterpreting it is how a parser reads a value the sender never wrote. The nesting-bomb mutator reaches this on every path whose field 1 is not a message, which is most of them.",
		review: '2027-02-01',
		when: divergence =>
			// The *last* mutator of the chain, not a substring of it. `mutate`
			// records `nesting-bomb → flip-bit`, and a substring test would excuse
			// whatever the second mutator produced merely because a nesting bomb ran
			// first. Reading the tail keeps that out while still covering
			// `truncate → nesting-bomb`, where the bomb is what shaped the bytes.
			lastMutator(divergence.input) === 'nesting-bomb' &&
			// Narrow to the direction the reason argues: the bridge decoded an empty
			// message, upstream decoded a non-empty one. The reverse, and any
			// disagreement over a field both sides read, is not this and must still
			// be reported. `plainObject` rather than a truthiness check so a `null`
			// or a string from either side falls through instead of being excused.
			plainObject(normalise(divergence.local))?.length === 0 &&
			(plainObject(normalise(divergence.upstream))?.length ?? 0) > 0
	},
	{
		id: 'proto-repeated-scalars-unpacked',
		target: 'proto:field-packing',
		status: 'open',
		reason:
			'Repeated scalar and enum fields are written unpacked by the bridge (08 00 08 01) and packed by protobufjs (0a 02 00 01). proto3 defaults to packed and every decoder must accept both, so no data is lost — but the wire bytes differ for every repeated scalar the library sends, which rules out byte-identical comparison against upstream and is worth a deliberate decision rather than a discovery.',
		review: '2026-11-01'
	},
	{
		id: 'proto-field-order-follows-input-keys',
		target: 'proto:field-order',
		status: 'intended',
		reason:
			'The bridge emits fields in the order the keys appear on the object it was given; protobufjs emits them in schema declaration order. Protobuf explicitly permits any order and requires decoders to accept it, so this is a representation difference with no observable consequence for a conforming peer.',
		review: '2027-02-01'
	},
	{
		id: 'proto-unknown-type-dropped',
		// `decode-parity` as well as the two sweeps. The sweeps reach the type
		// through a field that holds one, where the bridge silently omits it; the
		// generative target hands the type's own bytes to both decoders and the
		// bridge *throws* instead. One missing codec, two ways of meeting it.
		target: /^proto:(unknown-type-dropped|type-coverage|decode-parity)$/u,
		status: 'open',
		when: divergence => {
			if (!namesUnknownCodecType(divergence.input)) return false
			// Naming the type is the whole test on the sweeps, whose classifier has
			// already established the shape. Not on decode-parity, which reports
			// every kind of disagreement: without the outcome pinned, this entry
			// would excuse the bridge returning *wrong data* for a type it does not
			// implement just as readily as refusing to decode it.
			if (divergence.target !== 'proto:decode-parity') return true
			return (
				isThrow(divergence.local) &&
				UNKNOWN_CODEC_TYPES.some(type => divergence.local === `<throw Error: unknown proto type: ${type}>`) &&
				plainObject(divergence.upstream) !== undefined
			)
		},
		reason:
			'The bridge codec does not implement every message type the upstream protos declare (BotAvatarMetadata at the time of writing), and a field holding one is silently omitted rather than reported: MessageContextInfo{botMetadata:{avatarMetadata:{}}} encodes to 3a00 instead of 3a020a00. ALREADY TRACKED: BotAvatarMetadata is in KNOWN_UNSUPPORTED_CODECS and its fields in KNOWN_WIRE_GAPS in scripts/compatibility/proto-runtime-audit.ts. The unknown-type set here is probed at runtime rather than listed, so this entry stops matching by itself once the bridge implements them.',
		review: '2026-10-01'
	},
	{
		id: 'poll-vote-aggregation-order',
		target: 'pure:getAggregateVotesInPollMessage',
		status: 'open',
		// Ordering only. Now that generated votes actually hash to the declared
		// options, an unqualified entry would excuse a voter bucketed under the
		// wrong option, a dropped voter or a renamed option — all of which change
		// the multiset, and none of which this entry has ever claimed.
		when: divergence => samePollAggregate(normalise(divergence.local), normalise(divergence.upstream)),
		reason:
			'The two aggregate the same votes into the same buckets but emit the option/voter entries in a different order — and the ordering is a symptom, not the defect. Both build a map keyed by the option hash and return `Object.values`, but they key the *lookup* differently: this side decodes the selected option with `Buffer.from(optionHash).toString()`, upstream calls `option.toString()` on the value as it stands. For a Buffer those agree. For a plain `Uint8Array` they do not — the array renders as its comma-joined bytes, so `[0x5c]` keys as "92", which JavaScript treats as an array index and hoists to the front of the object. That is the whole of the ordering difference, and the fuzzer\'s minimised reproducer is exactly that byte. This is a divergence of input shape across runtimes, not a defect in upstream: protobufjs decodes a bytes field to a Node `Buffer`, measured, so upstream\'s key matches its own options in its own stack. The bridge decoder here returns a plain `Uint8Array`, also measured — so upstream\'s helper, handed what this runtime produces, matches no declared option at all: every vote lands in an "Unknown" bucket and every real option comes back with no voters. Decoding the bytes rather than stringifying the container is what makes the helper work on both shapes, which is why aligning the order with upstream would be the wrong move here. Pinned in public-helpers-compatibility.test.ts with the Uint8Array shape; restoring upstream\'s key fails it.',
		review: '2026-11-01'
	}
]

const matchesTarget = (entry: KnownDivergence, target: string): boolean =>
	typeof entry.target === 'string' ? entry.target === target : entry.target.test(target)

export interface AllowlistOutcome {
	/** Divergences with no matching entry: these fail the run. */
	readonly unexcused: readonly Divergence[]
	/** Ids that matched at least one divergence. */
	readonly used: readonly string[]
	/** Ids of matched entries still marked `open` — reported on every run. */
	readonly openHits: readonly string[]
	/** Entries whose `review` date has passed. */
	readonly expired: readonly KnownDivergence[]
}

export const applyAllowlist = (
	divergences: readonly Divergence[],
	now: Date,
	registry: readonly KnownDivergence[] = KNOWN_DIVERGENCES
): AllowlistOutcome => {
	const unexcused: Divergence[] = []
	const used = new Set<string>()
	const openHits = new Set<string>()

	for (const divergence of divergences) {
		const entry = registry.find(
			candidate => matchesTarget(candidate, divergence.target) && (candidate.when?.(divergence) ?? true)
		)
		if (entry) {
			used.add(entry.id)
			if (entry.status === 'open') openHits.add(entry.id)
		} else unexcused.push(divergence)
	}

	const today = now.toISOString().slice(0, 10)
	const expired = registry.filter(entry => entry.review < today)

	return { unexcused, used: [...used], openHits: [...openHits], expired }
}

/** Registry ids that matched nothing across a whole run — candidates for deletion. */
export const staleEntries = (
	used: readonly string[],
	registry: readonly KnownDivergence[] = KNOWN_DIVERGENCES
): readonly KnownDivergence[] => registry.filter(entry => !used.includes(entry.id))
