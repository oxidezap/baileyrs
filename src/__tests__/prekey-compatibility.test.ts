import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { ILogger } from '../Utils/logger.ts'
import { makePreKeyMethods } from '../Socket/prekeys.ts'

const errorCalls: unknown[] = []
const logger = {
	error(value: unknown) {
		errorCalls.push(value)
	}
} as unknown as ILogger

describe('pre-key socket compatibility', () => {
	it('delegates explicit and default refresh counts without shadow state', async () => {
		const counts: Array<number | undefined> = []
		const client = {
			refreshPreKeys: async (count?: number) => {
				counts.push(count)
			}
		} as Partial<WasmWhatsAppClient> as WasmWhatsAppClient
		const methods = makePreKeyMethods({ getClient: async () => client, logger })

		await methods.uploadPreKeys()
		await methods.uploadPreKeys(17)

		assert.deepEqual(counts, [5, 17])
	})

	it('delegates validation, conditional replenishment and rotation', async () => {
		const calls: string[] = []
		const client = {
			ensurePreKeys: async () => {
				calls.push('ensure')
			},
			validateKeyBundle: async () => {
				calls.push('validate')
			},
			rotateSignedKey: async () => {
				calls.push('rotate')
			}
		} as Partial<WasmWhatsAppClient> as WasmWhatsAppClient
		const methods = makePreKeyMethods({ getClient: async () => client, logger })

		await methods.uploadPreKeysToServerIfRequired()
		await methods.digestKeyBundle()
		await methods.rotateSignedPreKey()

		assert.deepEqual(calls, ['ensure', 'validate', 'rotate'])
	})

	it('matches initialization semantics by logging conditional replenishment failures', async () => {
		errorCalls.length = 0
		const client = {
			ensurePreKeys: async () => {
				throw new Error('offline')
			}
		} as Partial<WasmWhatsAppClient> as WasmWhatsAppClient
		const methods = makePreKeyMethods({ getClient: async () => client, logger })

		await methods.uploadPreKeysToServerIfRequired()

		assert.equal(errorCalls.length, 1)
	})
})
