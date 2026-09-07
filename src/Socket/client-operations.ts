import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

export interface ClientOperations<Client = WasmWhatsAppClient> {
	withClient<T>(operation: (client: Client) => T | Promise<T>): Promise<T>
}

export interface LegacyClientAccess<Client = WasmWhatsAppClient> {
	getClient: () => Promise<Client>
}

/** Published factories still accept their original getClient contexts. */
export const makeWithClient = <Client>(
	ctx: ClientOperations<Client> | LegacyClientAccess<Client>
): ClientOperations<Client>['withClient'] => {
	if ('withClient' in ctx) return operation => ctx.withClient(operation)
	return async operation => operation(await ctx.getClient())
}
