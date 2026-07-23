import type { WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import type { BinaryNode } from '../Types/index.ts'

type StanzaResponseClient = Pick<WasmWhatsAppClient, 'acknowledgeStanza' | 'rejectStanza' | 'requestMessageRetry'>

export interface StanzaResponseContext {
	getClient: () => Promise<StanzaResponseClient>
}

/** Translate the public socket calls into the core-owned response operations. */
export const makeStanzaResponseMethods = ({ getClient }: StanzaResponseContext) => ({
	sendMessageAck: async (node: BinaryNode, errorCode?: number): Promise<void> => {
		const client = await getClient()
		if (errorCode) {
			await client.rejectStanza(node, errorCode)
		} else {
			await client.acknowledgeStanza(node)
		}
	},
	sendRetryRequest: async (node: BinaryNode, forceIncludeKeys = false): Promise<void> => {
		await (await getClient()).requestMessageRetry(node, forceIncludeKeys)
	}
})
