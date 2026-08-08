import type { BotListResult, NewChatMessageCappingResult } from '@oxidezap/whatsapp-rust-bridge'
import type { BotListInfo } from '../Types/Chat.ts'
import type { NewChatMessageCapInfo } from '../Types/State.ts'
import type { MediaConnInfo } from '../Types/Message.ts'
import { Boom } from '../Utils/boom.ts'
import type { SocketContext } from './types.ts'

/**
 * Every section, flattened and deduplicated, rather than only the section the
 * server types `all`.
 *
 * Upstream reads that one section, and the core deliberately refused to: the
 * real client walks every section and uses the type only for layout, so a bot
 * that appears solely under a category is dropped by the narrower reading. A
 * caller iterating this list handles the extra entries; one that silently lost
 * a bot has no way to notice.
 */
const flattenBotList = (list: BotListResult): BotListInfo[] => {
	const seen = new Set<string>()
	const bots: BotListInfo[] = []
	for (const section of list.sections) {
		for (const bot of section.bots) {
			if (seen.has(bot.jid)) continue
			seen.add(bot.jid)
			bots.push({ jid: bot.jid, personaId: bot.personaId })
		}
	}
	return bots
}

/**
 * Upstream names these in snake case and types the three timestamps as
 * strings. Every field is optional because the server omits whatever does not
 * apply to the account's tier, and an absent quota stays absent: `0` here means
 * the quota is spent.
 */
const toCapInfo = (result: NewChatMessageCappingResult): NewChatMessageCapInfo & { remaining_quota?: number } => ({
	...(result.totalQuota !== undefined ? { total_quota: result.totalQuota } : {}),
	...(result.usedQuota !== undefined ? { used_quota: result.usedQuota } : {}),
	...(result.remainingQuota !== undefined ? { remaining_quota: result.remainingQuota } : {}),
	...(result.cycleStartTimestamp !== undefined ? { cycle_start_timestamp: String(result.cycleStartTimestamp) } : {}),
	...(result.cycleEndTimestamp !== undefined ? { cycle_end_timestamp: String(result.cycleEndTimestamp) } : {}),
	...(result.serverSentTimestamp !== undefined ? { server_sent_timestamp: String(result.serverSentTimestamp) } : {}),
	...(result.oteStatus !== undefined ? { ote_status: result.oteStatus as NewChatMessageCapInfo['ote_status'] } : {}),
	...(result.mvStatus !== undefined ? { mv_status: result.mvStatus as NewChatMessageCapInfo['mv_status'] } : {}),
	...(result.cappingStatus !== undefined
		? { capping_status: result.cappingStatus as NewChatMessageCapInfo['capping_status'] }
		: {})
})

export const makeServerQueryMethods = (ctx: SocketContext) => {
	/** Last host seen, so the synchronous accessor upstream exposes can answer. */
	let mediaHost = ''
	/**
	 * When the credentials were obtained, not when they were last handed out.
	 * The engine serves a live connection from its cache and gives no signal
	 * for which calls were actual fetches, so the stamp is kept only while the
	 * connection it describes is still live: past its own ttl, on a forced
	 * call, or on rotated credentials, whatever comes back is a fetch.
	 *
	 * A caller renewing on `fetchDate + ttl` needs both halves of that. Always
	 * restamping would push its deadline forward forever; never restamping
	 * would leave it renewing against a moment that has already passed.
	 */
	let fetched: { auth: string; ttl: number; at: Date } | undefined
	const isLive = (held: { ttl: number; at: Date }) => Date.now() - held.at.getTime() < held.ttl * 1000

	return {
		/**
		 * `maxContentLengthBytes` is absent by design: the core's hosts carry
		 * nothing but a hostname, so the field upstream declares has no source
		 * and is not invented here.
		 */
		refreshMediaConn: async (
			forceGet = false
		): Promise<Omit<MediaConnInfo, 'hosts'> & { hosts: { hostname: string }[] }> => {
			// Forced on the first call, as upstream's first call is: the engine may
			// already hold a connection acquired by an upload, and stamping that
			// one as fetched now would report it fresher than it is.
			const held = fetched
			const conn = await (await ctx.getClient()).getMediaConn(forceGet || !held)
			mediaHost = conn.hosts[0]?.hostname ?? mediaHost
			const isFetch = forceGet || !held || held.auth !== conn.auth || !isLive(held)
			fetched = isFetch ? { auth: conn.auth, ttl: conn.ttl, at: new Date() } : held
			// A copy: the stored instant decides when the next call restamps, and a
			// consumer holding the same Date could move it.
			return { auth: conn.auth, ttl: conn.ttl, hosts: conn.hosts, fetchDate: new Date(fetched.at) }
		},

		/** Synchronous, as upstream has it, so it reads what the last refresh saw. */
		getMediaHost: (): string => mediaHost,

		getBotListV2: async (): Promise<BotListInfo[]> => {
			return flattenBotList(await (await ctx.getClient()).getBotList())
		},

		fetchNewChatMessageCap: async () => {
			return toCapInfo(await (await ctx.getClient()).fetchNewChatMessageCappingInfo())
		},

		cleanDirtyBits: async (type: 'account_sync' | 'groups', fromTimestamp?: number | string): Promise<void> => {
			let timestamp: number | null = null
			if (fromTimestamp !== undefined) {
				// A blank string is not a timestamp, and `Number('')` is the epoch,
				// so without this a caller meaning "no timestamp" would ask the
				// server to clean from the beginning of time.
				const blank = typeof fromTimestamp === 'string' && fromTimestamp.trim() === ''
				timestamp = typeof fromTimestamp === 'string' ? Number(fromTimestamp) : fromTimestamp
				if (blank || !Number.isFinite(timestamp)) {
					throw new Boom(`cleanDirtyBits: fromTimestamp '${fromTimestamp}' is not a number`, { statusCode: 400 })
				}
			}
			await (await ctx.getClient()).cleanDirtyBits(type, timestamp)
		},

		/**
		 * Refused rather than wired up. The core already fires a peer data
		 * request itself when a message fails to decrypt, with its own age
		 * policy, so a second one here would duplicate it. The request a
		 * consumer actually drives, asking for history, is `fetchMessageHistory`.
		 */
		sendPeerDataOperationMessage: async (_pdoMessage: unknown): Promise<never> => {
			throw new Boom(
				'sendPeerDataOperationMessage is not supported: use fetchMessageHistory to request history, and note the engine issues its own peer data request when a message fails to decrypt',
				{ statusCode: 501 }
			)
		},

		/**
		 * Refused one layer down, as a build decision. `create_call_link` exists
		 * in the core behind its voip feature, and the bridge pins the core with
		 * default features off, so it is not compiled into the wasm artifact at
		 * all. Reaching it would pull the webrtc stack into the bundle.
		 */
		createCallLink: async (_type: 'audio' | 'video', _event?: unknown, _timeoutMs?: number): Promise<never> => {
			throw new Boom(
				'createCallLink is not available: the call-link operation sits behind the core voip feature, which is not compiled into the wasm bridge',
				{ statusCode: 501 }
			)
		}
	}
}
