import { SerialQueue } from '../internal/async-primitives.ts'
import type { SignalDataSet, SignalDataTypeMap, SignalKeyStore } from '../../Types/index.ts'
import type { ILogger } from '../../Utils/logger.ts'

/** Serializes and validates legacy Signal pre-key mutations. */
export class PreKeyManager {
	private readonly queues = new Map<string, SerialQueue>()
	private readonly store: SignalKeyStore
	private readonly logger: ILogger

	constructor(store: SignalKeyStore, logger: ILogger) {
		this.store = store
		this.logger = logger
	}

	private getQueue(keyType: string): SerialQueue {
		let queue = this.queues.get(keyType)
		if (!queue) {
			queue = new SerialQueue()
			this.queues.set(keyType, queue)
		}
		return queue
	}

	async processOperations(
		data: SignalDataSet,
		keyType: keyof SignalDataTypeMap,
		transactionCache: SignalDataSet,
		mutations: SignalDataSet,
		isInTransaction: boolean
	): Promise<void> {
		const keyData = data[keyType]
		if (!keyData) return

		await this.getQueue(keyType).add(async () => {
			transactionCache[keyType] ||= {} as never
			mutations[keyType] ||= {} as never
			const deletions: string[] = []
			const updates: Record<string, unknown> = {}
			for (const keyId in keyData) {
				if (keyData[keyId] === null) deletions.push(keyId)
				else updates[keyId] = keyData[keyId]
			}
			if (Object.keys(updates).length) {
				Object.assign(transactionCache[keyType]!, updates)
				Object.assign(mutations[keyType]!, updates)
			}
			if (deletions.length) {
				await this.processDeletions(keyType, deletions, transactionCache, mutations, isInTransaction)
			}
		})
	}

	private async processDeletions(
		keyType: keyof SignalDataTypeMap,
		ids: string[],
		transactionCache: SignalDataSet,
		mutations: SignalDataSet,
		isInTransaction: boolean
	): Promise<void> {
		if (isInTransaction) {
			for (const keyId of ids) {
				if (transactionCache[keyType]?.[keyId]) {
					transactionCache[keyType]![keyId] = null
					mutations[keyType]![keyId] = null
				} else {
					this.logger.warn(`Skipping deletion of non-existent ${keyType} in transaction: ${keyId}`)
				}
			}
			return
		}

		const existingKeys = await this.store.get(keyType, ids)
		for (const keyId of ids) {
			if (existingKeys[keyId]) {
				transactionCache[keyType]![keyId] = null
				mutations[keyType]![keyId] = null
			} else {
				this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`)
			}
		}
	}

	async validateDeletions(data: SignalDataSet, keyType: keyof SignalDataTypeMap): Promise<void> {
		const keyData = data[keyType]
		if (!keyData) return
		await this.getQueue(keyType).add(async () => {
			const deletionIds = Object.keys(keyData).filter(id => keyData[id] === null)
			if (!deletionIds.length) return
			const existingKeys = await this.store.get(keyType, deletionIds)
			for (const keyId of deletionIds) {
				if (!existingKeys[keyId]) {
					this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`)
					delete data[keyType]![keyId]
				}
			}
		})
	}
}
