import type { HistorySyncAdmissionMetadata } from '@oxidezap/whatsapp-rust-bridge'
import Long from 'long'
import { DEFAULT_CONNECTION_CONFIG, PROCESSABLE_HISTORY_TYPES } from '../Defaults/index.ts'
import { proto as protoRuntime } from '../WAProto/runtime.ts'
import type { proto } from '../WAProto/runtime.ts'

export type SocketHistoryPolicy = (message: proto.Message.IHistorySyncNotification) => boolean

/**
 * Rebuilds the Baileys notification view from the metadata the bridge can
 * inspect before downloading or parsing history-sync content.
 *
 * Partial view, by design: only `syncType`, `chunkOrder`, `progress`,
 * `fileLength` and `peerDataRequestSessionId` cross the pre-download
 * boundary. Media and key fields (`fileSha256`, `mediaKey`, `fileEncSha256`,
 * `directPath`, `oldestMsgInChunkTimestampSec`,
 * `fullHistorySyncOnDemandRequestMetadata`, `encHandle`, …) stay absent —
 * never synthesized — so a policy filtering on them sees `undefined`, not a
 * fabricated value.
 *
 * Only present fields become own properties: the result is a decoded
 * `HistorySyncNotification` instance, so `Object.keys`, `Object.hasOwn` and
 * `instanceof` match what Baileys hands its own policy.
 */
export const historySyncNotificationFromMetadata = (
	metadata: HistorySyncAdmissionMetadata
): proto.Message.IHistorySyncNotification => {
	const fields: proto.Message.IHistorySyncNotification = {}
	if (metadata.syncType !== undefined) {
		fields.syncType = metadata.syncType as proto.Message.HistorySyncType
	}
	if (metadata.chunkOrder !== undefined) {
		fields.chunkOrder = metadata.chunkOrder
	}
	if (metadata.progress !== undefined) {
		fields.progress = metadata.progress
	}
	if (metadata.fileLength !== undefined) {
		fields.fileLength = Long.fromString(metadata.fileLength, true)
	}
	if (metadata.peerDataRequestSessionId !== undefined) {
		fields.peerDataRequestSessionId = metadata.peerDataRequestSessionId
	}
	return protoRuntime.Message.HistorySyncNotification.create(fields)
}

/**
 * Resolve the configured policy, falling back to the default when the caller
 * spread an explicit `undefined` over it. Without this the shallow config
 * merge would replace the default with `undefined` and the first history
 * notification would die as a callback `TypeError` — rejected and permanently
 * acknowledged by the bridge.
 */
export const resolveHistorySyncPolicy = (configured: SocketHistoryPolicy | undefined): SocketHistoryPolicy =>
	configured ?? DEFAULT_CONNECTION_CONFIG.shouldSyncHistoryMessage

/**
 * Probe whether the policy rejects every upstream-processable sync type.
 * Mirrors the upstream socket-construction check, including its call pattern:
 * the policy runs once per processable type against a synthetic
 * `{ syncType }` notification. Disabling everything also drops the initial
 * LID mappings, which destabilizes sessions — hence the warning at the call
 * site.
 *
 * One deliberate deviation: a probe call that throws is treated as
 * potentially enabling rather than propagating. The probe is diagnostic-only,
 * and a socket must never fail to build over a diagnostic — upstream lets
 * that throw out of construction. Stateful policies still observe these
 * calls, exactly as they do upstream.
 */
export const isHistorySyncFullyDisabled = (shouldSyncHistoryMessage: SocketHistoryPolicy): boolean =>
	PROCESSABLE_HISTORY_TYPES.every(syncType => {
		try {
			return shouldSyncHistoryMessage({ syncType } as proto.Message.IHistorySyncNotification) === false
		} catch {
			return false
		}
	})

/**
 * Adapt the Baileys history policy to the bridge's pre-download policy.
 *
 * Order matches upstream: the callback runs first, then the processable-type
 * gate. Unknown or absent `syncType` values are therefore rejected even when
 * the callback accepts them, because the core enqueues whatever this policy
 * admits with no further type filtering.
 */
export const makeHistorySyncAdmission = (
	shouldSyncHistoryMessage: SocketHistoryPolicy
): { historySyncAdmission: (metadata: HistorySyncAdmissionMetadata) => boolean } => ({
	historySyncAdmission: metadata => {
		const notification = historySyncNotificationFromMetadata(metadata)
		const accepted = shouldSyncHistoryMessage(notification)
		return accepted && PROCESSABLE_HISTORY_TYPES.includes(notification.syncType as proto.HistorySync.HistorySyncType)
	}
})
