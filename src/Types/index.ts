export * from './Auth.ts'
export * from './BinaryNode.ts'
export * from './GroupMetadata.ts'
export * from './Chat.ts'
export * from './Contact.ts'
export * from './Reachout.ts'
export * from './State.ts'
export * from './Message.ts'
export * from './Socket.ts'
export * from './Events.ts'
export * from './Call.ts'
export * from './Newsletter.ts'
export * from './Product.ts'
export * from './Signal.ts'

import { makeNumericEnum } from '../Compatibility/internal/numeric-enum.ts'
import type { DisconnectReason as DisconnectReasonType } from '../Compatibility/public-api/enum-types.ts'
import type { AuthenticationState } from './Auth.ts'
import type { SocketConfig } from './Socket.ts'

export type UserFacingSocketConfig = Partial<SocketConfig> & { auth: AuthenticationState }

export type BrowsersMap = {
	ubuntu(browser: string): [string, string, string]
	macOS(browser: string): [string, string, string]
	baileys(browser: string): [string, string, string]
	windows(browser: string): [string, string, string]
	android(osVersion: string): [string, string, string]
	appropriate(browser: string): [string, string, string]
}

// The numeric-enum builder preserves reverse-map behavior, including the
// shared 408 value where the later `timedOut` member wins.
const DisconnectReasonValues = {
	connectionClosed: 428,
	connectionLost: 408,
	connectionReplaced: 440,
	timedOut: 408,
	loggedOut: 401,
	badSession: 500,
	restartRequired: 515,
	multideviceMismatch: 411,
	forbidden: 403,
	unavailableService: 503
} as const
export const DisconnectReason = makeNumericEnum(DisconnectReasonValues) as unknown as typeof DisconnectReasonType
export type DisconnectReason = DisconnectReasonType

export type WAInitResponse = {
	ref: string
	ttl: number
	status: 200
}

export type WABusinessHoursConfig = {
	day_of_week: string
	mode: string
	open_time?: number
	close_time?: number
}

export type WABusinessProfile = {
	description: string
	email: string | undefined
	business_hours: {
		timezone?: string
		config?: WABusinessHoursConfig[]
		business_config?: WABusinessHoursConfig[]
	}
	website: string[]
	category?: string
	wid?: string
	address?: string
}

export type CurveKeyPair = { private: Uint8Array; public: Uint8Array }
