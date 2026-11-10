/**
 * Real bridge payloads kept verbatim. The PascalCase ones reproduce a
 * legacy-bridge serializer bug (variant names leaked instead of wire tags);
 * the `*WireFixture` ones reproduce what the bridge emits today (the literal
 * XML tag). Both must adapt to the same canonical event.
 */

export const groupDemotePascalFixture = {
	type: 'group_update',
	data: {
		group_jid: { user: '120363040237990503', server: 'g.us', agent: 0, device: 0, integrator: 0 },
		participant: { user: '236395184570386', server: 'lid', agent: 1, device: 0, integrator: 0 },
		participant_pn: { user: '559984726662', server: 's.whatsapp.net', agent: 0, device: 0, integrator: 0 },
		timestamp: '2026-04-18T05:45:46Z',
		is_lid_addressing_mode: true,
		action: {
			type: 'Demote',
			participants: [
				{
					jid: { user: '65546133500078', server: 'lid', agent: 1, device: 0, integrator: 0 },
					phone_number: { user: '559984246891', server: 's.whatsapp.net', agent: 0, device: 0, integrator: 0 }
				}
			]
		}
	}
} as const

export const groupPromotePascalFixture = {
	type: 'group_update',
	data: {
		group_jid: { user: '120363040237990503', server: 'g.us', agent: 0, device: 0, integrator: 0 },
		participant: { user: '236395184570386', server: 'lid', agent: 1, device: 0, integrator: 0 },
		participant_pn: { user: '559984726662', server: 's.whatsapp.net', agent: 0, device: 0, integrator: 0 },
		timestamp: '2026-04-18T05:45:49Z',
		is_lid_addressing_mode: true,
		action: {
			type: 'Promote',
			participants: [
				{
					jid: { user: '65546133500078', server: 'lid', agent: 1, device: 0, integrator: 0 },
					phone_number: { user: '559984246891', server: 's.whatsapp.net', agent: 0, device: 0, integrator: 0 }
				}
			]
		}
	}
} as const

export const groupDemoteWireFixture = {
	type: 'group_update',
	data: {
		group_jid: { user: '120363040237990503', server: 'g.us' },
		participant: { user: '236395184570386', server: 'lid' },
		participant_pn: { user: '559984726662', server: 's.whatsapp.net' },
		timestamp: 1_776_490_677,
		is_lid_addressing_mode: true,
		action: {
			type: 'demote',
			participants: [
				{
					jid: { user: '65546133500078', server: 'lid' },
					phone_number: { user: '559984246891', server: 's.whatsapp.net' }
				}
			]
		}
	}
} as const

/**
 * `Announce`/`NotAnnounce`/`RevokeInvite` are regression targets: the rust
 * variant names diverge from the wire tags (`announcement`/`not_announcement`/
 * `revoke`).
 */
export const groupAnnouncementWireFixture = {
	type: 'group_update',
	data: {
		group_jid: { user: '120363040237990503', server: 'g.us' },
		participant: { user: '236395184570386', server: 'lid' },
		timestamp: 1_776_490_700,
		is_lid_addressing_mode: true,
		action: { type: 'announcement' }
	}
} as const

export const groupNotAnnouncementWireFixture = {
	type: 'group_update',
	data: {
		group_jid: { user: '120363040237990503', server: 'g.us' },
		participant: { user: '236395184570386', server: 'lid' },
		timestamp: 1_776_490_701,
		is_lid_addressing_mode: true,
		action: { type: 'not_announcement' }
	}
} as const

export const groupRevokeWireFixture = {
	type: 'group_update',
	data: {
		group_jid: { user: '120363040237990503', server: 'g.us' },
		participant: { user: '236395184570386', server: 'lid' },
		timestamp: 1_776_490_702,
		is_lid_addressing_mode: true,
		action: { type: 'revoke' }
	}
} as const
