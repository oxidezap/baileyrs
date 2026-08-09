/**
 * Newsletter delegation and the three signatures that changed shape.
 *
 * The one that matters most is `newsletterMetadata`. Upstream takes
 * `(type, key)`; this package took `(jid)`. Code written against upstream calls
 * `newsletterMetadata('jid', id)`, which the old signature read as a literal
 * JID of `'jid'`. That type checks on the caller's side and fails against the
 * server, which is why it outranks any missing method.
 */

import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { NewsletterMetadataResult, WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { bridgeNewsletterMetadataToBaileys } from '../Compatibility/newsletter-results.ts'
import { makeNewsletterMethods } from '../Socket/newsletter.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const JID = '120363000000000000@newsletter'

const logger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as ILogger

const METADATA: NewsletterMetadataResult = {
	jid: JID,
	name: 'Channel',
	description: 'A channel',
	subscriberCount: 42,
	verification: 'Verified',
	state: 'Active',
	pictureUrl: 'https://example.invalid/pic.jpg',
	inviteCode: 'INVITE123',
	role: 'Owner',
	creationTime: 1700000000
}

const makeHarness = (overrides: Record<string, unknown> = {}) => {
	const calls: Array<[string, unknown[]]> = []
	const client = new Proxy({} as Record<string, unknown>, {
		// `then` must stay undefined or the client reads as a thenable.
		get: (_t, prop) => {
			if (typeof prop !== 'string' || prop === 'then') return undefined
			if (prop in overrides) return overrides[prop]
			return async (...args: unknown[]) => {
				calls.push([prop, args])
				return METADATA
			}
		}
	}) as unknown as WasmWhatsAppClient
	const ctx = {
		ev: new EventEmitter(),
		logger,
		getClient: async () => client
	} as unknown as SocketContext
	return { calls, methods: makeNewsletterMethods(ctx) }
}

describe('newsletterMetadata takes (type, key) and dispatches on the type', () => {
	it("'jid' looks up by jid", async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterMetadata('jid', JID)

		expect(calls).toEqual([['newsletterMetadata', [JID]]])
	})

	it("'invite' takes the invite lookup, which used to be unreachable", async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterMetadata('invite', 'INVITE123')

		expect(calls).toEqual([['newsletterMetadataByInvite', ['INVITE123']]])
	})

	it('an unknown key type rejects rather than being treated as a jid', async () => {
		const { calls, methods } = makeHarness()

		// Same refusal as before, now worded like every other off-domain
		// argument: the parameter, what arrived, and what is accepted.
		await expect(methods.newsletterMetadata('nope' as unknown as 'jid', 'whatever')).rejects.toThrow(
			/newsletterMetadata: "type" must be one of "invite", "jid", received "nope"/
		)
		expect(calls).toEqual([])
	})
})

describe('mute is two operations, as upstream has them', () => {
	it('newsletterMute silences follower activity', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterMute(JID)

		expect(calls).toEqual([['newsletterFollowerMute', [JID, true]]])
	})

	it('newsletterUnmute is the same call with false, not a separate mute', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterUnmute(JID)

		expect(calls).toEqual([['newsletterFollowerMute', [JID, false]]])
	})
})

/** Delegation, one row per method, with the arguments the bridge takes. */
const DELEGATIONS: Array<{
	label: string
	run: (m: ReturnType<typeof makeHarness>['methods']) => Promise<unknown>
	call: [string, unknown[]]
}> = [
	{
		label: 'newsletterCreate',
		run: m => m.newsletterCreate('Name', 'Desc'),
		call: ['newsletterCreate', ['Name', 'Desc']]
	},
	{
		label: 'newsletterCreate without description',
		run: m => m.newsletterCreate('Name'),
		call: ['newsletterCreate', ['Name', null]]
	},
	{ label: 'newsletterFollow', run: m => m.newsletterFollow(JID), call: ['newsletterSubscribe', [JID]] },
	{
		label: 'newsletterSubscribe (kept from before this package grew upstream names)',
		run: m => m.newsletterSubscribe(JID),
		call: ['newsletterSubscribe', [JID]]
	},
	{
		label: 'newsletterUnsubscribe (same)',
		run: m => m.newsletterUnsubscribe(JID),
		call: ['newsletterUnsubscribe', [JID]]
	},
	{ label: 'newsletterUnfollow', run: m => m.newsletterUnfollow(JID), call: ['newsletterUnsubscribe', [JID]] },
	{ label: 'newsletterDelete', run: m => m.newsletterDelete(JID), call: ['newsletterDelete', [JID]] },
	{
		label: 'newsletterChangeOwner',
		run: m => m.newsletterChangeOwner(JID, 'u@s.whatsapp.net'),
		call: ['newsletterChangeOwner', [JID, 'u@s.whatsapp.net']]
	},
	{
		label: 'newsletterDemote',
		run: m => m.newsletterDemote(JID, 'u@s.whatsapp.net'),
		call: ['newsletterDemoteAdmin', [JID, 'u@s.whatsapp.net']]
	},
	{
		label: 'newsletterUpdateName',
		run: m => m.newsletterUpdateName(JID, 'New'),
		call: ['newsletterUpdate', [JID, 'New', null]]
	},
	{
		label: 'newsletterUpdateDescription',
		run: m => m.newsletterUpdateDescription(JID, 'New'),
		call: ['newsletterUpdate', [JID, null, 'New']]
	},
	{
		label: 'newsletterRemovePicture',
		run: m => m.newsletterRemovePicture(JID),
		call: ['newsletterRemovePicture', [JID]]
	},
	{
		label: 'newsletterReactMessage',
		run: m => m.newsletterReactMessage(JID, '17', '👍'),
		call: ['newsletterReactMessage', [JID, '17', '👍']]
	},
	{
		label: 'newsletterReactMessage clearing',
		run: m => m.newsletterReactMessage(JID, '17'),
		call: ['newsletterReactMessage', [JID, '17', null]]
	},
	{
		label: 'newsletterFetchMessages',
		run: m => m.newsletterFetchMessages(JID, 20),
		call: ['newsletterMessages', [JID, 20, null]]
	}
]

describe('the remaining methods delegate with the arguments the bridge takes', () => {
	for (const { label, run, call } of DELEGATIONS) {
		it(label, async () => {
			const { calls, methods } = makeHarness()

			await run(methods)

			expect(calls).toEqual([call])
		})
	}
})

describe('newsletterUpdate dispatches the picture field', () => {
	it('name and description go through the update call', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterUpdate(JID, { name: 'N', description: 'D' })

		expect(calls).toEqual([['newsletterUpdate', [JID, 'N', 'D']]])
	})

	it('an empty picture means remove, as upstream builds it', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterUpdate(JID, { picture: '' })

		// No metadata read: the remove already answers with the refreshed
		// metadata, so fetching it would be a round trip thrown away.
		expect(calls.map(c => c[0])).toEqual(['newsletterRemovePicture'])
	})

	it('a picture-only update does not pay for a metadata read first', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterUpdate(JID, { picture: Buffer.from('x').toString('base64') })

		expect(calls.map(c => c[0])).toEqual(['newsletterSetPicture'])
	})

	it('an empty delta still has to read the metadata to have something to return', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterUpdate(JID, {})

		expect(calls.map(c => c[0])).toEqual(['newsletterMetadata'])
	})

	it('a base64 picture is decoded to bytes, not forwarded as a string', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterUpdate(JID, { picture: Buffer.from('JPEGBYTES').toString('base64') })

		const setCall = calls.find(c => c[0] === 'newsletterSetPicture')!
		expect(Buffer.from(setCall[1][1] as Uint8Array).toString()).toBe('JPEGBYTES')
	})
})

describe('newsletterAdminCount reports an absent count as absent', () => {
	it('returns the count when the server sent one', async () => {
		const { methods } = makeHarness({ newsletterAdminInfo: async () => ({ adminCount: 3 }) })

		expect(await methods.newsletterAdminCount(JID)).toBe(3)
	})

	it('rejects rather than returning 0, which would read as "no admins"', async () => {
		const { methods } = makeHarness({ newsletterAdminInfo: async () => ({}) })

		await expect(methods.newsletterAdminCount(JID)).rejects.toThrow(/did not return an admin count/)
	})
})

describe('newsletterFetchMessages refuses the paging arguments it cannot honour', () => {
	it('`since` rejects instead of being dropped', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.newsletterFetchMessages(JID, 10, 1700000000)).rejects.toThrow(/`since` is not supported/)
		expect(calls).toEqual([])
	})

	it('`after` rejects instead of being mapped to a cursor that pages the other way', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.newsletterFetchMessages(JID, 10, 0, 99)).rejects.toThrow(/`after` is not supported/)
		expect(calls).toEqual([])
	})

	it('zeroes are not a request, so the common (jid, count, 0, 0) call runs', async () => {
		const { calls, methods } = makeHarness()

		await methods.newsletterFetchMessages(JID, 10, 0, 0)

		expect(calls).toEqual([['newsletterMessages', [JID, 10, null]]])
	})
})

/**
 * The two names this package had before it grew upstream's. They kept working
 * through the rename, and they have to keep returning what they returned:
 * their callers were written against the bridge result, not upstream's names.
 */
describe('the legacy subscribe alias returns the bridge result, unrenamed', () => {
	it('newsletterSubscribe answers with jid, subscriberCount and inviteCode', async () => {
		const { methods } = makeHarness()

		const result = await methods.newsletterSubscribe(JID)

		expect(result).toEqual(METADATA)
	})

	it('newsletterFollow is the one that answers in upstream field names', async () => {
		const { methods } = makeHarness()

		const result = await methods.newsletterFollow(JID)

		expect(result.id).toBe(JID)
		expect(result.subscribers).toBe(42)
	})
})

describe('subscribeNewsletterUpdates and newsletterSubscribers shape their results', () => {
	it('the live-update duration comes back as upstream types it, a string', async () => {
		const { methods } = makeHarness({ newsletterSubscribeLiveUpdates: async () => 300 })

		expect(await methods.subscribeNewsletterUpdates(JID)).toEqual({ duration: '300' })
	})

	it('subscribers reads the count off the metadata', async () => {
		const { methods } = makeHarness()

		expect(await methods.newsletterSubscribers(JID)).toEqual({ subscribers: 42 })
	})
})

describe('the neutral metadata is translated into upstream field names', () => {
	it('renames every field upstream expects', async () => {
		expect(bridgeNewsletterMetadataToBaileys(METADATA)).toEqual({
			id: JID,
			name: 'Channel',
			description: 'A channel',
			invite: 'INVITE123',
			creation_time: 1700000000,
			subscribers: 42,
			verification: 'VERIFIED',
			picture: { url: 'https://example.invalid/pic.jpg' }
		})
	})

	it('screams the verification value, which the core spells in camel case', () => {
		expect(bridgeNewsletterMetadataToBaileys({ ...METADATA, verification: 'Unverified' }).verification).toBe(
			'UNVERIFIED'
		)
	})

	it('leaves a verification the core has not named undefined rather than inventing one', () => {
		expect(bridgeNewsletterMetadataToBaileys({ ...METADATA, verification: 'SomethingNew' }).verification).toBe(
			undefined
		)
	})

	it('omits the fields the bridge result has no source for', () => {
		const mapped = bridgeNewsletterMetadataToBaileys(METADATA)

		// `state` is the newsletter's lifecycle, not a mute, so mute_state stays
		// absent rather than being filled from the wrong field.
		expect(mapped.mute_state).toBe(undefined)
		expect(mapped.owner).toBe(undefined)
		expect(mapped.reaction_codes).toBe(undefined)
	})
})

describe('newsletter methods do not swallow a bridge failure', () => {
	it('a rejection propagates', async () => {
		const { methods } = makeHarness({
			newsletterDelete: async () => {
				throw new Error('server error 403: forbidden')
			}
		})

		await expect(methods.newsletterDelete(JID)).rejects.toThrow(/server error 403/)
	})
})
