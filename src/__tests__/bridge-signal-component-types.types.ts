import type {
	ReceiverSessionChainComponents,
	SenderSessionChainComponents,
	SessionComponents
} from 'whatsapp-rust-bridge'

declare const bytes: Uint8Array

export const senderChain: SenderSessionChainComponents = {
	senderRatchetKey: bytes,
	senderRatchetKeyPrivate: bytes,
	chainKey: { index: 0, key: bytes },
	messageKeys: []
}

export const receiverChain: ReceiverSessionChainComponents = {
	senderRatchetKey: bytes,
	chainKey: { index: 0, key: bytes },
	messageKeys: []
}

// @ts-expect-error A present sender chain owns private ratchet material.
export const senderWithoutPrivate: SenderSessionChainComponents = {
	senderRatchetKey: bytes,
	chainKey: { index: 0, key: bytes },
	messageKeys: []
}

export const receiverWithPrivate: ReceiverSessionChainComponents = {
	senderRatchetKey: bytes,
	// @ts-expect-error Receiver chains never accept private ratchet material.
	senderRatchetKeyPrivate: bytes,
	chainKey: { index: 0, key: bytes },
	messageKeys: []
}

export const sessionRoles: Pick<SessionComponents, 'senderChain' | 'receiverChains'> = {
	senderChain,
	receiverChains: [receiverChain]
}
