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
			'baileyrs writes `contextInfo.forwardingScore`/`isForwarded` onto the caller\'s own message object; upstream leaves the argument untouched and returns new content. Forwarding a message therefore mutates the original in one library and not the other, which is visible to any caller that forwards a message it still holds a reference to.',
		review: '2026-11-01'
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
