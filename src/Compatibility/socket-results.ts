import type {
	BlocklistEntryResult,
	BusinessProfileResult,
	MembershipRequestResult,
	ParticipantChangeResult
} from 'whatsapp-rust-bridge'
import type { BinaryNode, WABusinessHoursConfig, WABusinessProfile } from '../Types/index.ts'

export type ParticipantUpdateResult = {
	status: string
	jid: string | undefined
	content: BinaryNode
}

export type MembershipRequestUpdateResult = {
	status: string
	jid: string | undefined
}

/** Translate the neutral blocklist result without exposing transport metadata. */
export const bridgeBlocklistToBaileys = (entries: readonly BlocklistEntryResult[]): Array<string | undefined> =>
	entries.map(entry => entry.jid)

/** Rebuild the public participant node from the bridge's typed response. */
export const bridgeParticipantChangeToBaileys = (result: ParticipantChangeResult): ParticipantUpdateResult => {
	const attrs: BinaryNode['attrs'] = {
		jid: result.jid,
		...(result.status === undefined ? {} : { type: result.status }),
		...(result.error === undefined ? {} : { error: result.error }),
		...(result.phoneNumber === undefined ? {} : { phone_number: result.phoneNumber }),
		...(result.username === undefined ? {} : { username: result.username })
	}
	const addRequest = result.addRequest
	const content: BinaryNode = {
		tag: 'participant',
		attrs,
		...(addRequest === undefined
			? {}
			: {
					content: [
						{
							tag: 'add_request',
							attrs: { code: addRequest.code, expiration: String(addRequest.expiration) }
						}
					]
				})
	}

	return { status: result.error || '200', jid: result.jid, content }
}

export const bridgeParticipantChangesToBaileys = (
	results: readonly ParticipantChangeResult[]
): ParticipantUpdateResult[] => results.map(bridgeParticipantChangeToBaileys)

export const bridgeMembershipRequestUpdatesToBaileys = (
	results: readonly ParticipantChangeResult[]
): MembershipRequestUpdateResult[] => results.map(result => ({ status: result.error || '200', jid: result.jid }))

/** Preserve the wire attribute names and string values exposed by the public socket. */
export const bridgeMembershipRequestsToBaileys = (
	results: readonly MembershipRequestResult[]
): Array<Record<string, string>> =>
	results.map(result => ({
		jid: result.jid,
		...(result.requestTime === undefined ? {} : { request_time: String(result.requestTime) })
	}))

/** The bridge exposes a full invite URL; the public socket exposes only its code. */
export const bridgeInviteLinkToCode = (value: string | null | undefined): string | undefined => {
	if (!value) return undefined

	const match = /^https?:\/\/chat\.whatsapp\.com\/(?:invite\/)?([^/?#]+)/i.exec(value)
	return match?.[1] || value
}

const bridgeBusinessHoursConfigToBaileys = (
	config: NonNullable<BusinessProfileResult['businessHours']['businessConfig']>[number]
): WABusinessHoursConfig => ({
	day_of_week: config.dayOfWeek,
	mode: config.mode,
	...(config.openTime === undefined ? {} : { open_time: config.openTime }),
	...(config.closeTime === undefined ? {} : { close_time: config.closeTime })
})

/**
 * Translate the neutral business-profile DTO at the public compatibility
 * boundary. The lower layers retain their own field naming and richer category
 * collection; the public socket exposes the established single-category shape.
 */
export const bridgeBusinessProfileToBaileys = (
	profile: BusinessProfileResult | null | undefined
): WABusinessProfile | undefined => {
	if (!profile) return undefined

	const businessConfig = profile.businessHours.businessConfig?.map(bridgeBusinessHoursConfigToBaileys)
	const category = profile.categories[0]?.name

	return {
		description: profile.description,
		email: profile.email,
		business_hours: {
			...(profile.businessHours.timezone === undefined ? {} : { timezone: profile.businessHours.timezone }),
			...(businessConfig === undefined ? {} : { business_config: businessConfig })
		},
		website: [...profile.website],
		...(category === undefined ? {} : { category }),
		...(profile.wid === undefined ? {} : { wid: profile.wid }),
		...(profile.address === undefined ? {} : { address: profile.address })
	}
}
