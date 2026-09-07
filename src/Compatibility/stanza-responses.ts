import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { BinaryNode } from '../Types/index.ts'
import { makeWithClient, type ClientOperations } from '../Socket/client-operations.ts'

type StanzaResponseClient = Pick<WasmWhatsAppClient, 'acknowledgeStanza' | 'rejectStanza' | 'requestMessageRetry'>

export interface StanzaResponseContext {
	getClient: () => Promise<StanzaResponseClient>
}

/** Translate the public socket calls into the core-owned response operations. */
export const makeStanzaResponseMethods = (ctx: StanzaResponseContext | ClientOperations<StanzaResponseClient>) => {
	// The legacy factory captured getClient and invoked it without a receiver.
	const withClient = makeWithClient('withClient' in ctx ? ctx : { getClient: ctx.getClient.bind(undefined) })
	return {
		sendMessageAck: async (node: BinaryNode, errorCode?: number): Promise<void> => {
			return withClient(async client => {
				if (errorCode) {
					await client.rejectStanza(node, errorCode)
				} else {
					await client.acknowledgeStanza(node)
				}
			})
		},
		sendRetryRequest: async (node: BinaryNode, forceIncludeKeys = false): Promise<void> => {
			await withClient(client => client.requestMessageRetry(node, forceIncludeKeys))
		}
	}
}
