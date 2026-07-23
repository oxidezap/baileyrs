import type { SignalKeyStore, SignalKeyStoreWithTransaction, TransactionCapabilityOptions } from '../../Types/index.ts'
import { addTransactionCapability } from '../public-api/auth-utils.ts'
import type { ILogger } from '../../Utils/logger.ts'

export const hasTransactionCapability = (state: SignalKeyStore): state is SignalKeyStoreWithTransaction =>
	'transaction' in state &&
	typeof state.transaction === 'function' &&
	'isInTransaction' in state &&
	typeof state.isInTransaction === 'function'

/**
 * Lazily exposes the standalone transaction contract without placing its
 * queues or transaction context on the native client's default path.
 */
export const makeLazyTransactionKeyStore = (
	state: SignalKeyStore,
	logger: ILogger,
	options: TransactionCapabilityOptions
): (() => SignalKeyStoreWithTransaction) => {
	let facade: SignalKeyStoreWithTransaction | undefined
	return () => {
		facade ??= hasTransactionCapability(state) ? state : addTransactionCapability(state, logger, options)
		return facade
	}
}
