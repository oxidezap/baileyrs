/**
 * Pin down the reachout-timelock wire→public mapping. The same helper
 * runs for both the push notification path and the on-demand fetch, so
 * one failing fixture flags either source.
 */

import { describe, test } from 'node:test'
import { ReachoutTimelockEnforcementType } from '../Types/index.ts'
import { extractReachoutPayload, mapReachoutTimelock } from '../Socket/reachout.ts'
import { expect } from './expect.ts'

describe('reachout-timelock mapping', () => {
	test('maps active timelock with future enforcement window', () => {
		// 2026-12-31 00:00:00 UTC = 1798675200 unix seconds.
		const out = mapReachoutTimelock({
			is_active: true,
			time_enforcement_ends: '1798675200',
			enforcement_type: ReachoutTimelockEnforcementType.BIZ_COMMERCE_VIOLATION_ALCOHOL
		})
		expect(out).toBeDefined()
		expect(out!.isActive).toBe(true)
		expect(out!.enforcementType).toBe(ReachoutTimelockEnforcementType.BIZ_COMMERCE_VIOLATION_ALCOHOL)
		expect(out!.timeEnforcementEnds!.getTime()).toBe(1798675200 * 1000)
	})

	test('maps inactive timelock (no enforcement_ends)', () => {
		const out = mapReachoutTimelock({ is_active: false })
		expect(out).toBeDefined()
		expect(out!.isActive).toBe(false)
		expect(out!.timeEnforcementEnds).toBeUndefined()
		expect(out!.enforcementType).toBeUndefined()
	})

	test('treats `time_enforcement_ends="0"` as no enforcement window', () => {
		const out = mapReachoutTimelock({ is_active: false, time_enforcement_ends: '0' })
		expect(out!.timeEnforcementEnds).toBeUndefined()
	})

	test('extracts payload from a full MEX response (`{data: {xwa2_…: {…}}}`)', () => {
		const wrapped = {
			data: {
				xwa2_fetch_account_reachout_timelock: {
					is_active: true,
					time_enforcement_ends: '1798675200',
					enforcement_type: 'DEFAULT'
				}
			}
		}
		const inner = extractReachoutPayload(wrapped)
		expect(inner).toBeDefined()
		expect(inner!.is_active).toBe(true)
		const out = mapReachoutTimelock(wrapped)
		expect(out!.enforcementType).toBe(ReachoutTimelockEnforcementType.DEFAULT)
	})

	test('extracts payload from the bridge `xwa2_…` body alone', () => {
		const direct = { xwa2_fetch_account_reachout_timelock: { is_active: true } }
		const inner = extractReachoutPayload(direct)
		expect(inner).toBeDefined()
		expect(inner!.is_active).toBe(true)
	})

	test('returns null on completely unrelated payload', () => {
		expect(mapReachoutTimelock({ unrelated: 'shape' })).toBe(null)
		expect(mapReachoutTimelock(null)).toBe(null)
		expect(mapReachoutTimelock(undefined)).toBe(null)
		expect(mapReachoutTimelock('string')).toBe(null)
	})

	test('rejects malformed `time_enforcement_ends` (non-numeric, negative)', () => {
		expect(mapReachoutTimelock({ is_active: true, time_enforcement_ends: 'abc' })!.timeEnforcementEnds).toBeUndefined()
		expect(mapReachoutTimelock({ is_active: true, time_enforcement_ends: '-1' })!.timeEnforcementEnds).toBeUndefined()
	})
})

describe('bridge 0.25 reachout state', () => {
	test('recognizes the reported notification envelope and preserves unknown enforcement names', () => {
		const state = mapReachoutTimelock({
			data: {
				xwa2_notify_account_reachout_timelock: {
					enforcement_type: 'RESTRICT_ALL_COMPANIONS',
					is_active: true,
					time_enforcement_ends: '1790761645'
				}
			}
		})
		expect(state).toEqual({
			isActive: true,
			enforcementType: 'RESTRICT_ALL_COMPANIONS',
			timeEnforcementEnds: new Date(1790761645000)
		})
	})
	test('absence and null do not assert that a restriction was lifted', () => {
		for (const is_active of [undefined, null, 'false', 0]) {
			const state = mapReachoutTimelock({ is_active, enforcement_type: 'FUTURE_MODE' })
			expect(state).toEqual({ enforcementType: 'FUTURE_MODE' })
		}
	})
	test('rejects partial numbers and dates outside the Date range', () => {
		for (const time_enforcement_ends of ['1790761645garbage', '1e3', '999999999999999999']) {
			expect(mapReachoutTimelock({ is_active: true, time_enforcement_ends })).toEqual({ isActive: true })
		}
	})
})
