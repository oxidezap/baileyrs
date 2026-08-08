import type { NewsletterMetadataResult } from '@oxidezap/whatsapp-rust-bridge'
import type { NewsletterMetadata, NewsletterViewRole } from '../Types/Newsletter.ts'

/**
 * The bridge spells these the way the core's enums are named, and upstream
 * spells them in screaming case. Written out rather than upper-cased blindly so
 * a variant the core adds later shows up as `undefined` instead of as a string
 * nobody declared.
 */
const VERIFICATION: Record<string, NewsletterMetadata['verification']> = {
	Verified: 'VERIFIED',
	Unverified: 'UNVERIFIED'
}

const VIEW_ROLE: Record<string, NewsletterViewRole> = {
	Owner: 'OWNER',
	Admin: 'ADMIN',
	Subscriber: 'SUBSCRIBER',
	Guest: 'GUEST'
}

/** Upstream's `NewsletterViewRole`, or undefined for a role it does not name. */
export const bridgeNewsletterRoleToBaileys = (role: string | undefined): NewsletterViewRole | undefined =>
	role === undefined ? undefined : VIEW_ROLE[role]

/**
 * Neutral newsletter metadata in upstream's shape.
 *
 * Four upstream fields have no source in the bridge result and stay absent
 * rather than being invented: `owner` (the result carries the viewer's role,
 * not the owner's jid), `mute_state` (the result's `state` is the newsletter's
 * lifecycle, Active/Suspended, not a mute), `reaction_codes`, and
 * `thread_metadata`.
 */
export const bridgeNewsletterMetadataToBaileys = (result: NewsletterMetadataResult): NewsletterMetadata => ({
	id: result.jid,
	name: result.name,
	...(result.description !== undefined ? { description: result.description } : {}),
	...(result.inviteCode !== undefined ? { invite: result.inviteCode } : {}),
	...(result.creationTime !== undefined ? { creation_time: result.creationTime } : {}),
	subscribers: result.subscriberCount,
	...(VERIFICATION[result.verification] !== undefined ? { verification: VERIFICATION[result.verification] } : {}),
	...(result.pictureUrl !== undefined ? { picture: { url: result.pictureUrl } } : {})
})
