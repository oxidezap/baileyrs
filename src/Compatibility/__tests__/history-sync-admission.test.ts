import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import Long from 'long'
import { historySyncNotificationFromMetadata, makeHistorySyncAdmission } from '../history-sync-admission.ts'

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

		assert.equal(notification.syncType, 2)
		assert.equal(notification.chunkOrder, 4)
		assert.equal(notification.progress, 75)
		assert.equal(Long.isLong(notification.fileLength), true)
		assert.equal(notification.fileLength?.toString(), '9007199254740993')
		assert.equal(notification.peerDataRequestSessionId, 'session')
		assert.equal(notification.fileSha256, undefined)
		assert.equal(notification.initialHistBootstrapInlinePayload, undefined)
	})

	test('invokes the configured Baileys policy for each bridge notification', () => {
		const seen: number[] = []
		const policies = makeHistorySyncAdmission(notification => {
			seen.push(notification.syncType ?? -1)
			return notification.syncType !== 2
		})

		assert.equal(policies.historySyncAdmission({ syncType: 3 }), true)
		assert.equal(policies.historySyncAdmission({ syncType: 2 }), false)
		assert.deepEqual(seen, [3, 2])
	})
})
