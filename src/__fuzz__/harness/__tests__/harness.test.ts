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
