import type { LabelAssociationType as LabelAssociationTypeType } from '../Compatibility/public-api/enum-types.ts'

/** Association type */
export const LabelAssociationType = Object.freeze({
	Chat: 'label_jid',
	Message: 'label_message'
} as const) as unknown as typeof LabelAssociationTypeType
export type LabelAssociationType = LabelAssociationTypeType

export type LabelAssociationTypes = `${LabelAssociationType}`

/** Association for chat */
export interface ChatLabelAssociation {
	type: typeof LabelAssociationType.Chat
	chatId: string
	labelId: string
}

/** Association for message */
export interface MessageLabelAssociation {
	type: typeof LabelAssociationType.Message
	chatId: string
	messageId: string
	labelId: string
}

export type LabelAssociation = ChatLabelAssociation | MessageLabelAssociation

/** Body for add/remove chat label association action */
export interface ChatLabelAssociationActionBody {
	labelId: string
}

/** body for add/remove message label association action */
export interface MessageLabelAssociationActionBody {
	labelId: string
	messageId: string
}
