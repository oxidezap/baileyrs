import type { HistorySyncAdmissionMetadata } from '@oxidezap/whatsapp-rust-bridge'
import Long from 'long'
import type { proto } from '../WAProto/runtime.ts'

/**
 * Rebuilds the Baileys notification view from the metadata the bridge can
 * inspect before downloading or parsing history-sync content.
 *
 * The bridge intentionally exposes no keys or media paths at this stage. The
 * missing fields stay absent rather than being filled with synthetic values.
 */
export const historySyncNotificationFromMetadata = (
	metadata: HistorySyncAdmissionMetadata
): proto.Message.IHistorySyncNotification => ({
	syncType: metadata.syncType as proto.Message.HistorySyncType | undefined,
	chunkOrder: metadata.chunkOrder,
	progress: metadata.progress,
	fileLength: metadata.fileLength === undefined ? undefined : Long.fromString(metadata.fileLength, true),
	peerDataRequestSessionId: metadata.peerDataRequestSessionId
})

/** Adapt the Baileys history policy to the bridge's pre-download policy. */
export const makeHistorySyncAdmission = (
	shouldSyncHistoryMessage: SocketHistoryPolicy
): { historySyncAdmission: (metadata: HistorySyncAdmissionMetadata) => boolean } => ({
	historySyncAdmission: metadata => shouldSyncHistoryMessage(historySyncNotificationFromMetadata(metadata))
})

export type SocketHistoryPolicy = (message: proto.Message.IHistorySyncNotification) => boolean
