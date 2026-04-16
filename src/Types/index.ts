export * from './Auth'
export * from './BinaryNode'
export * from './GroupMetadata'
export * from './Chat'
export * from './Contact'
export * from './State'
export * from './Message'
export * from './Socket'
export * from './Events'
export * from './Call'
export * from './Newsletter'

import type { AuthenticationState } from './Auth'
import type { SocketConfig } from './Socket'

export type UserFacingSocketConfig = Partial<SocketConfig> & { auth: AuthenticationState }

export type BrowsersMap = {
	ubuntu(browser: string): [string, string, string]
	macOS(browser: string): [string, string, string]
	baileys(browser: string): [string, string, string]
	windows(browser: string): [string, string, string]
	appropriate(browser: string): [string, string, string]
}

export enum DisconnectReason {
	connectionClosed = 428,
	connectionLost = 499,
	connectionReplaced = 440,
	timedOut = 408,
	loggedOut = 401,
	badSession = 500,
	restartRequired = 515,
	multideviceMismatch = 411,
	forbidden = 403,
	unavailableService = 503
}

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
