import { ExpiringLruMap } from '../internal/expiring-lru-map.ts'
import { makeNumericEnum } from '../internal/numeric-enum.ts'
import type { RetryReason as RetryReasonType } from './enum-types.ts'
import type { proto } from '../../WAProto/runtime.ts'
import type { ILogger } from '../../Utils/logger.ts'

const RECENT_MESSAGES_SIZE = 512
const MESSAGE_KEY_SEPARATOR = '\0'
const RECREATE_SESSION_TIMEOUT = 60 * 60 * 1000
const PHONE_REQUEST_DELAY = 3000

export interface RecentMessageKey {
	to: string
	id: string
}

export interface RecentMessage {
	message: proto.IMessage
	timestamp: number
}

export interface SessionRecreateHistory {
	[jid: string]: number
}

export interface RetryCounter {
	[messageId: string]: number
}

export type PendingPhoneRequest = Record<string, ReturnType<typeof setTimeout>>

export interface RetryStatistics {
	totalRetries: number
	successfulRetries: number
	failedRetries: number
	mediaRetries: number
	sessionRecreations: number
	phoneRequests: number
}

const RetryReasonValues = {
	UnknownError: 0,
	SignalErrorNoSession: 1,
	SignalErrorInvalidKey: 2,
	SignalErrorInvalidKeyId: 3,
	SignalErrorInvalidMessage: 4,
	SignalErrorInvalidSignature: 5,
	SignalErrorFutureMessage: 6,
	SignalErrorBadMac: 7,
	SignalErrorInvalidSession: 8,
	SignalErrorInvalidMsgKey: 9,
	BadBroadcastEphemeralSetting: 10,
	UnknownCompanionNoPrekey: 11,
	AdvFailure: 12,
	StatusRevokeDelay: 13
} as const

export const RetryReason = makeNumericEnum(RetryReasonValues) as unknown as typeof RetryReasonType
export type RetryReason = RetryReasonType

const MAC_ERROR_CODES = new Set<RetryReason>([RetryReason.SignalErrorInvalidMessage, RetryReason.SignalErrorBadMac])

export class MessageRetryManager {
	private recentMessagesMap = new ExpiringLruMap<string, RecentMessage>({
		max: RECENT_MESSAGES_SIZE,
		ttl: 5 * 60 * 1000,
		dispose: (_value, key) => {
			const separatorIndex = key.lastIndexOf(MESSAGE_KEY_SEPARATOR)
			if (separatorIndex > -1) this.messageKeyIndex.delete(key.slice(separatorIndex + 1))
		}
	})
	private messageKeyIndex = new Map<string, string>()
	private sessionRecreateHistory = new ExpiringLruMap<string, number>({ ttl: RECREATE_SESSION_TIMEOUT * 2 })
	private retryCounters = new ExpiringLruMap<string, number>({
		ttl: 15 * 60 * 1000,
		updateAgeOnGet: true
	})
	private baseKeys = new ExpiringLruMap<string, Uint8Array>({ max: 1024, ttl: 15 * 60 * 1000 })
	private pendingPhoneRequests: PendingPhoneRequest = {}
	private readonly maxMsgRetryCount: number
	private readonly logger: ILogger
	private statistics: RetryStatistics = {
		totalRetries: 0,
		successfulRetries: 0,
		failedRetries: 0,
		mediaRetries: 0,
		sessionRecreations: 0,
		phoneRequests: 0
	}

	constructor(logger: ILogger, maxMsgRetryCount: number) {
		this.logger = logger
		this.maxMsgRetryCount = maxMsgRetryCount
	}

	addRecentMessage(to: string, id: string, message: proto.IMessage): void {
		const keyString = this.keyToString({ to, id })
		this.recentMessagesMap.set(keyString, { message, timestamp: Date.now() })
		this.messageKeyIndex.set(id, keyString)
		this.logger.debug(`Added message to retry cache: ${to}/${id}`)
	}

	getRecentMessage(to: string, id: string): RecentMessage | undefined {
		return this.recentMessagesMap.get(this.keyToString({ to, id }))
	}

	shouldRecreateSession(
		jid: string,
		hasSession: boolean,
		errorCode?: RetryReason
	): { reason: string; recreate: boolean } {
		if (!hasSession) {
			this.sessionRecreateHistory.set(jid, Date.now())
			this.statistics.sessionRecreations++
			return { reason: "we don't have a Signal session with them", recreate: true }
		}
		if (errorCode !== undefined && MAC_ERROR_CODES.has(errorCode)) {
			this.sessionRecreateHistory.set(jid, Date.now())
			this.statistics.sessionRecreations++
			this.logger.warn(
				{ jid, errorCode: RetryReason[errorCode] },
				'MAC error detected, forcing immediate session recreation'
			)
			return {
				reason: `MAC error (code ${errorCode}: ${RetryReason[errorCode]}), immediate session recreation`,
				recreate: true
			}
		}
		const previous = this.sessionRecreateHistory.get(jid)
		if (!previous || Date.now() - previous > RECREATE_SESSION_TIMEOUT) {
			this.sessionRecreateHistory.set(jid, Date.now())
			this.statistics.sessionRecreations++
			return { reason: 'retry count > 1 and over an hour since last recreation', recreate: true }
		}
		return { reason: '', recreate: false }
	}

	parseRetryErrorCode(errorAttr: string | undefined): RetryReason | undefined {
		if (errorAttr === undefined || errorAttr === '') return undefined
		const code = Number.parseInt(errorAttr, 10)
		if (Number.isNaN(code)) return undefined
		return code >= RetryReason.UnknownError && code <= RetryReason.StatusRevokeDelay
			? (code as RetryReason)
			: RetryReason.UnknownError
	}

	isMacError(errorCode: RetryReason | undefined): boolean {
		return errorCode !== undefined && MAC_ERROR_CODES.has(errorCode)
	}

	incrementRetryCount(messageId: string): number {
		this.retryCounters.set(messageId, (this.retryCounters.get(messageId) || 0) + 1)
		this.statistics.totalRetries++
		return this.retryCounters.get(messageId)!
	}

	getRetryCount(messageId: string): number {
		return this.retryCounters.get(messageId) || 0
	}

	hasExceededMaxRetries(messageId: string): boolean {
		return this.getRetryCount(messageId) >= this.maxMsgRetryCount
	}

	markRetrySuccess(messageId: string): void {
		this.statistics.successfulRetries++
		this.retryCounters.delete(messageId)
		this.cancelPendingPhoneRequest(messageId)
		this.removeRecentMessage(messageId)
	}

	markRetryFailed(messageId: string): void {
		this.statistics.failedRetries++
		this.retryCounters.delete(messageId)
		this.cancelPendingPhoneRequest(messageId)
		this.removeRecentMessage(messageId)
	}

	schedulePhoneRequest(messageId: string, callback: () => void, delay: number = PHONE_REQUEST_DELAY): void {
		this.cancelPendingPhoneRequest(messageId)
		this.pendingPhoneRequests[messageId] = setTimeout(() => {
			delete this.pendingPhoneRequests[messageId]
			this.statistics.phoneRequests++
			callback()
		}, delay)
		this.logger.debug(`Scheduled phone request for message ${messageId} with ${delay}ms delay`)
	}

	cancelPendingPhoneRequest(messageId: string): void {
		const timeout = this.pendingPhoneRequests[messageId]
		if (timeout) {
			clearTimeout(timeout)
			delete this.pendingPhoneRequests[messageId]
			this.logger.debug(`Cancelled pending phone request for message ${messageId}`)
		}
	}

	clear(): void {
		this.recentMessagesMap.clear()
		this.messageKeyIndex.clear()
		this.sessionRecreateHistory.clear()
		this.retryCounters.clear()
		this.baseKeys.clear()
		for (const messageId of Object.keys(this.pendingPhoneRequests)) this.cancelPendingPhoneRequest(messageId)
		this.statistics = {
			totalRetries: 0,
			successfulRetries: 0,
			failedRetries: 0,
			mediaRetries: 0,
			sessionRecreations: 0,
			phoneRequests: 0
		}
	}

	saveBaseKey(addr: string, msgId: string, baseKey: Uint8Array): void {
		this.baseKeys.set(`${addr}:${msgId}`, baseKey)
	}
	hasSameBaseKey(addr: string, msgId: string, baseKey: Uint8Array): boolean {
		const stored = this.baseKeys.get(`${addr}:${msgId}`)
		if (!stored || stored.length !== baseKey.length) return false
		return stored.every((byte, index) => byte === baseKey[index])
	}
	deleteBaseKey(addr: string, msgId: string): void {
		this.baseKeys.delete(`${addr}:${msgId}`)
	}

	private keyToString(key: RecentMessageKey): string {
		return `${key.to}${MESSAGE_KEY_SEPARATOR}${key.id}`
	}
	private removeRecentMessage(messageId: string): void {
		const keyString = this.messageKeyIndex.get(messageId)
		if (!keyString) return
		this.recentMessagesMap.delete(keyString)
		this.messageKeyIndex.delete(messageId)
	}
}
