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
 * The keys of a plain object, or `undefined` for anything else.
 *
 * Predicates that want to say "decoded nothing" have to distinguish an empty
 * message from a `null`, a string or an array — `Object.keys` answers all four
 * and only one of them is the claim being made.
 */
const plainObject = (value: unknown): string[] | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : undefined

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
const differsOnlyByKeyPresence = (left: unknown, right: unknown, depth = 0): boolean => {
	if (depth > 12) return false
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
		return left.every(
			(item, index) => sameShape(item, right[index]) || differsOnlyByKeyPresence(item, right[index], depth + 1)
		)
	}
	if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
		return sameShape(left, right)
	}
	const a = left as Record<string, unknown>
	const b = right as Record<string, unknown>
	for (const key of Object.keys(a)) {
		if (!Object.hasOwn(b, key)) continue
		if (!sameShape(a[key], b[key]) && !differsOnlyByKeyPresence(a[key], b[key], depth + 1)) return false
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
 * Every property an empty object inherits.
 *
 * Enumerated from the prototype itself rather than written out, so the entry that
 * relies on it cannot drift from what the runtime actually inherits.
 */
// Object.prototype only: the adapter table is a plain object literal, so that is
// the whole of its prototype chain. Including Function.prototype names would
// excuse a genuine unrecognised event type called `bind` or `name`.
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype))

/**
 * An unpaired UTF-16 surrogate, which is what the newsletter encoder differs on.
 *
 * Serialised input renders surrogates as `\udXXX` escapes, so the check runs
 * against both the raw character and its escaped form.
 */
const LONE_SURROGATE =
	/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]|\\ud[89ab][0-9a-f]{2}|\\ud[c-f][0-9a-f]{2}/iu

/** The TypeError shapes a missing or short `data` slot produces. */
const MISSING_DATA_THROWS =
	/Cannot read properties of (undefined|null)|is not iterable|Cannot use 'in' operator|is not a function/u

/**
 * True when two observation streams hold the same entries in a different order.
 *
 * Compared as multisets of their serialised form: same events, same payloads,
 * same throws, different sequence.
 */
const isPermutation = (left: unknown, right: unknown): boolean => {
	if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
	const key = (items: unknown[]) =>
		items
			.map(item => text(item))
			.toSorted()
			.join('\u0000')
	return key(left) === key(right) && text(left) !== text(right)
}

const isLongPair = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && 'low' in value && 'high' in value

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
export const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [
	{
		id: 'to-number-high-word',
		target: 'pure:toNumber',
		status: 'intended',
		reason:
			'Upstream returns `t.low` for a Long without a toNumber method, silently dropping the high word and truncating any value past 2^32 (a millisecond timestamp, for one). baileyrs reconstructs `high * 2^32 + (low >>> 0)`, which is documented at the call site. Upstream also returns its argument unchanged for a non-Long, non-number input, where baileyrs returns 0 to honour its `number` return type.',
		review: '2027-02-01',
		when: divergence => {
			// `??` only replaces null/undefined, and a corpus entry or a shrunk input
			// need not be an array. Destructuring a plain object here would throw
			// inside applyAllowlist, which has no catch, and fail the run with an
			// error unrelated to the finding.
			if (!Array.isArray(divergence.input)) return false
			const [argument] = divergence.input as unknown[]
			return isLongPair(argument) || typeof argument !== 'number'
		}
	},
	{
		id: 'newsletter-encode-lone-surrogate',
		// Two helpers, one encoder behaviour. `generateForwardMessageContent` copies
		// upstream's content through the protobuf codec, so a lone surrogate in any
		// string field comes back as U+FFFD there too — measured, `\ud800` becomes
		// three replacement characters upstream and stays raw in baileyrs, which does
		// not round-trip. The predicate keeps this to inputs that actually carry one.
		target: /^pure:(encodeNewsletterMessage|generateForwardMessageContent)$/u,
		status: 'open',
		// Scoped to the surrogate, not the whole helper. Without a predicate this
		// excused every return-value difference from the encoder, so a regression
		// that changed ordinary text or dropped a field would have been counted as
		// the known WTF-8 case.
		when: divergence => LONE_SURROGATE.test(text(divergence.input)),
		reason:
			'A string field holding an unpaired UTF-16 surrogate is handled differently on each side. Encoding: protobufjs emits the WTF-8 form (U+DFFF becomes ed bf bf, which is not valid UTF-8) where the Rust encoder substitutes U+FFFD (ef bf bd) — the Rust output is the well-formed one, but the wire bytes differ. Copying: `generateForwardMessageContent` shows the same thing from the other side, because upstream copies content through the protobuf codec and baileyrs does not, so `\ud800` survives in baileyrs and becomes U+FFFD upstream. Needs a maintainer call on whether to match upstream or keep sanitising.',
		review: '2026-11-01'
	},
	{
		id: 'binary-node-messages-tolerates-bad-payload',
		target: 'pure:getBinaryNodeMessages',
		status: 'open',
		reason:
			'For a `<message>` child whose content is not a decodable WebMessageInfo, upstream throws "illegal buffer" while baileyrs returns an empty message object. Being tolerant means a corrupt stanza turns into an empty message instead of an error the caller can see. Needs a maintainer call on which contract the stanza handlers should rely on.',
		review: '2026-11-01'
	},
	{
		id: 'get-history-msg-throws-instead-of-undefined',
		target: 'pure:getHistoryMsg',
		status: 'open',
		reason:
			'Upstream returns `undefined` when the message carries no history-sync notification; baileyrs throws a Boom 400. Drop-in consumer code written as `const h = getHistoryMsg(msg); if (!h) return` therefore crashes against baileyrs. The fix is a signature change on a published API, so it belongs in its own commit rather than in the change that found it.',
		review: '2026-11-01'
	},
	{
		id: 'clean-message-empty-jid-normalisation',
		target: /^pure:cleanMessage/u,
		status: 'open',
		reason:
			'For a message key with no remoteJid/participant, upstream writes the empty string (via jidNormalizedUser(undefined)) while baileyrs writes undefined. Both are falsy and downstream behaviour matches, but the key objects differ for anything that inspects them. Only reachable with a malformed key.',
		review: '2026-11-01'
	},
	{
		id: 'forward-message-content-mutates-input',
		// The mutation target exactly, not the family: the pattern also matched the
		// base return-value target, so a helper that started returning different
		// forwarded content was excused as the known mutation. Narrowing it revealed
		// the second difference below, which had been hiding there.
		target: 'pure:generateForwardMessageContent#mutation',
		status: 'open',
		reason:
			"baileyrs writes `contextInfo.forwardingScore`/`isForwarded` onto the caller's own message object; upstream leaves the argument untouched and returns new content. Forwarding a message therefore mutates the original in one library and not the other, which is visible to any caller that forwards a message it still holds a reference to. Root cause is the copy: baileyrs shallow-clones with `{ ...content }`, so the nested message object is shared with the caller, where upstream rebuilds it via `proto.Message.decode(proto.Message.encode(content))`.",
		review: '2026-11-01'
	},
	{
		id: 'forward-message-content-copy-shape',
		target: 'pure:generateForwardMessageContent',
		status: 'open',
		// Confined to key presence, in either direction — which is exactly what the
		// two copy strategies differ by. A changed *value*, a dropped body or wrong
		// forwarding metadata is not a subset either way round, and still fails.
		when: divergence => differsOnlyByKeyPresence(normalise(divergence.local), normalise(divergence.upstream)),
		reason:
			"The same root cause as the mutation entry, seen in the return value: upstream copies the content through `proto.Message.decode(proto.Message.encode(content))` while baileyrs shallow-clones with `{ ...content }`. The round trip changes the key set in both directions — it drops properties the schema does not declare, and it materialises empty repeated fields the schema does declare. Measured on `{ extendedTextMessage: {} }`: upstream's result carries `endCardTiles: []`, baileyrs' does not; on `{ extendedTextMessage: { text: 'x', notAField: 1 } }` baileyrs keeps `notAField` and upstream loses it. Schema-valid content with no empty repeated fields agrees exactly, so callers are largely unaffected — but it is a second observable of one defect, and the mutation entry's over-broad target had been excusing it.",
		review: '2026-11-01'
	},
	{
		id: 'bridge-adapter-prototype-chain-lookup',
		target: /^bridge:adapt-(unknown|total)$/u,
		status: 'open',
		reason:
			'The adapter table is a plain object literal indexed by the event type string, so a type of "constructor", "toString" or "valueOf" resolves through Object.prototype: the inherited function is called and its return value is handed on as a canonical event, and "__proto__" resolves to a non-function and throws "adapter is not a function". The type comes from the runtime, which gets it from the server, so an untrusted string is indexing a prototype-bearing lookup table. Both outcomes break the layer\'s stated contract of dropping what it does not recognise. A Map, an Object.create(null) table, or an Object.hasOwn guard fixes it.',
		review: '2026-10-01',
		when: divergence => PROTOTYPE_KEYS.has(String((divergence.input as { type?: unknown })?.type))
	},
	{
		id: 'bridge-adapter-throws-on-missing-data',
		target: /^bridge:adapt-(total|coverage)$/u,
		status: 'open',
		reason:
			'Adapters for declared event types read straight into `data` without checking it is there, so an event that arrives with no data slot — or with a slot missing the field the adapter reads — throws a TypeError instead of returning null. `adapt.ts` documents the opposite ("Result is null on unrecoverable shape mismatch"), and the throw does not stay local: it propagates into the socket event dispatch, which takes out the whole event loop rather than the one event.',
		review: '2026-10-01',
		when: divergence => MISSING_DATA_THROWS.test(text(divergence.local))
	},
	{
		id: 'event-buffer-release-order',
		target: 'buffer:differential',
		status: 'open',
		// Ordering only. Without this predicate the entry would also excuse a
		// corrupted payload, a different consolidation result or a different throw —
		// all of which reach `buffer:differential`, and none of which
		// `buffer:conservation` can see, since it only counts event names.
		when: divergence => isPermutation(divergence.local, divergence.upstream),
		reason:
			"Flushing a buffer that holds several event kinds releases them in a different order than upstream: for the same sequence, baileyrs emitted contacts.upsert before message-receipt.update where upstream emitted them the other way round. No event is lost — buffer:conservation is clean — but a consumer whose handlers assume upstream's ordering (contacts populated before receipts reference them) sees a different interleaving.",
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
		when: divergence => [divergence.local, divergence.upstream].some(side => text(side).includes('SAFE_INTEGER'))
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
			// The field-name sweep reports strings rather than objects (the key list
			// against the expected key), and there the name match is the finding.
			if (typeof divergence.local !== 'object' || typeof divergence.upstream !== 'object') return true
			return sameShape(undoRenames(divergence.local), undoRenames(divergence.upstream))
		},
		reason:
			'Three fields round-trip under a different property name than upstream declares, and the bridge encoder silently drops the upstream spelling: SyncActionValue.ChatAssignmentAction.deviceAgentID becomes deviceAgentId, SyncActionValue.AgentAction.deviceID becomes deviceId, and Message.MessageHistoryMetadata.oldestMessageTimestamp becomes oldestMessageTimestampInWindow. The property name is the public API — code written against the upstream types reads undefined, and writes are lost with no error at all. ALREADY TRACKED: all three are in KNOWN_WIRE_GAPS in scripts/compatibility/proto-runtime-audit.ts; the sweep rediscovered them from generated input rather than finding them.',
		review: '2026-10-01'
	},
	{
		id: 'proto-explicit-presence-zero-dropped',
		target: 'proto:presence',
		status: 'open',
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
		reason:
			'Cases where the bridge output is upstream output minus whole fields — an empty nested message, a sub-field of a type it models differently. Classified by structural subset rather than by name, so a *changed* value can never land here: those still fail as encode-bytes or decode-parity. Overlaps the presence and unknown-type entries, which are themselves already tracked in KNOWN_WIRE_GAPS; kept separate because the classifier cannot attribute a cause, only a shape.',
		review: '2026-10-01'
	},
	{
		id: 'proto-float32-out-of-range-rejected',
		target: /^proto:/u,
		status: 'open',
		reason:
			'For a 32-bit float field given a double above FLT_MAX (3.4028234663852886e38), the bridge throws "invalid float32" and protobufjs encodes it anyway — silently, to Infinity. baileyrs is the stricter and arguably the correct one here, but the difference is caller-visible: the same value sends on Baileys and throws on baileyrs. Exact FLT_MAX itself is accepted by both; an earlier version of this entry claimed otherwise because the generator emitted the rounded literal 3.4028235e38, which is a larger double.',
		review: '2026-11-01',
		// Keyed on the message *and* on the bridge being the rejecting side, so a
		// rejection of an in-range float stays visible.
		when: divergence => text(divergence.local).includes('invalid float32')
	},
	{
		id: 'proto-decode-invalid-utf8',
		target: 'proto:mutation-agreement',
		status: 'open',
		reason:
			'When a string field carries bytes that are not valid UTF-8, the two decoders produce different strings: the bridge substitutes U+FFFD per undecodable byte, protobufjs runs its own reader and resolves the same bytes into different characters. Both accept the payload, so a peer sending malformed UTF-8 hands the two libraries different text. Same root cause as the lone-surrogate difference on the encode side, and the pair should be decided together.',
		review: '2026-11-01',
		when: divergence => text(divergence.local).includes('\uFFFD')
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
		when: divergence => text(divergence.input).includes('pollResultSnapshotMessageV3')
	},
	{
		id: 'proto-wire-type-mismatch-ignored-upstream',
		target: 'proto:mutation-agreement',
		status: 'intended',
		reason:
			"protobufjs ignores the wire type of a field it recognises; the bridge honours it. Minimal case, verified directly: `0a 02 08 20` against SyncActionValue is field 1 (`optional int64 timestamp`) written as wire type 2, wrapping the legal `08 20`. protobufjs runs its generated `case 1: reader.int64()` regardless of the wire type, reads the length byte as the value, then meets the inner `08 20` at the next tag and overwrites it — so the wrapper is flattened away and it reports `timestamp: 32` at any nesting depth. The bridge sees a varint field arriving as length-delimited, treats it as unknown, and reports `{}`. The spec is on the bridge's side: a wire type that does not match the declared one makes the field unknown, and silently reinterpreting it is how a parser reads a value the sender never wrote. The nesting-bomb mutator reaches this on every path whose field 1 is not a message, which is most of them.",
		review: '2027-02-01',
		when: divergence =>
			text(divergence.input).includes('nesting-bomb') &&
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
		target: /^proto:(unknown-type-dropped|type-coverage)$/u,
		status: 'open',
		reason:
			'The bridge codec does not implement every message type the upstream protos declare (BotAvatarMetadata at the time of writing), and a field holding one is silently omitted rather than reported: MessageContextInfo{botMetadata:{avatarMetadata:{}}} encodes to 3a00 instead of 3a020a00. ALREADY TRACKED: BotAvatarMetadata is in KNOWN_UNSUPPORTED_CODECS and its fields in KNOWN_WIRE_GAPS in scripts/compatibility/proto-runtime-audit.ts. The unknown-type set here is probed at runtime rather than listed, so this entry stops matching by itself once the bridge implements them.',
		review: '2026-10-01'
	},
	{
		id: 'proto-empty-string-for-numeric-field',
		target: /^proto:/u,
		status: 'open',
		reason:
			'Given an empty string where the schema declares a 64-bit integer, the bridge coerces to 0 and protobufjs throws "empty string" — it routes 64-bit fields through Long.fromString, which rejects it. 32-bit fields are not affected: both sides coerce to 0 there, which is why the generator seeds the empty string into the 64-bit pools only. Same shape as the toNumber difference: baileyrs is the tolerant one. Tolerant is defensible, but it means a caller\'s type error is silently encoded as a real value instead of surfacing.',
		review: '2026-11-01',
		when: divergence => text(divergence.upstream).includes('empty string')
	},
	{
		id: 'poll-vote-aggregation-order',
		target: 'pure:getAggregateVotesInPollMessage',
		status: 'open',
		reason:
			'The two aggregate the same votes into the same buckets but emit the option/voter entries in a different order. Consumers that index into the returned array rather than looking options up by name see different results.',
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
