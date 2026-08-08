/**
 * Loose ends: bot list, message cap, dirty bits, media connection, and two
 * refusals.
 *
 * The bot list is the one with a real choice in it. Upstream reads only the
 * section the server types `all`; the core refused that reading because the
 * real client walks every section and uses the type for layout, so a bot that
 * appears solely under a category is dropped. This returns everything, and the
 * test proves a category-only bot survives.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { makeServerQueryMethods } from '../Socket/server-queries.ts'
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

const makeHarness = (overrides: Record<string, unknown> = {}) => {
	const calls: Array<[string, unknown[]]> = []
	const client = new Proxy({} as Record<string, unknown>, {
		get: (_t, prop) => {
			if (typeof prop !== 'string' || prop === 'then') return undefined
			if (prop in overrides) return overrides[prop]
			return async (...args: unknown[]) => {
				calls.push([prop, args])
				return undefined
			}
		}
	}) as unknown as WasmWhatsAppClient
	const ctx = {
		ev: new EventEmitter(),
		logger,
		getClient: async () => client
	} as unknown as SocketContext
	return { calls, methods: makeServerQueryMethods(ctx) }
}

describe('getBotListV2 keeps every section rather than only the one typed all', () => {
	const list = {
		version: '3',
		sections: [
			{ sectionType: 'all', bots: [{ jid: 'a@bot', personaId: 'pa', themes: [] }] },
			{
				sectionType: 'category',
				bots: [
					{ jid: 'b@bot', personaId: 'pb', themes: [] },
					// Also in `all`: the same bot, not a second one.
					{ jid: 'a@bot', personaId: 'pa', themes: [] }
				]
			}
		]
	}

	it('a bot that appears only under a category is not dropped', async () => {
		const { methods } = makeHarness({ getBotList: async () => list })

		const bots = await methods.getBotListV2()

		expect(bots).toEqual([
			{ jid: 'a@bot', personaId: 'pa' },
			{ jid: 'b@bot', personaId: 'pb' }
		])
	})

	it('a bot listed in two sections appears once', async () => {
		const { methods } = makeHarness({ getBotList: async () => list })

		const bots = await methods.getBotListV2()

		expect(bots.filter(bot => bot.jid === 'a@bot').length).toBe(1)
	})
})

describe('fetchNewChatMessageCap renames to upstream fields and keeps absences absent', () => {
	it('renames, and stringifies the three timestamps upstream types as strings', async () => {
		const { methods } = makeHarness({
			fetchNewChatMessageCappingInfo: async () => ({
				cappingStatus: 'FIRST_WARNING',
				oteStatus: 'ELIGIBLE',
				mvStatus: 'ACTIVE',
				totalQuota: 100,
				usedQuota: 40,
				remainingQuota: 60,
				cycleStartTimestamp: 1700000000,
				cycleEndTimestamp: 1702000000,
				serverSentTimestamp: 1701000000
			})
		})

		expect(await methods.fetchNewChatMessageCap()).toEqual({
			capping_status: 'FIRST_WARNING',
			ote_status: 'ELIGIBLE',
			mv_status: 'ACTIVE',
			total_quota: 100,
			used_quota: 40,
			remaining_quota: 60,
			cycle_start_timestamp: '1700000000',
			cycle_end_timestamp: '1702000000',
			server_sent_timestamp: '1701000000'
		})
	})

	it('an omitted quota stays omitted, because zero here means the quota is spent', async () => {
		const { methods } = makeHarness({ fetchNewChatMessageCappingInfo: async () => ({ cappingStatus: 'NONE' }) })

		const info = await methods.fetchNewChatMessageCap()

		expect(info).toEqual({ capping_status: 'NONE' })
		expect('total_quota' in info).toBe(false)
	})
})

describe('cleanDirtyBits passes the type through and normalises the timestamp', () => {
	it('sends null when no timestamp was given', async () => {
		const { calls, methods } = makeHarness()

		await methods.cleanDirtyBits('account_sync')

		expect(calls).toEqual([['cleanDirtyBits', ['account_sync', null]]])
	})

	it('accepts the string form upstream allows', async () => {
		const { calls, methods } = makeHarness()

		await methods.cleanDirtyBits('groups', '1700000000')

		expect(calls).toEqual([['cleanDirtyBits', ['groups', 1700000000]]])
	})

	it('rejects a string that is not a number instead of sending NaN', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.cleanDirtyBits('groups', 'yesterday')).rejects.toThrow(/is not a number/)
		expect(calls).toEqual([])
	})
})

describe('refreshMediaConn forwards the force flag and feeds getMediaHost', () => {
	const conn = { auth: 'AUTH', ttl: 3600, hosts: [{ hostname: 'mmg.whatsapp.net' }] }

	it('forcing and not forcing take different arguments', async () => {
		const seen: boolean[] = []
		const { methods } = makeHarness({
			getMediaConn: async (force: boolean) => {
				seen.push(force)
				return conn
			}
		})

		await methods.refreshMediaConn()
		await methods.refreshMediaConn(true)

		expect(seen).toEqual([false, true])
	})

	it('getMediaHost is empty until a refresh, then reports the host', async () => {
		const { methods } = makeHarness({ getMediaConn: async () => conn })

		expect(methods.getMediaHost()).toBe('')
		await methods.refreshMediaConn()
		expect(methods.getMediaHost()).toBe('mmg.whatsapp.net')
	})

	it('carries auth, ttl and a fetch date', async () => {
		const { methods } = makeHarness({ getMediaConn: async () => conn })

		const info = await methods.refreshMediaConn()

		expect(info.auth).toBe('AUTH')
		expect(info.ttl).toBe(3600)
		expect(info.fetchDate instanceof Date).toBe(true)
	})
})

describe('the two refusals say which layer refused and why', () => {
	it('createCallLink names the build decision, not a missing wrapper', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.createCallLink('audio')).rejects.toThrow(/voip feature, which is not compiled/)
		expect(calls).toEqual([])
	})

	it('sendPeerDataOperationMessage points at fetchMessageHistory', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.sendPeerDataOperationMessage({})).rejects.toThrow(/use fetchMessageHistory/)
		expect(calls).toEqual([])
	})
})

describe('server queries do not swallow a bridge failure', () => {
	it('a rejection propagates', async () => {
		const { methods } = makeHarness({
			getBotList: async () => {
				throw new Error('server error 500: internal')
			}
		})

		await expect(methods.getBotListV2()).rejects.toThrow(/server error 500/)
	})
})
