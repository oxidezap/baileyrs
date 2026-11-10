import { describe, test } from 'node:test'
import Long from 'long'
import { DEFAULT_CONNECTION_CONFIG, PROCESSABLE_HISTORY_TYPES } from '../../Defaults/index.ts'
import { proto } from '../../WAProto/runtime.ts'
import { expect } from '../../__tests__/expect.ts'
import {
	historySyncNotificationFromMetadata,
	isHistorySyncFullyDisabled,
	makeHistorySyncAdmission,
	resolveHistorySyncPolicy
} from '../history-sync-admission.ts'

describe('history sync admission compatibility', () => {
	test('maps bridge metadata to the Baileys notification view without inventing fields', () => {
		const notification = historySyncNotificationFromMetadata({
			syncType: 2,
			chunkOrder: 4,
			progress: 75,
			fileLength: '9007199254740993',
			inlinePayloadLen: 128,
			peerDataRequestSessionId: 'session'
		})

		expect(notification.syncType).toBe(2)
		expect(notification.chunkOrder).toBe(4)
		expect(notification.progress).toBe(75)
		expect(Long.isLong(notification.fileLength)).toBe(true)
		expect(notification.fileLength?.toString()).toBe('9007199254740993')
		expect(notification.peerDataRequestSessionId).toBe('session')
		// Absent fields read as `null` through the prototype default — the same
		// shape a protobufjs-decoded notification has upstream.
		expect(notification.fileSha256).toBe(null)
		expect(notification.initialHistBootstrapInlinePayload).toBe(null)
	})

	test('absent metadata stays absent on the decoded instance', () => {
		const notification = historySyncNotificationFromMetadata({})

		expect(notification).toBeInstanceOf(proto.Message.HistorySyncNotification)
		expect(Object.hasOwn(notification, 'syncType')).toBe(false)
		expect(Object.hasOwn(notification, 'progress')).toBe(false)
		expect(Object.hasOwn(notification, 'fileLength')).toBe(false)
		expect(Object.keys(notification)).toEqual([])
	})

	test('invokes the configured Baileys policy for each bridge notification', () => {
		const seen: number[] = []
		const policies = makeHistorySyncAdmission(notification => {
			seen.push(notification.syncType ?? -1)
			return notification.syncType !== 2
		})

		expect(policies.historySyncAdmission({ syncType: 3 })).toBe(true)
		expect(policies.historySyncAdmission({ syncType: 2 })).toBe(false)
		expect(seen).toEqual([3, 2])
	})

	test('rejects unknown or absent sync types even when the callback accepts', () => {
		const calls: unknown[] = []
		const policies = makeHistorySyncAdmission(notification => {
			calls.push(notification.syncType)
			return true
		})

		// Callback runs first — upstream order — then the processable gate rejects.
		// Absent fields read as `null` through the prototype default, exactly
		// like a protobufjs-decoded notification, while staying non-own.
		expect(policies.historySyncAdmission({})).toBe(false)
		expect(policies.historySyncAdmission({ syncType: 999 })).toBe(false)
		expect(calls).toEqual([null, 999])
		for (const syncType of PROCESSABLE_HISTORY_TYPES) {
			expect(policies.historySyncAdmission({ syncType })).toBe(true)
		}
	})

	test('the default policy keeps upstream semantics through the adapter', () => {
		const policies = makeHistorySyncAdmission(DEFAULT_CONNECTION_CONFIG.shouldSyncHistoryMessage)

		expect(policies.historySyncAdmission({ syncType: 3 })).toBe(true)
		expect(policies.historySyncAdmission({ syncType: 2 })).toBe(false)
		expect(policies.historySyncAdmission({})).toBe(false)
	})

	test('detects a policy that disables every processable type', () => {
		expect(isHistorySyncFullyDisabled(() => false)).toBe(true)
		expect(isHistorySyncFullyDisabled(DEFAULT_CONNECTION_CONFIG.shouldSyncHistoryMessage)).toBe(false)
	})

	test('a throwing probe call never breaks the diagnostic', () => {
		expect(
			isHistorySyncFullyDisabled(() => {
				throw new Error('synthetic input unsupported')
			})
		).toBe(false)
	})

	test('an explicit undefined policy resolves to the default', () => {
		expect(resolveHistorySyncPolicy(undefined)).toBe(DEFAULT_CONNECTION_CONFIG.shouldSyncHistoryMessage)
		const custom = () => true
		expect(resolveHistorySyncPolicy(custom)).toBe(custom)
	})
})
