export * from './Auth.ts'
export * from './BinaryNode.ts'
export * from './GroupMetadata.ts'
export * from './Chat.ts'
export * from './Contact.ts'
export * from './State.ts'
export * from './Message.ts'
export * from './Socket.ts'
export * from './Events.ts'
export * from './Call.ts'
export * from './Newsletter.ts'

import type { AuthenticationState } from './Auth.ts'
import type { SocketConfig } from './Socket.ts'

export type UserFacingSocketConfig = Partial<SocketConfig> & { auth: AuthenticationState }

export type BrowsersMap = {
	ubuntu(browser: string): [string, string, string]
	macOS(browser: string): [string, string, string]
	baileys(browser: string): [string, string, string]
	windows(browser: string): [string, string, string]
	appropriate(browser: string): [string, string, string]
}

// `connectionLost` and `timedOut` deliberately share status code 408 — both
// are surfaced to callers as upstream Baileys does, even though the wire-level
// distinction collapses to the same HTTP-style code. Keep the values aligned
// with `@whiskeysockets/baileys`.
/* eslint-disable typescript-eslint/no-duplicate-enum-values */
export enum DisconnectReason {
	connectionClosed = 428,
	connectionLost = 408,
	connectionReplaced = 440,
	timedOut = 408,
	loggedOut = 401,
	badSession = 500,
	restartRequired = 515,
	multideviceMismatch = 411,
	forbidden = 403,
	unavailableService = 503
}
/* eslint-enable typescript-eslint/no-duplicate-enum-values */

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
