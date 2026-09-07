import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { BinaryNode } from '../Types/index.ts'
import type { ClientOperations } from '../Socket/client-operations.ts'

type StanzaResponseClient = Pick<WasmWhatsAppClient, 'acknowledgeStanza' | 'rejectStanza' | 'requestMessageRetry'>

export interface StanzaResponseContext extends ClientOperations<StanzaResponseClient> {}

/** Translate the public socket calls into the core-owned response operations. */
export const makeStanzaResponseMethods = (ctx: StanzaResponseContext) => {
	return {
		sendMessageAck: async (node: BinaryNode, errorCode?: number): Promise<void> => {
			return ctx.withClient(async client => {
				if (errorCode) {
					await client.rejectStanza(node, errorCode)
				} else {
					await client.acknowledgeStanza(node)
				}
			})
		},
		sendRetryRequest: async (node: BinaryNode, forceIncludeKeys = false): Promise<void> => {
			await ctx.withClient(client => client.requestMessageRetry(node, forceIncludeKeys))
		}
	}
}
