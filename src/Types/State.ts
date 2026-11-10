import type { Boom } from '../Utils/boom.ts'
import { makeNumericEnum } from '../Compatibility/internal/numeric-enum.ts'
import type {
	NewChatMessageCappingMVStatusType as NewChatMessageCappingMVStatusTypeType,
	NewChatMessageCappingOTEStatusType as NewChatMessageCappingOTEStatusTypeType,
	NewChatMessageCappingStatusType as NewChatMessageCappingStatusTypeType,
	SyncState as SyncStateType
} from '../Compatibility/public-api/enum-types.ts'
import type { Contact } from './Contact.ts'
import type { ReachoutTimelockState } from './Reachout.ts'

const SyncStateValues = {
	Connecting: 0,
	AwaitingInitialSync: 1,
	Syncing: 2,
	Online: 3
} as const
export const SyncState = makeNumericEnum(SyncStateValues) as unknown as typeof SyncStateType
export type SyncState = SyncStateType

export type WAConnectionState = 'open' | 'connecting' | 'close'

export const NewChatMessageCappingStatusType = Object.freeze({
	NONE: 'NONE',
	FIRST_WARNING: 'FIRST_WARNING',
	SECOND_WARNING: 'SECOND_WARNING',
	CAPPED: 'CAPPED'
} as const) as unknown as typeof NewChatMessageCappingStatusTypeType
export type NewChatMessageCappingStatusType = NewChatMessageCappingStatusTypeType

export const NewChatMessageCappingMVStatusType = Object.freeze({
	NOT_ELIGIBLE: 'NOT_ELIGIBLE',
	NOT_ACTIVE: 'NOT_ACTIVE',
	ACTIVE: 'ACTIVE',
	ACTIVE_UPGRADE_AVAILABLE: 'ACTIVE_UPGRADE_AVAILABLE'
} as const) as unknown as typeof NewChatMessageCappingMVStatusTypeType
export type NewChatMessageCappingMVStatusType = NewChatMessageCappingMVStatusTypeType

export const NewChatMessageCappingOTEStatusType = Object.freeze({
	NOT_ELIGIBLE: 'NOT_ELIGIBLE',
	ELIGIBLE: 'ELIGIBLE',
	ACTIVE_IN_CURRENT_CYCLE: 'ACTIVE_IN_CURRENT_CYCLE',
	EXHAUSTED: 'EXHAUSTED'
} as const) as unknown as typeof NewChatMessageCappingOTEStatusTypeType
export type NewChatMessageCappingOTEStatusType = NewChatMessageCappingOTEStatusTypeType

export type NewChatMessageCapInfo = {
	total_quota?: number
	used_quota?: number
	cycle_start_timestamp?: string
	cycle_end_timestamp?: string
	server_sent_timestamp?: string
	ote_status?: NewChatMessageCappingOTEStatusType
	mv_status?: NewChatMessageCappingMVStatusType
	capping_status?: NewChatMessageCappingStatusType
}

export type ConnectionState = {
	/** connection is now open, connecting or closed */
	connection: WAConnectionState

	/** the error that caused the connection to close */
	lastDisconnect?: {
		error: Boom | Error | undefined
		date: Date
	}
	/** is this a new login */
	isNewLogin?: boolean
	/** the current QR code */
	qr?: string
	/** has the device received all pending notifications while it was offline */
	receivedPendingNotifications?: boolean
	/** legacy connection options */
	legacy?: {
		phoneConnected: boolean
		user?: Contact
	}
	/**
	 * if the client is shown as an active, online client.
	 * If this is false, the primary phone and other devices will receive notifs
	 * */
	isOnline?: boolean
	/**
	 * Server-imposed cooldown on outbound messaging to NEW contacts.
	 * Emitted both via push (`NotificationUserReachoutTimelockUpdate`) and
	 * after `fetchReachoutTimelock()`. See `ReachoutTimelockState`.
	 */
	reachoutTimeLock?: ReachoutTimelockState
}
