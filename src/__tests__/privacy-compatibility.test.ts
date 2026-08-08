/**
 * A privacy wrapper is one line, and the only thing that line can get wrong is
 * the category string. Nothing downstream catches that: the bridge takes
 * `category` as a plain `string`, and the core's wire enum has a fallback
 * variant, so a typo travels all the way to the server and changes a different
 * setting on the user's account than the one they asked for.
 *
 * So every wrapper is pinned to its category here, existing ones included.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { makePrivacyMethods } from '../Socket/privacy.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const logger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as ILogger

const makeHarness = (overrides: Partial<WasmWhatsAppClient> = {}) => {
	const calls: Array<[string, string]> = []
	const client = {
		updatePrivacySetting: async (category: string, value: string) => {
			calls.push([category, value])
		},
		...overrides
	} as unknown as WasmWhatsAppClient
	const ctx = {
		ev: new EventEmitter(),
		logger,
		getClient: async () => client
	} as unknown as SocketContext
	return { calls, methods: makePrivacyMethods(ctx) }
}

/** Every wrapper, with the wire category the core matches it to. */
const CATEGORIES: Array<{ method: string; category: string; value: string }> = [
	{ method: 'updateLastSeenPrivacy', category: 'last', value: 'contacts' },
	{ method: 'updateOnlinePrivacy', category: 'online', value: 'match_last_seen' },
	{ method: 'updateProfilePicturePrivacy', category: 'profile', value: 'contacts' },
	{ method: 'updateStatusPrivacy', category: 'status', value: 'contacts' },
	{ method: 'updateReadReceiptsPrivacy', category: 'readreceipts', value: 'all' },
	{ method: 'updateGroupsAddPrivacy', category: 'groupadd', value: 'contacts' },
	{ method: 'updateCallPrivacy', category: 'calladd', value: 'known' },
	{ method: 'updateMessagesPrivacy', category: 'messages', value: 'contacts' }
]

describe('privacy wrappers send the category the core expects', () => {
	for (const { method, category, value } of CATEGORIES) {
		it(`${method} → '${category}'`, async () => {
			const { calls, methods } = makeHarness()

			await (methods as unknown as Record<string, (v: string) => Promise<void>>)[method]!(value)

			expect(calls).toEqual([[category, value]])
		})
	}

	it('the generic passes both arguments through untouched', async () => {
		const { calls, methods } = makeHarness()

		await methods.updatePrivacySetting('defense', 'on_standard')

		expect(calls).toEqual([['defense', 'on_standard']])
	})
})

describe('privacy wrappers do not swallow a bridge failure', () => {
	for (const method of ['updateCallPrivacy', 'updateMessagesPrivacy']) {
		it(`${method} propagates the rejection`, async () => {
			const { methods } = makeHarness({
				updatePrivacySetting: async () => {
					throw new Error('server error 403: forbidden')
				}
			} as Partial<WasmWhatsAppClient>)

			await expect(
				(methods as unknown as Record<string, (v: string) => Promise<void>>)[method]!('all')
			).rejects.toThrow(/server error 403: forbidden/)
		})
	}
})

describe('issuePrivacyTokens refuses instead of issuing a second token', () => {
	it('rejects, and the message says the engine already does it', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.issuePrivacyTokens(['15550000000@s.whatsapp.net'])).rejects.toThrow(
			/issues privacy tokens automatically/
		)
		// Nothing reached the bridge: a rejection that still sent something
		// would be the regression this method exists to avoid.
		expect(calls).toEqual([])
	})
})
