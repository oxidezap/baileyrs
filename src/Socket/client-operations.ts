import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

export interface ClientOperations<Client = WasmWhatsAppClient> {
	withClient<T>(operation: (client: Client) => T | Promise<T>): Promise<T>
}

export const makeWithClient =
	<Client>(getClient: () => Promise<Client>): ClientOperations<Client>['withClient'] =>
	async operation =>
		operation(await getClient())
