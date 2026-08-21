import { makeNumericEnum } from '../Compatibility/internal/numeric-enum.ts'
import type { WAJIDDomains as WAJIDDomainsType } from '../Compatibility/public-api/enum-types.ts'

export const S_WHATSAPP_NET = '@s.whatsapp.net'
export const OFFICIAL_BIZ_JID = '16505361212@c.us'
export const SERVER_JID = 'server@c.us'
export const PSA_WID = '0@c.us'
export const STORIES_JID = 'status@broadcast'
export const META_AI_JID = '13135550002@c.us'

export type JidServer =
	| 'c.us'
	| 'g.us'
	| 'broadcast'
	| 's.whatsapp.net'
	| 'call'
	| 'lid'
	| 'newsletter'
	| 'bot'
	| 'hosted'
	| 'hosted.lid'

const WAJIDDomainValues = {
	WHATSAPP: 0,
	LID: 1,
	HOSTED: 128,
	HOSTED_LID: 129
} as const
export const WAJIDDomains = makeNumericEnum(WAJIDDomainValues) as unknown as typeof WAJIDDomainsType
export type WAJIDDomains = WAJIDDomainsType

export type JidWithDevice = {
	user: string
	device?: number
}

export type FullJid = JidWithDevice & {
	server: JidServer
	domainType?: number
}

export const getServerFromDomainType = (initialServer: string, domainType?: WAJIDDomains): JidServer => {
	switch (domainType) {
		case WAJIDDomains.LID:
			return 'lid'
		case WAJIDDomains.HOSTED:
			return 'hosted'
		case WAJIDDomains.HOSTED_LID:
			return 'hosted.lid'
		case WAJIDDomains.WHATSAPP:
		default:
			return initialServer as JidServer
	}
}

export const jidEncode = (user: string | number | null, server: JidServer, device?: number, agent?: number) => {
	return `${user || ''}${agent ? `_${agent}` : ''}${device ? `:${device}` : ''}@${server}`
}

export const jidDecode = (jid: string | undefined): FullJid | undefined => {
	const sepIdx = typeof jid === 'string' ? jid.indexOf('@') : -1
	if (sepIdx < 0) {
		return undefined
	}

	const server = jid!.slice(sepIdx + 1)
	const userCombined = jid!.slice(0, sepIdx)

	const [userAgent, device] = userCombined.split(':')
	const [user, agent] = userAgent!.split('_')

	let domainType: number = WAJIDDomains.WHATSAPP
	if (server === 'lid') {
		domainType = WAJIDDomains.LID
	} else if (server === 'hosted') {
		domainType = WAJIDDomains.HOSTED
	} else if (server === 'hosted.lid') {
		domainType = WAJIDDomains.HOSTED_LID
	} else if (agent) {
		domainType = parseInt(agent)
	}

	return {
		server: server as JidServer,
		user: user!,
		domainType,
		device: device ? +device : undefined
	}
}

const CHAR_DEVICE_SEP = 58 // ':'
const CHAR_AGENT_SEP = 95 // '_'

/**
 * Index at which the user component ends, given the index of the '@'.
 *
 * `jidDecode` derives the user by splitting the pre-`@` half on ':' and then on
 * '_', so the user always runs to whichever of ':' or '_' comes first, and to
 * the '@' when neither is there. Locating that boundary answers both callers
 * below without the intermediate arrays and result object `jidDecode` allocates.
 */
const userEndBefore = (jid: string, sepIdx: number): number => {
	for (let i = 0; i < sepIdx; i++) {
		const code = jid.charCodeAt(i)
		if (code === CHAR_DEVICE_SEP || code === CHAR_AGENT_SEP) {
			return i
		}
	}

	return sepIdx
}

/** As above, or -1 when the JID has no server part: the case `jidDecode` reports as `undefined`. */
const userEnd = (jid: string): number => {
	const sepIdx = jid.indexOf('@')
	return sepIdx < 0 ? -1 : userEndBefore(jid, sepIdx)
}

/** Compare the user component of two JIDs, matching upstream Baileys. */
export const areJidsSameUser = (jid1: string | undefined, jid2: string | undefined) => {
	// Same answer as comparing `jidDecode(...)?.user`, compared in place: this
	// runs once per participant check on the message pipeline, and decoding both
	// sides allocated four arrays and two objects only to throw them away.
	const end = typeof jid1 === 'string' ? userEnd(jid1) : -1
	if (end !== (typeof jid2 === 'string' ? userEnd(jid2) : -1)) {
		return false
	}

	// Neither side decodes, so upstream compares `undefined === undefined`.
	if (end < 0) {
		return true
	}

	const left = jid1 as string
	const right = jid2 as string
	for (let i = 0; i < end; i++) {
		if (left.charCodeAt(i) !== right.charCodeAt(i)) {
			return false
		}
	}

	return true
}

export const isJidMetaAI = (jid: string | undefined) => jid?.endsWith('@bot')
export const isPnUser = (jid: string | undefined) => jid?.endsWith('@s.whatsapp.net')
export const isLidUser = (jid: string | undefined) => jid?.endsWith('@lid')
export const isJidBroadcast = (jid: string | undefined) => jid?.endsWith('@broadcast')
export const isJidGroup = (jid: string | undefined) => jid?.endsWith('@g.us')
export const isJidStatusBroadcast = (jid: string) => jid === 'status@broadcast'
export const isJidNewsletter = (jid: string | undefined) => jid?.endsWith('@newsletter')
export const isHostedLidUser = (jid: string | undefined) => jid?.endsWith('@hosted.lid')
export const isHostedPnUser = (jid: string | undefined) => jid?.endsWith('@hosted')

const botRegexp = /^1313555\d{4}$|^131655500\d{2}$/

export const isJidBot = (jid: string | undefined) => jid && botRegexp.test(jid.split('@')[0]!) && jid.endsWith('@c.us')

export const jidNormalizedUser = (jid: string | undefined) => {
	if (typeof jid !== 'string') {
		return ''
	}

	const sepIdx = jid.indexOf('@')
	if (sepIdx < 0) {
		return ''
	}

	// Everything between the user and the '@' is exactly what normalization
	// drops, so the boundary is all this needs. `jidDecode` would split the same
	// half twice and box the pieces in an object only for them to be re-joined.
	const end = userEndBefore(jid, sepIdx)

	// Fast path for the shape that dominates the pipeline: nothing to strip and a
	// server `jidEncode` re-emits verbatim, so the JID already is its own normal
	// form and no new string has to be built at all.
	if (end === sepIdx && !jid.endsWith('@c.us')) {
		return jid
	}

	const server = jid.slice(sepIdx + 1)
	return jidEncode(jid.slice(0, end), server === 'c.us' ? 's.whatsapp.net' : (server as JidServer))
}

export const transferDevice = (fromJid: string, toJid: string): string => {
	const deviceId = jidDecode(fromJid)?.device || 0
	const { server, user } = jidDecode(toJid)!
	return jidEncode(user, server, deviceId)
}
