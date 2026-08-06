import type { MessageRetransmissionInput } from '@oxidezap/whatsapp-rust-bridge'
import type { BinaryNode, MessageRelayOptions } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { generateMessageIDV2 } from '../Utils/generics.ts'
import { areJidsSameUser, isJidBroadcast, isJidGroup, isJidNewsletter } from '../WABinary/index.ts'

const EMPTY_RELAY_NODES: BinaryNode[] = []

type OwnRelayIdentity = { id?: string; lid?: string } | undefined

export type MessageRelayPlan =
	| {
			kind: 'message'
			messageId: string
			nodes: BinaryNode[]
			refreshGroupMetadata: boolean
			refreshDevices: boolean
	  }
	| {
			kind: 'status'
			messageId: string
			recipients: string[]
			nodes: BinaryNode[]
			refreshDevices: boolean
	  }
	| {
			kind: 'retransmission'
			messageId: string
			input: MessageRetransmissionInput
	  }

const assertSupportedAttributes = (attributes: MessageRelayOptions['additionalAttributes']): void => {
	if (!attributes) return
	for (const name in attributes) {
		if (Object.hasOwn(attributes, name)) {
			// TODO(RELAY-CORE-006): route proven semantic attributes through a
			// typed operation instead of exposing a raw stanza-attribute map.
			throw new Boom(`relayMessage additional attribute '${name}' is not supported`, { statusCode: 400 })
		}
	}
}

const isDirectConversation = (jid: string): boolean => !isJidGroup(jid) && !isJidBroadcast(jid) && !isJidNewsletter(jid)

const isOwnDevice = (jid: string, own: OwnRelayIdentity): boolean =>
	(own?.id !== undefined && areJidsSameUser(jid, own.id)) || (own?.lid !== undefined && areJidsSameUser(jid, own.lid))

export const planMessageRelay = (
	jid: string,
	options: MessageRelayOptions,
	own: OwnRelayIdentity
): MessageRelayPlan => {
	const {
		messageId,
		participant,
		additionalAttributes,
		additionalNodes,
		useUserDevicesCache,
		useCachedGroupMetadata,
		statusJidList
	} = options
	assertSupportedAttributes(additionalAttributes)

	const nodes = additionalNodes ?? EMPTY_RELAY_NODES
	if (participant && nodes.length) {
		throw new Boom('relayMessage additionalNodes are not supported for targeted retransmission', {
			statusCode: 400
		})
	}

	const id = messageId || generateMessageIDV2(own?.id)
	const refreshGroupMetadata = useCachedGroupMetadata === false
	if (participant) {
		const requesterIsOwnDevice = isDirectConversation(jid) && isOwnDevice(participant.jid, own)
		return {
			kind: 'retransmission',
			messageId: id,
			input: {
				requesterJid: participant.jid,
				messageId: id,
				retryCount: participant.count,
				...(requesterIsOwnDevice ? { recipientJid: jid } : {}),
				refreshGroupMetadata
			}
		}
	}

	const refreshDevices = useUserDevicesCache === false
	if (jid === 'status@broadcast' && statusJidList?.length) {
		return {
			kind: 'status',
			messageId: id,
			recipients: statusJidList,
			nodes,
			refreshDevices
		}
	}

	return {
		kind: 'message',
		messageId: id,
		nodes,
		refreshGroupMetadata,
		refreshDevices
	}
}
