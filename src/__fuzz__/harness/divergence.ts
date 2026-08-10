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
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set([
	...Object.getOwnPropertyNames(Object.prototype),
	...Object.getOwnPropertyNames(Function.prototype)
])

/** The TypeError shapes a missing or short `data` slot produces. */
const MISSING_DATA_THROWS =
	/Cannot read properties of (undefined|null)|is not iterable|Cannot use 'in' operator|is not a function/u

const isLongPair = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && 'low' in value && 'high' in value

/**
 * The registry.
 *
 * Every entry below was produced by the first run of these fuzzers, not by
 * guesswork — each one has a minimised reproducer committed under
 * `src/__fuzz__/corpus/`, so the claim can be checked in seconds.
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
			const [argument] = (divergence.input as unknown[]) ?? []
			return isLongPair(argument) || typeof argument !== 'number'
		}
	},
	{
		id: 'newsletter-encode-lone-surrogate',
		target: 'pure:encodeNewsletterMessage',
		status: 'open',
		reason:
			'A string field holding an unpaired UTF-16 surrogate encodes to different bytes: protobufjs emits the WTF-8 form (U+DFFF becomes ed bf bf, which is not valid UTF-8), the Rust encoder substitutes U+FFFD (ef bf bd). The Rust output is the well-formed one, but the wire bytes differ, so a message whose text carries a lone surrogate is not byte-identical across the two libraries. Needs a maintainer call on whether to match upstream or keep sanitising.',
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
		target: /^pure:generateForwardMessageContent/u,
		status: 'open',
		reason:
			"baileyrs writes `contextInfo.forwardingScore`/`isForwarded` onto the caller's own message object; upstream leaves the argument untouched and returns new content. Forwarding a message therefore mutates the original in one library and not the other, which is visible to any caller that forwards a message it still holds a reference to.",
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
		// Also matches on the decode side, where the rename surfaces as two objects
		// carrying the same value under different keys.
		target: /^proto:(field-names|decode-parity)$/u,
		status: 'open',
		when: divergence =>
			RENAMED_PROTO_FIELDS.some(
				([upstreamName, bridgeName]) =>
					text(divergence.local).includes(bridgeName) && text(divergence.upstream).includes(upstreamName)
			),
		reason:
			'Three fields round-trip under a different property name than upstream declares, and the bridge encoder silently drops the upstream spelling: SyncActionValue.ChatAssignmentAction.deviceAgentID becomes deviceAgentId, SyncActionValue.AgentAction.deviceID becomes deviceId, and Message.MessageHistoryMetadata.oldestMessageTimestamp becomes oldestMessageTimestampInWindow. The property name is the public API — code written against the upstream types reads undefined, and writes are lost with no error at all.',
		review: '2026-10-01'
	},
	{
		id: 'proto-explicit-presence-zero-dropped',
		target: 'proto:presence',
		status: 'open',
		reason:
			'An explicit-presence (proto3 optional) field set to its zero value is not encoded by the bridge, where protobufjs writes it. 10 of the 1696 such fields are affected, including mediaKeyDomain on all six media message types (image, video, audio, document, sticker, thumbnail). Explicit presence exists precisely so a zero can be distinguished from unset, so this loses information the schema was written to carry.',
		review: '2026-10-01'
	},
	{
		id: 'proto-field-omission',
		target: 'proto:field-omission',
		status: 'open',
		reason:
			'Cases where the bridge output is upstream output minus whole fields — an empty nested message, a sub-field of a type it models differently. Classified by structural subset rather than by name, so a *changed* value can never land here: those still fail as encode-bytes or decode-parity. Almost certainly the same root cause as the presence and unknown-type entries; kept separate until someone confirms that.',
		review: '2026-10-01'
	},
	{
		id: 'proto-float32-max-rejected',
		target: /^proto:/u,
		status: 'open',
		reason:
			'The bridge rejects 3.4028235e+38 with "invalid float32" — that value is FLT_MAX, the largest finite float32 there is, and protobufjs encodes it without complaint. A legitimate value at the top of the declared range cannot be sent.',
		review: '2026-11-01',
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
			'The bridge codec does not implement every message type the upstream protos declare (BotAvatarMetadata at the time of writing), and a field holding one is silently omitted rather than reported: MessageContextInfo{botMetadata:{avatarMetadata:{}}} encodes to 3a00 instead of 3a020a00. Silent omission is the problem more than the gap — a missing type should be visible. The unknown-type set is probed at runtime, so this entry stops matching by itself once the bridge implements them.',
		review: '2026-10-01'
	},
	{
		id: 'proto-empty-string-for-numeric-field',
		target: /^proto:/u,
		status: 'open',
		reason:
			'Given an empty string where the schema declares an integer, the bridge coerces to 0 and protobufjs throws "empty string". Same shape as the toNumber difference: baileyrs is the tolerant one. Tolerant is defensible, but it means a caller\'s type error is silently encoded as a real value instead of surfacing.',
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
