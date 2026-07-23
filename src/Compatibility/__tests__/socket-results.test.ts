import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BusinessProfileResult } from 'whatsapp-rust-bridge'
import {
	bridgeBlocklistToBaileys,
	bridgeBusinessProfileToBaileys,
	bridgeInviteLinkToCode,
	bridgeMembershipRequestsToBaileys,
	bridgeMembershipRequestUpdatesToBaileys,
	bridgeParticipantChangeToBaileys
} from '../socket-results.ts'

describe('socket result compatibility', () => {
	it('projects blocklist entries to the public jid list', () => {
		assert.deepEqual(bridgeBlocklistToBaileys([{ jid: '111@lid', timestamp: 10 }, { jid: '222@lid' }]), [
			'111@lid',
			'222@lid'
		])
	})

	it('maps business profile names and preserves optional hours', () => {
		const profile = {
			wid: '5511999999999@s.whatsapp.net',
			description: 'Laboratório',
			email: 'contact@example.test',
			website: ['https://example.test'],
			categories: [
				{ id: 'cat-1', name: 'Software' },
				{ id: 'cat-2', name: 'Consulting' }
			],
			address: 'Rua 1',
			businessHours: {
				timezone: 'America/Araguaina',
				businessConfig: [
					{ dayOfWeek: 'mon', mode: 'open_24h' },
					{ dayOfWeek: 'tue', mode: 'specific_hours', openTime: 480, closeTime: 1080 }
				]
			}
		} satisfies BusinessProfileResult

		assert.deepEqual(bridgeBusinessProfileToBaileys(profile), {
			wid: '5511999999999@s.whatsapp.net',
			description: 'Laboratório',
			email: 'contact@example.test',
			website: ['https://example.test'],
			category: 'Software',
			address: 'Rua 1',
			business_hours: {
				timezone: 'America/Araguaina',
				business_config: [
					{ day_of_week: 'mon', mode: 'open_24h' },
					{ day_of_week: 'tue', mode: 'specific_hours', open_time: 480, close_time: 1080 }
				]
			}
		})
	})

	it('keeps an absent profile absent', () => {
		assert.equal(bridgeBusinessProfileToBaileys(undefined), undefined)
		assert.equal(bridgeBusinessProfileToBaileys(null), undefined)
	})

	it('reconstructs participant nodes and keeps add-request fallback metadata', () => {
		assert.deepEqual(
			bridgeParticipantChangeToBaileys({
				jid: 'member@lid',
				status: 'member',
				error: '403',
				phoneNumber: '5511999999999@s.whatsapp.net',
				username: 'member.name',
				addRequest: { code: 'INVITE-CODE', expiration: 1_800_000_000 }
			}),
			{
				status: '403',
				jid: 'member@lid',
				content: {
					tag: 'participant',
					attrs: {
						jid: 'member@lid',
						type: 'member',
						error: '403',
						phone_number: '5511999999999@s.whatsapp.net',
						username: 'member.name'
					},
					content: [{ tag: 'add_request', attrs: { code: 'INVITE-CODE', expiration: '1800000000' } }]
				}
			}
		)
	})

	it('maps membership requests and action results to wire-shaped strings', () => {
		assert.deepEqual(
			bridgeMembershipRequestsToBaileys([
				{ jid: 'pending-a@lid', requestTime: 1_750_000_000 },
				{ jid: 'pending-b@lid' }
			]),
			[{ jid: 'pending-a@lid', request_time: '1750000000' }, { jid: 'pending-b@lid' }]
		)
		assert.deepEqual(
			bridgeMembershipRequestUpdatesToBaileys([{ jid: 'pending-a@lid' }, { jid: 'pending-b@lid', error: '403' }]),
			[
				{ jid: 'pending-a@lid', status: '200' },
				{ jid: 'pending-b@lid', status: '403' }
			]
		)
	})

	it('extracts invite codes from bridge URLs without altering raw codes', () => {
		assert.equal(bridgeInviteLinkToCode('https://chat.whatsapp.com/invite/AbCdEf123'), 'AbCdEf123')
		assert.equal(bridgeInviteLinkToCode('https://chat.whatsapp.com/AbCdEf123?source=test'), 'AbCdEf123')
		assert.equal(bridgeInviteLinkToCode('AbCdEf123'), 'AbCdEf123')
		assert.equal(bridgeInviteLinkToCode(undefined), undefined)
	})
})
