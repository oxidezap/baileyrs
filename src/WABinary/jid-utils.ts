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

export enum WAJIDDomains {
	WHATSAPP = 0,
	LID = 1,
	HOSTED = 128,
	HOSTED_LID = 129
}

export type FullJid = {
	user: string
	server: JidServer
	device?: number
	domainType?: number
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

	let domainType = WAJIDDomains.WHATSAPP
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

export const isJidGroup = (jid: string | undefined) => jid?.endsWith('@g.us')
export const isJidStatusBroadcast = (jid: string) => jid === 'status@broadcast'
export const isJidNewsletter = (jid: string | undefined) => jid?.endsWith('@newsletter')
export const isLidUser = (jid: string | undefined) => jid?.endsWith('@lid')
export const isPnUser = (jid: string | undefined) => jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@c.us')
export const isHostedLidUser = (jid: string | undefined) => jid?.endsWith('@hosted.lid')
export const isHostedPnUser = (jid: string | undefined) => jid?.endsWith('@hosted')

export const jidNormalizedUser = (jid: string | undefined) => {
	const result = jidDecode(jid)
	if (!result) {
		return ''
	}

	const { user, server } = result
	return jidEncode(user, server === 'c.us' ? 's.whatsapp.net' : (server as JidServer))
}
