/**
 * Coverage ledger enforcement.
 *
 * This is the piece that makes the fuzz suite grow by itself. It enumerates every
 * function baileyrs and Baileys both export and fails when one of them is neither
 * fuzzed nor explicitly excused. Adding a helper to the public surface therefore
 * turns the pull request red until somebody decides which it is — instead of the
 * suite quietly covering a shrinking fraction of the API as it grows.
 *
 * It also fails on excuses for exports that no longer exist, so the ledger cannot
 * accumulate entries nobody can trace back to anything.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EXCLUDED_EXPORTS, PURE_TARGET_NAMES } from './targets.ts'

const upstream = (await import('baileys')) as unknown as Record<string, unknown>
const local = (await import('../index.ts')) as unknown as Record<string, unknown>

const sharedFunctionExports = Object.keys(upstream)
	.filter(name => typeof upstream[name] === 'function' && typeof local[name] === 'function')
	.toSorted()

describe('fuzz coverage ledger', () => {
	it('finds a meaningful shared surface at all', () => {
		// A guard on the guard: if the import shape ever changes, this test must not
		// pass by comparing two empty sets.
		assert.ok(
			sharedFunctionExports.length > 100,
			`expected a large shared export surface, found ${sharedFunctionExports.length}`
		)
	})

	it('accounts for every shared function export', () => {
		const covered = new Set(PURE_TARGET_NAMES)
		const excused = new Set(Object.keys(EXCLUDED_EXPORTS))
		const unaccounted = sharedFunctionExports.filter(name => !covered.has(name) && !excused.has(name))

		assert.deepEqual(
			unaccounted,
			[],
			[
				`${unaccounted.length} shared export(s) are neither fuzzed nor excused:`,
				...unaccounted.map(name => `  - ${name}`),
				'',
				'Add each to PURE_TARGET_NAMES (with a generator in pure-differential.fuzz.test.ts)',
				'or to EXCLUDED_EXPORTS in src/__fuzz__/targets.ts with the reason it cannot be fuzzed.'
			].join('\n')
		)
	})

	it('keeps no ledger entry for an export that is gone', () => {
		const shared = new Set(sharedFunctionExports)
		const stale = [...PURE_TARGET_NAMES, ...Object.keys(EXCLUDED_EXPORTS)].filter(name => !shared.has(name))
		assert.deepEqual(stale, [], `ledger entries with no matching shared export: ${stale.join(', ')}`)
	})

	it('never lists an export as both fuzzed and excused', () => {
		const excused = new Set(Object.keys(EXCLUDED_EXPORTS))
		const both = PURE_TARGET_NAMES.filter(name => excused.has(name))
		assert.deepEqual(both, [], `listed twice: ${both.join(', ')}`)
	})

	it('gives every exclusion a reason worth reading', () => {
		for (const [name, reason] of Object.entries(EXCLUDED_EXPORTS)) {
			assert.ok(reason.length > 10, `exclusion for ${name} needs a real reason, got ${JSON.stringify(reason)}`)
		}
	})
})
