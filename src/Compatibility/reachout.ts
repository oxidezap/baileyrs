/** Shared mapping for typed reachout pushes and on-demand query responses. */

import { type ReachoutTimelockEnforcementType, type ReachoutTimelockState } from '../Types/Reachout.ts'

/** Wire shape from `xwa2_fetch_account_reachout_timelock`. */
export interface ReachoutTimelockWire {
	is_active?: boolean
	/** Unix seconds as string. `"0"` or absent → cooldown not set. */
	time_enforcement_ends?: string
	enforcement_type?: string
}

/** Locate the timelock object inside an arbitrary payload — the bridge
 *  hands us either the raw `xwa2_…` body (from `fetchReachoutTimelock`)
 *  or a wrapping MEX response (from the push notification). */
export function extractReachoutPayload(value: unknown): ReachoutTimelockWire | null {
	if (!value || typeof value !== 'object') return null
	const v = value as Record<string, unknown>
	for (const key of ['xwa2_fetch_account_reachout_timelock', 'xwa2_notify_account_reachout_timelock']) {
		const nested = v[key]
		if (nested && typeof nested === 'object') return nested as ReachoutTimelockWire
		const data = v['data']
		if (data && typeof data === 'object') {
			const inner = (data as Record<string, unknown>)[key]
			if (inner && typeof inner === 'object') return inner as ReachoutTimelockWire
		}
	}
	// Caller already extracted — treat the value itself as the payload.
	if ('is_active' in v || 'time_enforcement_ends' in v || 'enforcement_type' in v) {
		return v as ReachoutTimelockWire
	}
	return null
}

/** Map wire payload → public state. Returns `null` when the payload is
 *  empty or unparseable so callers can skip the emit. */
export function mapReachoutTimelock(value: unknown): ReachoutTimelockState | null {
	const wire = extractReachoutPayload(value)
	if (!wire) return null
	const state: ReachoutTimelockState = {}
	if (typeof wire.is_active === 'boolean') state.isActive = wire.is_active
	if (typeof wire.time_enforcement_ends === 'string' && /^\d+$/.test(wire.time_enforcement_ends)) {
		const seconds = Number(wire.time_enforcement_ends)
		const date = new Date(seconds * 1000)
		if (seconds > 0 && Number.isFinite(date.getTime())) state.timeEnforcementEnds = date
	}
	if (typeof wire.enforcement_type === 'string' && wire.enforcement_type) {
		state.enforcementType = wire.enforcement_type as ReachoutTimelockEnforcementType
	}
	return state
}
