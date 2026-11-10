import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import type { SocketContext } from './types.ts'

export const PROFILE_PICTURE_TYPES = ['preview', 'image'] as const

export type ProfilePictureType = (typeof PROFILE_PICTURE_TYPES)[number]

export type OnWhatsAppResult = {
	exists: boolean
	jid: string
	lid?: string
	/** PN counterpart, present when the server returned a LID as primary JID. */
	pnJid?: string
	isBusiness?: boolean
	/** Verified business name (from usync `<business><verified_name>`), present for verified businesses. */
	verifiedName?: string
}

export const makeContactMethods = (ctx: SocketContext) => {
	return {
		onWhatsApp: async (...phoneNumber: string[]): Promise<OnWhatsAppResult[] | undefined> => {
			return ctx.withClient(async client => {
				// Single batched usync — the bridge splits PN/LID inputs internally and
				// returns lid/pnJid/isBusiness in the same payload, so no secondary IQ.
				const results = await client.isOnWhatsApp(phoneNumber)
				return results.map(r => {
					const out: OnWhatsAppResult = { exists: r.isRegistered, jid: r.jid, isBusiness: r.isBusiness }
					if (r.lid) out.lid = r.lid
					if (r.pnJid) out.pnJid = r.pnJid
					if (r.verifiedName) out.verifiedName = r.verifiedName
					return out
				})
			})
		},

		profilePictureUrl: async (jid: string, type: ProfilePictureType = 'preview', timeoutMs?: number) => {
			assertArgumentDomain('profilePictureUrl', 'type', type, PROFILE_PICTURE_TYPES)
			const result = await ctx.withClient(client => client.profilePictureUrl(jid, type, timeoutMs))
			return result?.url
		},

		fetchUserInfo: async (...jids: string[]) => {
			return await ctx.withClient(client => client.fetchUserInfo(jids))
		}
	}
}
