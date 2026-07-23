import type { ReachoutTimelockEnforcementType as ReachoutTimelockEnforcementTypeType } from '../Compatibility/public-api/enum-types.ts'

/**
 * Reachout-timelock types — matches the API shape from
 * `WhiskeySockets/Baileys#2442` so middleware that targets either lib
 * (e.g. baileys-antiban) sees the same contract.
 *
 * The server emits a per-account cooldown on outbound messaging to NEW
 * contacts. The same `ReachoutTimelockState` is delivered both via the
 * `NotificationUserReachoutTimelockUpdate` push notification and via the
 * on-demand `fetchReachoutTimelock()` call.
 */

export const ReachoutTimelockEnforcementType = Object.freeze({
	BIZ_COMMERCE_VIOLATION_ALCOHOL: 'BIZ_COMMERCE_VIOLATION_ALCOHOL',
	BIZ_COMMERCE_VIOLATION_ADULT: 'BIZ_COMMERCE_VIOLATION_ADULT',
	BIZ_COMMERCE_VIOLATION_ANIMALS: 'BIZ_COMMERCE_VIOLATION_ANIMALS',
	BIZ_COMMERCE_VIOLATION_BODY_PARTS_FLUIDS: 'BIZ_COMMERCE_VIOLATION_BODY_PARTS_FLUIDS',
	BIZ_COMMERCE_VIOLATION_DATING: 'BIZ_COMMERCE_VIOLATION_DATING',
	BIZ_COMMERCE_VIOLATION_DIGITAL_SERVICES_PRODUCTS: 'BIZ_COMMERCE_VIOLATION_DIGITAL_SERVICES_PRODUCTS',
	BIZ_COMMERCE_VIOLATION_DRUGS: 'BIZ_COMMERCE_VIOLATION_DRUGS',
	BIZ_COMMERCE_VIOLATION_DRUGS_ONLY_OTC: 'BIZ_COMMERCE_VIOLATION_DRUGS_ONLY_OTC',
	BIZ_COMMERCE_VIOLATION_GAMBLING: 'BIZ_COMMERCE_VIOLATION_GAMBLING',
	BIZ_COMMERCE_VIOLATION_HEALTHCARE: 'BIZ_COMMERCE_VIOLATION_HEALTHCARE',
	BIZ_COMMERCE_VIOLATION_REAL_FAKE_CURRENCY: 'BIZ_COMMERCE_VIOLATION_REAL_FAKE_CURRENCY',
	BIZ_COMMERCE_VIOLATION_SUPPLEMENTS: 'BIZ_COMMERCE_VIOLATION_SUPPLEMENTS',
	BIZ_COMMERCE_VIOLATION_TOBACCO: 'BIZ_COMMERCE_VIOLATION_TOBACCO',
	BIZ_COMMERCE_VIOLATION_VIOLENT_CONTENT: 'BIZ_COMMERCE_VIOLATION_VIOLENT_CONTENT',
	BIZ_COMMERCE_VIOLATION_WEAPONS: 'BIZ_COMMERCE_VIOLATION_WEAPONS',
	BIZ_QUALITY: 'BIZ_QUALITY',
	DEFAULT: 'DEFAULT',
	WEB_COMPANION_ONLY: 'WEB_COMPANION_ONLY'
} as const) as unknown as typeof ReachoutTimelockEnforcementTypeType
export type ReachoutTimelockEnforcementType = ReachoutTimelockEnforcementTypeType

export type ReachoutTimelockState = {
	isActive?: boolean
	/** Unix-millis Date when the cooldown lifts. Absent when `isActive=false`. */
	timeEnforcementEnds?: Date
	enforcementType?: ReachoutTimelockEnforcementType
}
