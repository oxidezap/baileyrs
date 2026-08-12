/**
 * The fuzz harness tests itself.
 *
 * A broken shrinker does not fail loudly — it reports a minimal case that is not
 * minimal, or worse, one that reproduces a different bug than the one found. A
 * non-deterministic PRNG makes every replay hint in a failure report a lie. Both
 * failure modes are silent in the fuzzers themselves, so they are pinned here.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyAllowlist, staleEntries, type Divergence, type KnownDivergence } from '../divergence.ts'
import { corpusSlug } from '../corpus.ts'
import { makeRandom } from '../random.ts'
import { shrink } from '../shrink.ts'
import {
	canonicalWire,
	differsOnlyByPacking,
	isWireSubset,
	sameWireContent,
	sameWireOrdering,
	type SchemaContext
} from '../wire.ts'

describe('fuzz harness — deterministic randomness', () => {
	it('replays an identical stream for an identical seed', () => {
		const draw = () => {
			const random = makeRandom('seed-a')
			return [random.next(), random.int(0, 1000), random.pick([1, 2, 3, 4]), [...random.bytes(8)]]
		}
		assert.deepEqual(draw(), draw())
	})

	it('separates streams by seed and by fork label', () => {
		const a = makeRandom('seed-a')
		const b = makeRandom('seed-b')
		assert.notDeepEqual([a.next(), a.next(), a.next()], [b.next(), b.next(), b.next()])

		const parent = makeRandom('seed-a')
		const left = parent.fork('left')
		const right = parent.fork('right')
		assert.notEqual(left.seed, right.seed)
		assert.notDeepEqual([left.next(), left.next()], [right.next(), right.next()])
	})

	it('keeps every generator inside its declared bounds', () => {
		const random = makeRandom('bounds')
		for (let index = 0; index < 5_000; index++) {
			const value = random.int(-5, 5)
			assert.ok(value >= -5 && value <= 5 && Number.isInteger(value), `int out of range: ${value}`)
			assert.ok(random.below(3) < 3)
			assert.equal(random.below(0), 0)
		}
		assert.equal(random.int(7, 7), 7)
	})

	it('honours relative weights', () => {
		const random = makeRandom('weights')
		let rare = 0
		for (let index = 0; index < 4_000; index++) {
			if (
				random.weighted([
					[1, 'rare'],
					[99, 'common']
				]) === 'rare'
			)
				rare++
		}
		assert.ok(rare > 5 && rare < 200, `expected a roughly 1% tail, saw ${rare}/4000`)
	})

	it('never picks an entry whose weight is not positive', () => {
		const random = makeRandom('zero-weight')
		for (let index = 0; index < 500; index++) {
			assert.equal(
				random.weighted([
					[0, 'never'],
					[1, 'always']
				]),
				'always'
			)
		}
	})
})

describe('fuzz harness — shrinking', () => {
	it('reduces an object to the single field that reproduces', async () => {
		const input = { a: 1, b: 2, culprit: 99, d: 'noise', e: [1, 2, 3], f: { g: true } }
		const minimal = await shrink(input, candidate => (candidate as { culprit?: number }).culprit === 99)
		assert.deepEqual(minimal, { culprit: 99 })
	})

	it('reduces an array to the offending element', async () => {
		const input = [0, 0, 0, 7, 0, 0]
		const minimal = await shrink(input, candidate => candidate.includes(7))
		assert.deepEqual(minimal, [7])
	})

	it('reaches into nested structures', async () => {
		const input = { outer: { noise: 'x'.repeat(64), inner: { keep: 5, drop: 'y' } }, sibling: [1, 2, 3] }
		const minimal = await shrink(input, candidate => {
			const nested = candidate as { outer?: { inner?: { keep?: number } } }
			return nested.outer?.inner?.keep === 5
		})
		assert.deepEqual(minimal, { outer: { inner: { keep: 5 } } })
	})

	it('shrinks strings and byte arrays toward empty', async () => {
		const long = await shrink('abcdefghijklmnop', candidate => candidate.length > 0)
		assert.equal(long.length, 1)

		const bytes = await shrink(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), candidate => candidate.length > 2)
		assert.ok(bytes.length >= 3 && bytes.length < 8, `expected a shorter but still-failing slice, got ${bytes.length}`)
	})

	it('supports async predicates', async () => {
		const minimal = await shrink({ keep: 1, drop: 2 }, async candidate => {
			await Promise.resolve()
			return (candidate as { keep?: number }).keep === 1
		})
		assert.deepEqual(minimal, { keep: 1 })
	})

	it('returns the original when nothing simpler reproduces', async () => {
		const input = { only: 'value' }
		assert.deepEqual(await shrink(input, candidate => JSON.stringify(candidate) === JSON.stringify(input)), input)
	})

	it('treats a predicate that throws as "does not reproduce"', async () => {
		const minimal = await shrink({ a: 1, b: 2 }, candidate => {
			const record = candidate as Record<string, number>
			if (Object.keys(record).length === 0) throw new Error('predicate cannot handle empty')
			return record.a === 1
		})
		assert.deepEqual(minimal, { a: 1 })
	})

	it('stays inside its evaluation budget', async () => {
		let evaluations = 0
		await shrink(
			Array.from({ length: 50 }, (_value, index) => [`k${index}`, index]).reduce<Record<string, number>>(
				(accumulator, [key, value]) => ({ ...accumulator, [String(key)]: Number(value) }),
				{}
			),
			() => {
				evaluations++
				return true
			},
			{ maxEvaluations: 25 }
		)
		assert.ok(evaluations <= 25, `budget ignored: ${evaluations} evaluations`)
	})

	/**
	 * The evaluation count bounds checks, not time.
	 *
	 * A check that reproduces a slow input costs whatever that input costs, so the
	 * deep budget's 1200 evaluations against a one-second reproducer is twenty
	 * minutes of shrinking — past the target's own deadline and long enough to hit
	 * the parent test timeout, which loses the report entirely. That is strictly
	 * worse than reporting a large input, so the clock gets its own bound.
	 */
	it('stops shrinking at its deadline, keeping what it has found', async () => {
		const input: Record<string, unknown> = { culprit: 99 }
		for (let index = 0; index < 40; index++) input[`noise${index}`] = 'x'.repeat(32)
		const slow = async (candidate: unknown) => {
			const until = performance.now() + 20
			while (performance.now() < until) {
				// Busy, not idle: a real reproducer burns CPU inside the check, so a
				// timer-based stall would not exercise the same path.
			}
			return (candidate as { culprit?: number })?.culprit === 99
		}

		const started = performance.now()
		const minimised = (await shrink(input, slow, { maxEvaluations: 1_200, deadline: started + 200 })) as Record<
			string,
			unknown
		>
		const elapsed = performance.now() - started

		// Generous, so a slow machine cannot flake it: the point is that it is
		// bounded at all, against an unbounded run measured at ~900ms.
		assert.ok(elapsed < 2_000, `deadline ignored: shrinking ran for ${Math.round(elapsed)}ms`)
		// And what comes back is a real partial result, not a bail-out: it still
		// reproduces, which is what makes stopping early safe.
		assert.equal(minimised.culprit, 99, 'the partly-minimised input must still reproduce')
	})
})

describe('fuzz harness — known-divergence allowlist', () => {
	const divergence = (target: string, detail?: string): Divergence => ({
		target,
		input: 'in',
		local: 'a',
		upstream: 'b',
		detail
	})

	const future = '2999-01-01'
	const past = '2000-01-01'

	it('excuses only what an entry actually covers', () => {
		const registry: KnownDivergence[] = [
			{ id: 'covered', target: 'jid:one', status: 'intended', reason: 'intended', review: future }
		]
		const outcome = applyAllowlist([divergence('jid:one'), divergence('jid:two')], new Date(), registry)
		assert.deepEqual(
			outcome.unexcused.map(item => item.target),
			['jid:two']
		)
		assert.deepEqual(outcome.used, ['covered'])
	})

	it('matches a family of targets by pattern and narrows with a predicate', () => {
		const registry: KnownDivergence[] = [
			{
				id: 'family',
				target: /^proto:/u,
				status: 'intended',
				reason: 'intended',
				review: future,
				when: item => item.detail === 'presence'
			}
		]
		const outcome = applyAllowlist(
			[divergence('proto:a', 'presence'), divergence('proto:b', 'ordering'), divergence('jid:x', 'presence')],
			new Date(),
			registry
		)
		assert.deepEqual(
			outcome.unexcused.map(item => item.target),
			['proto:b', 'jid:x']
		)
	})

	it('flags entries whose review date has passed', () => {
		const registry: KnownDivergence[] = [
			{ id: 'stale', target: 'jid:one', status: 'intended', reason: 'intended', review: past },
			{ id: 'fresh', target: 'jid:two', status: 'intended', reason: 'intended', review: future }
		]
		const outcome = applyAllowlist([], new Date(), registry)
		assert.deepEqual(
			outcome.expired.map(entry => entry.id),
			['stale']
		)
	})

	it('reports entries that excused nothing', () => {
		const registry: KnownDivergence[] = [
			{ id: 'used', target: 'jid:one', status: 'intended', reason: 'intended', review: future },
			{ id: 'unused', target: 'jid:nine', status: 'open', reason: 'intended', review: future }
		]
		const outcome = applyAllowlist([divergence('jid:one')], new Date(), registry)
		assert.deepEqual(
			staleEntries(outcome.used, registry).map(entry => entry.id),
			['unused']
		)
	})

	it('separates entries that are still open from the ones that are intended', () => {
		const registry: KnownDivergence[] = [
			{ id: 'deliberate', target: 'jid:one', status: 'intended', reason: 'on purpose', review: future },
			{ id: 'untriaged', target: 'jid:two', status: 'open', reason: 'still a bug', review: future }
		]
		const outcome = applyAllowlist([divergence('jid:one'), divergence('jid:two')], new Date(), registry)
		assert.deepEqual(outcome.unexcused, [], 'both are excused so the run stays green')
		assert.deepEqual(outcome.openHits, ['untriaged'], 'but the open one is surfaced on every run')
	})

	// The cleanMessage entry is the one with the most reach: it matches a family
	// of targets and its predicate walks the whole argument tuple. It was widened
	// from `remoteJid` to `participant` after the fuzzer found the same rewrite on
	// the second field, and a widening is exactly the change that quietly starts
	// excusing things it should not — so the near-misses are pinned here.
	// The two int64 entries are the newest and the least settled, and one of them
	// masks values before deferring to a sibling entry — which is the construction
	// most likely to widen quietly. Pinned the same way as the cleanMessage one.
	it('excuses the int64 conversion only where a number an int64 cannot carry is involved', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'forward-message-content-int64-truncation')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excused = (input: unknown, local: unknown, upstream: unknown): boolean =>
			applyAllowlist(
				[{ target: 'pure:generateForwardMessageContent', input, local, upstream }],
				new Date('2026-01-01'),
				registry
			).unexcused.length === 0

		const withTimestamp = (value: unknown) => [
			{ key: {}, message: { pollUpdateMessage: { senderTimestampMs: value } } }
		]

		// The measured shapes: a fraction truncated, and a null defaulted to zero.
		assert.ok(
			excused(
				withTimestamp(-1.5),
				{ pollUpdateMessage: { senderTimestampMs: -1.5 } },
				{
					pollUpdateMessage: { senderTimestampMs: '-1' }
				}
			),
			'the measured truncation is the entry’s subject'
		)
		// And the same message also dropping a key, which is what forced the mask to
		// compose with the key-presence entry rather than demand equal key sets.
		assert.ok(
			excused(
				withTimestamp(-1.5),
				{ pollUpdateMessage: { senderTimestampMs: -1.5, pollCreationMessageKey: { remoteJidAlt: '' } } },
				{ pollUpdateMessage: { senderTimestampMs: '-1', pollCreationMessageKey: {} } }
			),
			'a truncation alongside a dropped key is still the two documented differences'
		)

		// Near-misses.
		assert.ok(
			!excused(
				withTimestamp(7),
				{ pollUpdateMessage: { senderTimestampMs: 7 } },
				{
					pollUpdateMessage: { senderTimestampMs: '8' }
				}
			),
			'a changed integer is a value bug, not a conversion'
		)
		assert.ok(
			!excused(
				withTimestamp(-1.5),
				{ pollUpdateMessage: { senderTimestampMs: -1.5, text: 'hello' } },
				{ pollUpdateMessage: { senderTimestampMs: '-1', text: 'HELLO' } }
			),
			'a changed string must not ride along with the truncation'
		)
		assert.ok(
			!excused(
				withTimestamp(7),
				{ pollUpdateMessage: { senderTimestampMs: 7, extra: 1 } },
				{ pollUpdateMessage: { senderTimestampMs: 7 } }
			),
			'without an inexact number there is nothing for this entry to excuse'
		)
	})

	// The merge-precedence entry pairs observations by position and then checks
	// kind and identity. That is exactly the construction that can quietly start
	// excusing a lost or moved event, so the boundaries are pinned.
	it('excuses the buffer merge precedence only for the two kinds it names', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'event-buffer-merge-precedence')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excused = (local: unknown, upstream: unknown): boolean =>
			applyAllowlist(
				[{ target: 'buffer:differential', input: 'in', local, upstream }],
				new Date('2026-01-01'),
				registry
			).unexcused.length === 0

		const upsert = (name: string) => ({ released: 'contacts.upsert', data: [{ id: 'a@s.whatsapp.net', name }] })
		const group = (subject: string) => ({ released: 'groups.update', data: [{ id: 'g@g.us', subject }] })
		const receipt = { released: 'message-receipt.update', data: [{ key: { id: 'B2' } }] }

		// `subject` on a group is the one field whose *value* the two may disagree
		// on, and only there. A contact's `name` was pinned the same way until the
		// upsert fold was corrected; a value difference on one is a regression of
		// that fix, so this entry must not absorb it.
		assert.ok(excused([group('second')], [group('first')]), 'the pinned field may differ in value')
		assert.ok(!excused([upsert('first')], [upsert('second')]), 'a contact name may not — the two agree on it now')
		// What the contact half of the entry does document: a field only this side kept.
		assert.ok(
			excused(
				[{ released: 'contacts.upsert', data: [{ id: 'a@s.whatsapp.net', name: 'x', notify: 'n' }] }],
				[{ released: 'contacts.upsert', data: [{ id: 'a@s.whatsapp.net', name: 'x' }] }]
			),
			'a field upstream dropped folding an earlier update is what this entry is for'
		)
		// The shape the entry actually documents: upstream lost a field this side kept.
		assert.ok(
			excused(
				[{ released: 'groups.update', data: [{ id: 'g@g.us', subject: 'first', announce: true }] }],
				[{ released: 'groups.update', data: [{ id: 'g@g.us', subject: 'first' }] }]
			),
			'a field upstream dropped on merge is what this entry is for'
		)
		// ...and never the reverse. This side losing a field is a defect, not this entry.
		assert.ok(
			!excused(
				[{ released: 'groups.update', data: [{ id: 'g@g.us', subject: 'first' }] }],
				[{ released: 'groups.update', data: [{ id: 'g@g.us', subject: 'first', announce: true }] }]
			),
			'a field lost on this side is not a merge-precedence difference'
		)
		// A field outside the pinned pair may not differ in value at all.
		assert.ok(
			!excused(
				[{ released: 'groups.update', data: [{ id: 'g@g.us', announce: true }] }],
				[{ released: 'groups.update', data: [{ id: 'g@g.us', announce: false }] }]
			),
			'a wrong value on an unpinned field is reported'
		)
		// This used to be excused, back when the two buffers released kinds in
		// different orders and a sibling entry documented it. `consolidateEvents`
		// now matches upstream's order, so a reordering is a finding again and may
		// not ride along with a field difference.
		assert.ok(
			!excused([upsert('first'), receipt], [receipt, upsert('second')]),
			'a reordering is no longer documented, with or without a field difference'
		)

		// Near-misses.
		assert.ok(!excused([upsert('first'), receipt], [upsert('second')]), 'a dropped event is not this')
		assert.ok(
			!excused(
				[{ released: 'chats.update', data: [{ id: 'a', name: 'first' }] }],
				[{ released: 'chats.update', data: [{ id: 'a', name: 'second' }] }]
			),
			'chats.update was measured to agree, so a difference there is unexplained'
		)
		assert.ok(
			!excused(
				[upsert('same'), group('x')],
				[upsert('same'), { released: 'groups.update', data: [{ id: 'OTHER@g.us', subject: 'x' }] }]
			),
			'a changed id is a different entity, not a merge precedence'
		)
		assert.ok(!excused([upsert('same'), receipt], [receipt, upsert('same')]), 'a pure reordering is a finding')
	})

	// Four separate rules under one id — the dropped high word, the non-Long
	// passthrough, and the two falsy numbers — so each one is held to its own
	// outcome rather than to "the argument had the right shape".
	it('excuses toNumber only where each side did what the entry says it does', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'to-number-high-word')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excused = (input: unknown[], local: unknown, upstream: unknown): boolean =>
			applyAllowlist([{ target: 'pure:toNumber', input, local, upstream }], new Date('2026-01-01'), registry).unexcused
				.length === 0

		// The documented shapes.
		assert.ok(excused([{ low: 5, high: 1 }], 0x1_0000_0005, 5), 'upstream drops the high word')
		assert.ok(excused(['x'], 0, 'x'), 'upstream hands a non-Long straight back')
		assert.ok(excused([-0], -0, 0), 'upstream folds negative zero to +0')
		assert.ok(excused([Number.NaN], Number.NaN, 0), 'upstream folds NaN to +0')

		// ...and each side held to its own rule. A NaN that this side turned into a
		// number, or that upstream propagated, is not what the entry describes.
		assert.ok(!excused([Number.NaN], 0, 0), 'this side manufacturing a value is not this entry')
		assert.ok(!excused([Number.NaN], Number.NaN, Number.NaN), 'both reaching NaN is not a divergence to excuse')
		assert.ok(!excused([Number.NaN], Number.NaN, 1), 'upstream returning anything but +0 is unexplained')
		// A finite number is the case where the two agree, so any difference on one
		// is a regression rather than a documented rule.
		assert.ok(!excused([7], 8, 7), 'a finite number must not differ at all')
	})

	it('excuses the cleanMessage JID rewrite only in the shape it documents', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'clean-message-empty-user-jid-server')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excused = (local: unknown, upstream: unknown): boolean =>
			applyAllowlist(
				[{ target: 'pure:cleanMessage#mutation', input: 'in', local, upstream }],
				new Date('2026-01-01'),
				registry
			).unexcused.length === 0

		// The documented shape, on each field, including the extra `remoteJid: ''`
		// upstream materialises alongside it.
		assert.ok(
			excused(
				[{ key: { participant: '@hosted' } }, '', ''],
				[{ key: { participant: '@s.whatsapp.net', remoteJid: '' } }, '', '']
			),
			'the measured participant rewrite is the entry’s subject'
		)
		assert.ok(
			excused([{ key: { remoteJid: '@hosted.lid' } }], [{ key: { remoteJid: '@lid' } }]),
			'so is the remoteJid rewrite it was originally written for'
		)

		// Near-misses. Each one differs from the shape above by a single property.
		assert.ok(
			!excused([{ key: { participant: 'a@x' } }], [{ key: { participant: 'b@x' } }]),
			'a rewrite between two non-empty users is a different defect'
		)
		assert.ok(
			!excused(
				[{ key: { participant: '@hosted' }, message: { conversation: 'hi' } }],
				[{ key: { participant: '@s.whatsapp.net' }, message: { conversation: 'HI' } }]
			),
			'a changed message body must not ride along with the rewrite'
		)
		assert.ok(
			!excused([{ key: { participant: '@hosted' } }], [{ key: { remoteJid: '@s.whatsapp.net' } }]),
			'the JID has to move in the same field on both sides'
		)
		assert.ok(
			!excused([{ key: { participant: '@hosted', remoteJid: '@hosted' } }], [{ key: { participant: '@hosted' } }]),
			'a JID baileyrs writes and upstream does not is not this entry'
		)
		assert.ok(
			!excused([{ key: { participant: '@hosted' } }], [{ key: { participant: '@hosted' }, extra: 1 }]),
			'without a rewrite there is nothing for this entry to excuse'
		)
	})

	// Two entries reach the generative decode target now, and both had to be
	// pinned there rather than widened: the sweeps report one classified shape,
	// `decode-parity` reports every kind of disagreement there is.
	it('excuses an unimplemented codec on decode parity only when the bridge refused the bytes', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'proto-unknown-type-dropped')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excused = (target: string, input: unknown, local: unknown, upstream: unknown): boolean =>
			applyAllowlist([{ target, input, local, upstream }], new Date('2026-01-01'), registry).unexcused.length === 0

		const parity = 'proto:decode-parity'
		const refusal = '<throw Error: unknown proto type: BotAvatarMetadata>'
		const bytes = { path: 'BotAvatarMetadata', origin: 'js-encoded', bytes: '' }

		assert.ok(excused(parity, bytes, refusal, {}), 'the bridge refusing a type it does not implement')
		// The type is named either way, so only the outcome tells these apart.
		assert.ok(!excused(parity, bytes, { wordCount: 3 }, {}), 'returning data for an unimplemented type is not this')
		assert.ok(!excused(parity, bytes, refusal, refusal), 'both refusing is not a divergence to explain')
		assert.ok(
			!excused(
				parity,
				{ path: 'Message', origin: 'js-encoded', bytes: '' },
				'<throw Error: unknown proto type: Message>',
				{}
			),
			'a refusal naming a type the bridge does implement is unexplained'
		)
		// The sweeps are unchanged: their classifier has already established the
		// shape, so naming the type is the whole test there.
		assert.ok(excused('proto:type-coverage', 'BotAvatarMetadata', 'a', 'b'), 'the sweeps still match by name alone')
	})

	it('composes the field rename with a field the bridge never writes, and nothing else', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'proto-field-renamed-and-dropped')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		// The input is passed whole rather than as a defaulted `path` string: an
		// `undefined` argument would take the default and quietly test the opposite
		// of the no-path case below.
		const excusedWith = (input: unknown, local: unknown, upstream: unknown): boolean =>
			applyAllowlist([{ target: 'proto:decode-parity', input, local, upstream }], new Date('2026-01-01'), registry)
				.unexcused.length === 0
		const excused = (local: unknown, upstream: unknown, path = 'SyncActionValue'): boolean =>
			excusedWith({ path }, local, upstream)

		const renamed = { agentAction: { deviceId: '0n' } }
		const declared = { agentAction: { deviceID: '0n' } }

		assert.ok(excused(renamed, declared), 'the rename alone')
		assert.ok(
			excused(renamed, { ...declared, businessBroadcastAssociationAction: {} }),
			'the rename beside a field the bridge never writes — the shape deep mode draws'
		)
		// The documented absence is rooted at the decoded type, so a finding that
		// names no type cannot reach it. Pinned because the root lookup is the one
		// place a later change could widen every path at once.
		assert.ok(
			!excusedWith({}, renamed, { ...declared, businessBroadcastAssociationAction: {} }),
			'an input carrying no path cannot root a documented absence'
		)
		// A field that is not on the list is a new gap, not this one.
		assert.ok(!excused(renamed, { ...declared, chatLockSettings: {} }), 'an undocumented missing field still fails')
		// A value that differs where both sides have the key is a misread.
		assert.ok(!excused({ agentAction: { deviceId: '1n' } }, declared), 'a changed value is never this entry')
		// And the absence is directional: a key only this side has is invention.
		assert.ok(
			!excused({ ...renamed, businessBroadcastAssociationAction: {} }, declared),
			'a key upstream never produced is a different defect'
		)

		// A renamed field is decoded under another name, not dropped, so its leaf
		// must never license an absence. Here `deviceID` is the real rename and
		// `deviceAgentID` has genuinely gone missing beside it — taking the leaves
		// of the encoder-gap list let the first stand in for the second.
		assert.ok(
			!excused({ ...renamed, chatAssignment: {} }, { ...declared, chatAssignment: { deviceAgentID: '' } }),
			'a valid rename does not license a deviceAgentID that genuinely went missing'
		)
		// And the absence is pinned to where it was measured. `messageParamsJson`
		// is documented unwritten on PaymentExtendedMetadata; the schema declares
		// another on NativeFlowMessage, and a new drop of that one is a finding.
		assert.ok(
			!excused(
				{
					messageHistoryMetadata: { oldestMessageTimestampInWindow: '1n' },
					interactiveMessage: { nativeFlowMessage: {} }
				},
				{
					messageHistoryMetadata: { oldestMessageTimestamp: '1n' },
					interactiveMessage: { nativeFlowMessage: { messageParamsJson: '{}' } }
				},
				'Message'
			),
			'a documented leaf dropped at an undocumented path still fails'
		)
	})

	// The one entry where the reference implementation is the non-conforming side,
	// so its direction is the whole point and is pinned from both ends.
	it('excuses a concatenated merge only when the bridge kept what upstream dropped', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'proto-concatenated-message-merge')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excusedWith = (mutator: string, local: unknown, upstream: unknown): boolean =>
			applyAllowlist(
				[{ target: 'proto:mutation-agreement', input: { mutator }, local, upstream }],
				new Date('2026-01-01'),
				registry
			).unexcused.length === 0
		const excused = (local: unknown, upstream: unknown): boolean => excusedWith('concatenate', local, upstream)

		// The documented shape: the merge kept a field the second copy did not carry.
		assert.ok(excused({ muteAction: { muted: true }, statusPrivacy: { mode: '2' } }, { statusPrivacy: { mode: '2' } }))
		// Nested, since a merge happens at whatever depth the field sits.
		assert.ok(excused({ a: { b: { kept: 1, shared: 2 } } }, { a: { b: { shared: 2 } } }), 'retention nested')

		// The bridge losing a field is the opposite defect and must still be reported.
		assert.ok(!excused({ shared: 2 }, { shared: 2, lost: 1 }), 'a field only upstream produced is not this')
		// A value both sides hold that differs is a misread, whatever else was kept.
		assert.ok(!excused({ kept: 1, shared: 2 }, { shared: 3 }), 'a changed value is never this entry')
		// Two identical decodes are not a finding to excuse.
		assert.ok(!excused({ shared: 2 }, { shared: 2 }), 'nothing kept is nothing to explain')
		// And retention in one branch does not license a loss in another.
		assert.ok(!excused({ a: { kept: 1 }, b: {} }, { a: {}, b: { lost: 1 } }), 'a loss beside a retention still fails')

		// Repeated fields concatenate on merge, so the bridge's array is upstream's
		// with the later copy appended — a prefix, checked as one.
		assert.ok(excused({ ids: ['a', 'a'] }, { ids: ['a'] }), 'an appended repeated element is the same rule')
		assert.ok(!excused({ ids: ['b', 'a'] }, { ids: ['a'] }), 'a changed element is not an append')
		assert.ok(!excused({ ids: ['a'] }, { ids: ['a', 'a'] }), 'the bridge holding fewer elements is a loss')

		// Merge semantics is the justification, so the payload has to actually carry
		// the message twice. The same retention shape from any other mutator is a
		// field the bridge invented, which is a different thing entirely.
		const retained = [{ kept: 1, shared: 2 }, { shared: 2 }] as const
		assert.ok(!excusedWith('flip-bit', ...retained), 'a retention from another mutator is not merge')
		assert.ok(!excusedWith('lying-length', ...retained), 'nor from a lying length')
		// A chain counts wherever the concatenation sits: it is what put the message
		// in twice, and a byte corrupted afterwards does not undo that.
		assert.ok(excusedWith('flip-bit → concatenate', ...retained), 'concatenation last')
		assert.ok(excusedWith('concatenate → flip-bit', ...retained), 'concatenation first')
		assert.ok(excusedWith('concatenate → concatenate', ...retained), 'three copies')
	})

	// The two decoders resolve an undecodable region in opposite directions, and
	// that asymmetry is the only thing separating this entry's salvage from a
	// misread — so it is pinned from both ends, like the merge entry above.
	it('excuses a lying-length salvage only when it is the whole difference', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const registry = KNOWN_DIVERGENCES.filter(entry => entry.id === 'proto-lying-length-salvage')
		assert.equal(registry.length, 1, 'the entry under test is still in the registry')

		const excusedWith = (input: unknown, local: unknown, upstream: unknown): boolean =>
			applyAllowlist([{ target: 'proto:mutation-agreement', input, local, upstream }], new Date('2026-01-01'), registry)
				.unexcused.length === 0
		const salvage = { mutator: 'lying-length', path: 'Message.ImageMessage' }
		const excused = (local: unknown, upstream: unknown): boolean => excusedWith(salvage, local, upstream)

		// The shape measured on the one case in a 10001-run deep sweep: the bridge
		// kept two fields upstream stepped past, and the one shared string differs
		// only where each side rendered bytes it could not decode. protobufjs
		// swallows the ASCII bytes after a lead byte; the bridge substitutes per
		// byte and keeps them — so upstream's ASCII is a subsequence of ours.
		const url = { local: 'A�B�C', upstream: 'A\u{10FFFF}C' }
		assert.ok(excused({ kept: '1', url: url.local }, { url: url.upstream }), 'retention and substitution together')
		assert.ok(excused({ url: url.local }, { url: url.upstream }), 'substitution alone')
		assert.ok(excused({ kept: '1', url: 'A�C' }, { url: 'A�C' }), 'retention alone')

		// Each half of "the difference is the salvage" fails on its own terms.
		assert.ok(!excused({ url: url.local }, { url: url.upstream, lost: 1 }), 'a field only upstream produced')
		assert.ok(!excused({ kept: 1, mode: '2' }, { mode: '3' }), 'a changed scalar beside a retention')
		assert.ok(!excused({ kept: 1, name: 'goodbye' }, { name: 'hello' }), 'a changed ASCII string')
		assert.ok(!excused({ url: 'A�C' }, { url: 'AB\u{10FFFF}C' }), 'ASCII upstream produced that we lack')
		assert.ok(!excused({ url: 'AB�' }, { url: '\u{10FFFF}BA' }), 'the same ASCII in a different order')
		assert.ok(!excused({ kept: 1, s: 'ab' }, { s: 'ba' }), 'a reordered pure-ASCII string is not a substitution')
		assert.ok(!excused({ url: url.local }, { url: url.local }), 'nothing differs at all')

		// The mutator and the path are the premise: this salvage is what a rewritten
		// length prefix does, on the one type the sweep produced it for.
		assert.ok(!excusedWith({ ...salvage, mutator: 'flip-bit' }, { kept: 1, a: 1 }, { a: 1 }), 'another mutator')
		assert.ok(!excusedWith({ ...salvage, path: 'Message.AudioMessage' }, { kept: 1, a: 1 }, { a: 1 }), 'another type')
	})

	it('keeps every shipped registry entry well-formed', async () => {
		const { KNOWN_DIVERGENCES } = await import('../divergence.ts')
		const ids = new Set<string>()
		for (const entry of KNOWN_DIVERGENCES) {
			assert.ok(!ids.has(entry.id), `duplicate known-divergence id: ${entry.id}`)
			ids.add(entry.id)
			assert.ok(entry.reason.length > 20, `known-divergence ${entry.id} needs a reason a reviewer can audit`)
			assert.match(entry.review, /^\d{4}-\d{2}-\d{2}$/u, `known-divergence ${entry.id} needs an ISO review date`)
		}
	})
})

describe('fuzz harness — corpus', () => {
	it('derives a filesystem-safe slug from a target name', () => {
		assert.equal(corpusSlug('proto:Message.roundTrip'), 'proto-message-roundtrip')
		assert.equal(corpusSlug('jid:jidDecode'), 'jid-jiddecode')
		assert.equal(corpusSlug('!!!'), 'unnamed')
	})
})

describe('fuzz harness — protobuf wire canonicaliser', () => {
	/** field, wire type 2, explicit length, payload. */
	const lengthDelimited = (field: number, payload: readonly number[]): Uint8Array =>
		Uint8Array.from([...tag(field, 2), payload.length, ...payload])

	/** field, wire type 0, one varint value already encoded. */
	const varint = (field: number, encoded: readonly number[]): Uint8Array =>
		Uint8Array.from([...tag(field, 0), ...encoded])

	// BigInt, not `field << 3`: the shift overflows int32 near the maximum legal
	// field number, which would make the bounds test check the wrong bytes.
	function tag(field: number, wireType: number): number[] {
		let value = (BigInt(field) << 3n) | BigInt(wireType)
		const bytes: number[] = []
		while (value > 0x7fn) {
			bytes.push(Number((value & 0x7fn) | 0x80n))
			value >>= 7n
		}
		bytes.push(Number(value))
		return bytes
	}

	const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]))

	it('reads a packed run and its unpacked spelling as the same content', () => {
		// field 22, packed [0, 1] against two separate varints.
		const packed = lengthDelimited(22, [0x00, 0x01])
		const loose = concat(varint(22, [0x00]), varint(22, [0x01]))
		assert.equal(differsOnlyByPacking(packed, loose, schemaFor([22])), true)
		assert.equal(differsOnlyByPacking(loose, packed, schemaFor([22])), true)

		// Only for a field the schema declares repeated. Two varint occurrences of a
		// *singular* field are a duplicate-field or wrong-wire-type regression, not
		// a spelling of one repeated field — and this used to be excused, because
		// the schema was consulted only when the loose side held a single value.
		assert.equal(differsOnlyByPacking(packed, loose, schemaFor([])), false)
		// With no schema the two readings are indistinguishable, so it is reported.
		assert.equal(differsOnlyByPacking(packed, loose), false)
	})

	/**
	 * The regression that motivated carrying raw bytes on every field.
	 *
	 * `80 80 40 00` is a packed [1048576, 0], and it is *also* valid as a nested
	 * message (field 131072, wire type 0, value 0). The canonicaliser renders it as
	 * the nested form, so a packing check that unpacked the rendering rather than
	 * the bytes simply failed — and an ordinary two-element repeated field was
	 * reported as a codec mismatch. Six of these surfaced at once in `proto:oneof`
	 * the moment a generator change shifted the random stream, so it stays pinned.
	 */
	it('detects packing even when the packed payload also parses as a nested message', () => {
		const packed = lengthDelimited(22, [0x80, 0x80, 0x40, 0x00])
		assert.match(canonicalWire(packed) ?? '', /\{131072:0:0\}/u, 'the payload should render as a nested message')

		const loose = concat(varint(22, [0x80, 0x80, 0x40]), varint(22, [0x00]))
		assert.equal(differsOnlyByPacking(packed, loose, schemaFor([22])), true)
	})

	/**
	 * Occurrence order is a value, not a spelling.
	 *
	 * The comparator used to build a sorted key per field to decide "these entries
	 * are identical, skip". That made `08 01 08 02` and `08 02 08 01` compare
	 * equal, so the whole message came back as a packing difference and the proto
	 * targets reported clean — even though the two decode to `[1, 2]` and `[2, 1]`
	 * and neither side is a packed run at all.
	 */
	it('does not call a reordered repeated field a packing difference', () => {
		const ascending = concat(varint(22, [0x01]), varint(22, [0x02]))
		const descending = concat(varint(22, [0x02]), varint(22, [0x01]))
		assert.equal(differsOnlyByPacking(ascending, descending, schemaFor([22])), false)
		// Nested one level down, where the recursion does its own comparison.
		assert.equal(differsOnlyByPacking(lengthDelimited(3, [...ascending]), lengthDelimited(3, [...descending])), false)
		// And the genuinely identical pair still short-circuits.
		assert.equal(differsOnlyByPacking(ascending, ascending), true)
	})

	/**
	 * The field-order class excuses a whole target, so it has to be asked the
	 * strict question.
	 *
	 * `sameWireContent` keeps only a varint's decoded value, so field 1 holding 1
	 * written `08 81 00` looks identical to `08 01` — nothing was reordered, yet the
	 * pair canonicalised the same and the encode-bytes target routed it to
	 * `proto:field-order`, whose intended divergence waves it through. A codec that
	 * began emitting non-minimal tag, length or value varints could stay green.
	 */
	it('does not call a re-spelled varint a field-order difference', () => {
		const minimal = concat(varint(1, [0x01]), varint(2, [0x02]))
		const swapped = concat(varint(2, [0x02]), varint(1, [0x01]))
		const respelledValue = concat(varint(1, [0x81, 0x00]), varint(2, [0x02]))
		const respelledTag = concat(Uint8Array.from([0x88, 0x00, 0x01]), varint(2, [0x02]))

		// Reordering is still reordering, on the old question and the new one.
		assert.equal(sameWireContent(minimal, swapped), true)
		assert.equal(sameWireOrdering(minimal, swapped), true)

		// Re-spelling is not, though the old question could not tell.
		assert.equal(sameWireContent(minimal, respelledValue), true)
		assert.equal(sameWireOrdering(minimal, respelledValue), false)
		assert.equal(sameWireContent(minimal, respelledTag), true)
		assert.equal(sameWireOrdering(minimal, respelledTag), false)

		// A submessage whose fields merely moved still reads as ordering: the
		// spelling recurses rather than comparing the parent's payload wholesale.
		const nested = (payload: Uint8Array) => lengthDelimited(3, [...payload])
		assert.equal(sameWireOrdering(nested(minimal), nested(swapped)), true)
		assert.equal(sameWireOrdering(nested(minimal), nested(respelledValue)), false)
	})

	it('reads a packing difference alongside a dropped field as an omission', () => {
		// Same repeated field spelled both ways, and field 2 present on one side only.
		const packed = lengthDelimited(22, [0x80, 0x80, 0x40, 0x00])
		const loose = concat(varint(22, [0x80, 0x80, 0x40]), varint(22, [0x00]))
		assert.equal(isWireSubset(packed, concat(loose, varint(2, [0x09])), schemaFor([22])), true)
	})

	/**
	 * The single-value rule only takes effect with a schema, so without this the
	 * behaviour that decides between "excused packing" and "reported wrong wire
	 * type" — the distinction the schema context exists for — went untested.
	 */
	const schemaFor = (repeated: readonly number[]): SchemaContext => ({
		path: 'Test',
		isRepeated: (_path, field) => repeated.includes(field),
		messageAt: () => undefined
	})

	it('separates a one-element packed run from a wrong wire type using the schema', () => {
		const packed = lengthDelimited(22, [0x07])
		const loose = varint(22, [0x07])
		assert.equal(differsOnlyByPacking(packed, loose, schemaFor([22])), true, 'field 22 is repeated: packing')
		assert.equal(differsOnlyByPacking(packed, loose, schemaFor([])), false, 'field 22 is singular: wrong wire type')
		// Without a schema the pair is ambiguous, so it is reported rather than excused.
		assert.equal(differsOnlyByPacking(packed, loose), false)
	})

	it('parses a length-delimited field as a message only where the schema says so', () => {
		// The payload frames as protobuf but the schema calls field 1 bytes, so
		// reordering the bytes inside it is a changed value, not a field order.
		const a = Uint8Array.from([0x0a, 0x04, 0x08, 0x01, 0x10, 0x02])
		const b = Uint8Array.from([0x0a, 0x04, 0x10, 0x02, 0x08, 0x01])
		const asBytes: SchemaContext = { path: 'Test', isRepeated: () => false, messageAt: () => undefined }
		const asMessage: SchemaContext = { path: 'Test', isRepeated: () => false, messageAt: () => 'Nested' }
		assert.equal(sameWireContent(a, b, asBytes), false)
		assert.equal(sameWireContent(a, b, asMessage), true)
	})

	it('does not call a changed value a packing difference', () => {
		const packed = lengthDelimited(22, [0x00, 0x01])
		assert.equal(differsOnlyByPacking(packed, concat(varint(22, [0x00]), varint(22, [0x02]))), false)
		// A shorter run is data loss, not a spelling difference.
		assert.equal(differsOnlyByPacking(packed, varint(22, [0x00])), false)
	})

	it('rejects a field number past the protobuf maximum', () => {
		// 2^29 is one past the last legal field number, so the payload does not parse.
		assert.equal(canonicalWire(Uint8Array.from([...tag(536_870_912, 0), 0x00])), undefined)
		assert.notEqual(canonicalWire(Uint8Array.from([...tag(536_870_911, 0), 0x00])), undefined)
	})

	/**
	 * The scan reads a field number under either encoder's spelling, which is only
	 * safe while no number is claimed by two different fields.
	 *
	 * True across the schema today — 2422 claims, no collisions — and the thing
	 * that would break it is a schema regeneration, which is exactly the moment
	 * nobody re-reads the comment asserting it. So it is swept rather than
	 * assumed. `factsFor` already degrades a contested number to opaque bytes so a
	 * run cannot misframe silently; this is what says the degradation happened.
	 */
	it('finds no field number claimed by two different fields, anywhere in the schema', async () => {
		const { contestedFieldNumbers } = await import('../schema-context.ts')
		const { PROTO_MESSAGE_SCHEMAS } = await import('../../../WAProto/compatibility-schema.ts')

		const collisions = PROTO_MESSAGE_SCHEMAS.map(([path]) => [path, contestedFieldNumbers(path)] as const).filter(
			([, numbers]) => numbers.length > 0
		)
		assert.deepEqual(
			collisions,
			[],
			`a field number is claimed by two fields, so the scan degraded it to opaque bytes: ${collisions
				.map(([path, numbers]) => `${path} #${numbers.join(', #')}`)
				.join('; ')}`
		)
	})
})
