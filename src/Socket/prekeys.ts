import { makeWithClient, type ClientOperations, type LegacyClientAccess } from './client-operations.ts'
import { MIN_PREKEY_COUNT } from '../Defaults/index.ts'
import type { CompatibleSocketContext as SocketContext } from './types.ts'

type PreKeyContext = Pick<SocketContext, 'logger'> & (ClientOperations | LegacyClientAccess)

export const makePreKeyMethods = (ctx: PreKeyContext) => {
	const withClient = makeWithClient(ctx)
	return {
		uploadPreKeys: async (count = MIN_PREKEY_COUNT): Promise<void> => {
			await withClient(client => client.refreshPreKeys(count))
		},

		uploadPreKeysToServerIfRequired: async (): Promise<void> => {
			try {
				await withClient(client => client.ensurePreKeys())
			} catch (error) {
				ctx.logger.error({ error }, 'Failed to check/upload pre-keys during initialization')
			}
		},

		digestKeyBundle: async (): Promise<void> => {
			await withClient(client => client.validateKeyBundle())
		},

		rotateSignedPreKey: async (): Promise<void> => {
			await withClient(client => client.rotateSignedKey())
		}
	}
}
