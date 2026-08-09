import type { proto } from '../WAProto/runtime.ts'
import type { AccountSettings } from './Auth.ts'
import type { QuickReplyAction } from './Bussines.ts'
import type { BufferedEventData } from './Events.ts'
import type { LabelActionBody } from './Label.ts'
import type { ChatLabelAssociationActionBody } from './LabelAssociation.ts'
import type { MessageLabelAssociationActionBody } from './LabelAssociation.ts'
import type { MinimalMessage, WAMessageKey } from './Message.ts'

/**
 * privacy settings in WhatsApp Web
 *
 * Each of these is a set first and a type second: the wrappers that take one
 * check the value against the same array the type is derived from, so a value
 * cannot be accepted by the compiler and refused at runtime, or the reverse.
 */
export const WA_PRIVACY_VALUES = ['all', 'contacts', 'contact_blacklist', 'none'] as const

export type WAPrivacyValue = (typeof WA_PRIVACY_VALUES)[number]

export const WA_PRIVACY_ONLINE_VALUES = ['all', 'match_last_seen'] as const

export type WAPrivacyOnlineValue = (typeof WA_PRIVACY_ONLINE_VALUES)[number]

export const WA_PRIVACY_GROUP_ADD_VALUES = ['all', 'contacts', 'contact_blacklist'] as const

export type WAPrivacyGroupAddValue = (typeof WA_PRIVACY_GROUP_ADD_VALUES)[number]

export const WA_READ_RECEIPTS_VALUES = ['all', 'none'] as const

export type WAReadReceiptsValue = (typeof WA_READ_RECEIPTS_VALUES)[number]

export const WA_PRIVACY_CALL_VALUES = ['all', 'known'] as const

export type WAPrivacyCallValue = (typeof WA_PRIVACY_CALL_VALUES)[number]

export const WA_PRIVACY_MESSAGES_VALUES = ['all', 'contacts'] as const

export type WAPrivacyMessagesValue = (typeof WA_PRIVACY_MESSAGES_VALUES)[number]

/** the two the account itself broadcasts, as opposed to the per-chat states */
export const WA_PRESENCE_STATUSES = ['unavailable', 'available'] as const

export type WAPresenceStatus = (typeof WA_PRESENCE_STATUSES)[number]

export const WA_CHAT_STATES = ['composing', 'recording', 'paused'] as const

export type WAChatState = (typeof WA_CHAT_STATES)[number]

/** set of statuses visible to other people; see updatePresence() in WhatsAppWeb.Send */
export const WA_PRESENCES = [...WA_PRESENCE_STATUSES, ...WA_CHAT_STATES] as const

export type WAPresence = (typeof WA_PRESENCES)[number]

export const ALL_WA_PATCH_NAMES = [
	'critical_block',
	'critical_unblock_low',
	'regular_high',
	'regular_low',
	'regular'
] as const

export type WAPatchName = (typeof ALL_WA_PATCH_NAMES)[number]

export interface PresenceData {
	lastKnownPresence: WAPresence
	lastSeen?: number
}

export type BotListInfo = {
	jid: string
	personaId: string
}

export type ChatMutation = {
	syncAction: proto.ISyncActionData
	index: string[]
}

export type WAPatchCreate = {
	syncAction: proto.ISyncActionValue
	index: string[]
	type: WAPatchName
	apiVersion: number
	operation: proto.SyncdMutation.SyncdOperation
}

export type Chat = proto.IConversation & {
	/** unix timestamp of when the last message was received in the chat */
	lastMessageRecvTimestamp?: number
}

export type ChatUpdate = Partial<
	Chat & {
		/**
		 * if specified in the update,
		 * the EV buffer will check if the condition gets fulfilled before applying the update
		 * Right now, used to determine when to release an app state sync event
		 *
		 * @returns true, if the update should be applied;
		 * false if it can be discarded;
		 * undefined if the condition is not yet fulfilled
		 * */
		conditional: (bufferedData: BufferedEventData) => boolean | undefined
		/** last update time */
		timestamp?: number
	}
>

/**
 * the last messages in a chat, sorted reverse-chronologically. That is, the latest message should be first in the chat
 * for MD modifications, the last message in the array (i.e. the earlist message) must be the last message recv in the chat
 * */
export type LastMessageList = MinimalMessage[] | proto.SyncActionValue.ISyncActionMessageRange

export type ChatModification =
	| {
			archive: boolean
			lastMessages: LastMessageList
	  }
	| { pushNameSetting: string }
	| { pin: boolean }
	| {
			/** mute for duration, or provide timestamp of mute to remove*/
			mute: number | null
	  }
	| {
			clear: boolean
			lastMessages: LastMessageList
	  }
	| {
			deleteForMe: { deleteMedia: boolean; key: WAMessageKey; timestamp: number }
	  }
	| {
			star: {
				messages: { id: string; fromMe?: boolean }[]
				star: boolean
			}
	  }
	| {
			markRead: boolean
			lastMessages: LastMessageList
	  }
	| { delete: true; lastMessages: LastMessageList }
	| { contact: proto.SyncActionValue.IContactAction | null }
	| { disableLinkPreviews: proto.SyncActionValue.IPrivacySettingDisableLinkPreviewsAction }
	// Label
	| { addLabel: LabelActionBody }
	// Label assosiation
	| { addChatLabel: ChatLabelAssociationActionBody }
	| { removeChatLabel: ChatLabelAssociationActionBody }
	| { addMessageLabel: MessageLabelAssociationActionBody }
	| { removeMessageLabel: MessageLabelAssociationActionBody }
	| { quickReply: QuickReplyAction }

export type InitialReceivedChatsState = {
	[jid: string]: {
		/** the last message received from the other party */
		lastMsgRecvTimestamp?: number
		/** the absolute last message in the chat */
		lastMsgTimestamp: number
	}
}

export type InitialAppStateSyncOptions = {
	accountSettings: AccountSettings
}
