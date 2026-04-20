import { describe, it } from 'node:test'
import type { WhatsAppEvent } from 'whatsapp-rust-bridge'
import { adaptBridgeEvent } from '../adapt.ts'
import { expect } from '../../__tests__/expect.ts'
import {
	groupAnnouncementWireFixture,
	groupDemotePascalFixture,
	groupDemoteWireFixture,
	groupNotAnnouncementWireFixture,
	groupPromotePascalFixture,
	groupRevokeWireFixture
} from './fixtures.ts'

describe('adaptBridgeEvent — anti-corruption layer', () => {
	describe('connection lifecycle', () => {
		it('connected → canonical "connected"', () => {
			expect(adaptBridgeEvent({ type: 'connected' } as never)).toEqual({ type: 'connected' })
		})

		it('disconnected → canonical "disconnected"', () => {
			expect(adaptBridgeEvent({ type: 'disconnected' } as never)).toEqual({ type: 'disconnected' })
		})

		it('qr → canonical "qr" with code', () => {
			expect(adaptBridgeEvent({ type: 'qr', data: { code: 'ABC', timeout: 60 } } as never)).toEqual({
				type: 'qr',
				code: 'ABC'
			})
		})

		it('pairing_code collapses to canonical "qr"', () => {
			expect(adaptBridgeEvent({ type: 'pairing_code', data: { code: 'XYZ', timeout: 60 } } as never)).toEqual({
				type: 'qr',
				code: 'XYZ'
			})
		})

		it('pair_success normalizes snake_case to camelCase fields', () => {
			const result = adaptBridgeEvent({
				type: 'pair_success',
				data: { id: '5511999990000@s.whatsapp.net', lid: '100@lid', business_name: 'Acme', platform: 'android' }
			} as never)
			expect(result).toEqual({
				type: 'pairSuccess',
				id: '5511999990000@s.whatsapp.net',
				lid: '100@lid',
				businessName: 'Acme',
				platform: 'android'
			})
		})
	})

	describe('group_update — the PascalCase regression', () => {
		it('captured Demote payload normalizes to canonical "demote"', () => {
			const result = adaptBridgeEvent(groupDemotePascalFixture as unknown as WhatsAppEvent)
			expect(result?.type).toBe('groupUpdate')
			if (result?.type !== 'groupUpdate') throw new Error('narrowing')
			expect(result.action.type).toBe('demote')
			expect(result.groupJid).toBe('120363040237990503@g.us')
			expect(result.author).toBe('236395184570386@lid')
			expect(result.authorPn).toBe('559984726662@s.whatsapp.net')
			expect(result.isLidAddressingMode).toBe(true)
			// ISO timestamp coerced to unix seconds
			expect(result.timestamp).toBe(Math.floor(Date.parse('2026-04-18T05:45:46Z') / 1000))

			if (result.action.type !== 'demote') throw new Error('narrowing')
			expect(result.action.participants).toEqual([
				{ jid: '65546133500078@lid', phoneNumber: '559984246891@s.whatsapp.net' }
			])
		})

		it('captured Promote payload normalizes to canonical "promote"', () => {
			const result = adaptBridgeEvent(groupPromotePascalFixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate' || result.action.type !== 'promote') {
				throw new Error('expected canonical promote')
			}
			expect(result.action.participants[0]!.jid).toBe('65546133500078@lid')
		})

		it('snake_case action.type also passes through (forward-compat with rust fix)', () => {
			const fixture = {
				...groupDemotePascalFixture,
				data: {
					...groupDemotePascalFixture.data,
					action: { ...groupDemotePascalFixture.data.action, type: 'demote' }
				}
			}
			const result = adaptBridgeEvent(fixture as unknown as WhatsAppEvent)
			expect(result?.type === 'groupUpdate' && result.action.type).toBe('demote')
		})

		it('unknown action.type falls back to {type: "unknown", rawType}', () => {
			const fixture = {
				...groupDemotePascalFixture,
				data: { ...groupDemotePascalFixture.data, action: { type: 'BrandNewAction', participants: [] } }
			}
			const result = adaptBridgeEvent(fixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate' || result.action.type !== 'unknown') throw new Error('narrowing')
			expect(result.action.rawType).toBe('BrandNewAction')
		})

		it('subject action carries through with new subject', () => {
			const fixture = {
				type: 'group_update',
				data: {
					group_jid: { user: '123', server: 'g.us' },
					participant: { user: '999', server: 'lid' },
					timestamp: 1_734_000_000,
					is_lid_addressing_mode: false,
					action: {
						type: 'Subject',
						subject: 'New name',
						subject_owner: { user: '999', server: 'lid' },
						subject_time: 1_734_000_000
					}
				}
			}
			const result = adaptBridgeEvent(fixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate' || result.action.type !== 'subject') throw new Error('narrowing')
			expect(result.action.subject).toBe('New name')
			expect(result.action.subjectOwner).toBe('999@lid')
			expect(result.action.subjectTime).toBe(1_734_000_000)
		})

		it('Locked / Unlocked / Announce / NotAnnounce normalize to camelCase', () => {
			const cases: Array<[string, string]> = [
				['Locked', 'locked'],
				['Unlocked', 'unlocked'],
				['Announce', 'announce'],
				['NotAnnounce', 'notAnnounce']
			]
			for (const [raw, canonical] of cases) {
				const fixture = {
					type: 'group_update',
					data: {
						group_jid: { user: '123', server: 'g.us' },
						timestamp: 0,
						is_lid_addressing_mode: false,
						action: { type: raw }
					}
				}
				const result = adaptBridgeEvent(fixture as unknown as WhatsAppEvent)
				if (result?.type !== 'groupUpdate') throw new Error(`expected groupUpdate, got ${result?.type}`)
				expect(result.action.type as string).toBe(canonical)
			}
		})

		it('MembershipApprovalMode preserves enabled flag', () => {
			const fixture = {
				type: 'group_update',
				data: {
					group_jid: { user: '123', server: 'g.us' },
					timestamp: 0,
					is_lid_addressing_mode: false,
					action: { type: 'MembershipApprovalMode', enabled: true }
				}
			}
			const result = adaptBridgeEvent(fixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate' || result.action.type !== 'membershipApprovalMode')
				throw new Error('narrowing')
			expect(result.action.enabled).toBe(true)
		})

		it('rejects malformed payloads (missing group_jid)', () => {
			expect(adaptBridgeEvent({ type: 'group_update', data: { action: { type: 'demote' } } } as never)).toBe(null)
		})
	})

	// Wire-tag fixtures — what the bridge emits today (post whatsapp-rust PR
	// #567). These are the canonical reality the adapter must agree with.
	describe('group_update — wire-tag canonical (post-WireEnum)', () => {
		it('lowercase "demote" payload normalizes to canonical "demote"', () => {
			const result = adaptBridgeEvent(groupDemoteWireFixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate' || result.action.type !== 'demote') throw new Error('narrowing')
			expect(result.action.participants[0]!.jid).toBe('65546133500078@lid')
			expect(result.timestamp).toBe(1_776_490_677)
		})

		it('XML wire tag "announcement" maps to canonical "announce"', () => {
			const result = adaptBridgeEvent(groupAnnouncementWireFixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate') throw new Error('narrowing')
			expect(result.action.type).toBe('announce')
		})

		it('XML wire tag "not_announcement" maps to canonical "notAnnounce"', () => {
			const result = adaptBridgeEvent(groupNotAnnouncementWireFixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate') throw new Error('narrowing')
			expect(result.action.type).toBe('notAnnounce')
		})

		it('XML wire tag "revoke" (was "revoke_invite" pre-#567) maps to canonical "revokeInvite"', () => {
			const result = adaptBridgeEvent(groupRevokeWireFixture as unknown as WhatsAppEvent)
			if (result?.type !== 'groupUpdate') throw new Error('narrowing')
			expect(result.action.type).toBe('revokeInvite')
		})

		it('new variants from PR #567 surface as `unknown` with the wire-tag preserved', () => {
			for (const tag of ['membership_approval_request', 'created_membership_requests', 'revoked_membership_requests']) {
				const result = adaptBridgeEvent({
					type: 'group_update',
					data: {
						group_jid: { user: '120', server: 'g.us' },
						timestamp: 0,
						is_lid_addressing_mode: false,
						action: { type: tag }
					}
				} as unknown as WhatsAppEvent)
				if (result?.type !== 'groupUpdate' || result.action.type !== 'unknown') throw new Error('narrowing')
				expect(result.action.rawType).toBe(tag)
			}
		})
	})

	describe('messages & receipts', () => {
		it('coerces ISO MessageInfo.timestamp to unix seconds', () => {
			const result = adaptBridgeEvent({
				type: 'message',
				data: {
					message: { conversation: 'hi' },
					info: {
						id: 'MSG1',
						timestamp: '2026-04-18T05:00:00Z',
						push_name: 'alice',
						source: {
							chat: { user: '5511', server: 's.whatsapp.net' },
							sender: { user: '5511', server: 's.whatsapp.net' },
							is_from_me: false,
							is_group: false
						}
					}
				}
			} as never)
			if (result?.type !== 'message') throw new Error('narrowing')
			expect(result.timestamp).toBe(Math.floor(Date.parse('2026-04-18T05:00:00Z') / 1000))
			expect(result.id).toBe('MSG1')
			expect(result.chatJid).toBe('5511@s.whatsapp.net')
			expect(result.isGroup).toBe(false)
		})

		it('group message extracts senderJid + participantAlt', () => {
			const result = adaptBridgeEvent({
				type: 'message',
				data: {
					message: { conversation: 'hi' },
					info: {
						id: 'MSG2',
						timestamp: 1_734_000_000,
						source: {
							chat: { user: '120', server: 'g.us' },
							sender: { user: '5511', server: 's.whatsapp.net' },
							sender_alt: { user: '999', server: 'lid' },
							is_from_me: false,
							is_group: true
						}
					}
				}
			} as never)
			if (result?.type !== 'message') throw new Error('narrowing')
			expect(result.senderJid).toBe('5511@s.whatsapp.net')
			expect(result.participantAlt).toBe('999@lid')
		})

		it('receipt collects message_ids and timestamp', () => {
			const result = adaptBridgeEvent({
				type: 'receipt',
				data: {
					message_ids: ['M1', 'M2'],
					timestamp: '2026-04-18T05:00:00Z',
					source: {
						chat: { user: '120', server: 'g.us' },
						sender: { user: '5511', server: 's.whatsapp.net' },
						is_from_me: false,
						is_group: true
					}
				}
			} as never)
			if (result?.type !== 'receipt') throw new Error('narrowing')
			expect(result.messageIds).toEqual(['M1', 'M2'])
			expect(result.chatJid).toBe('120@g.us')
			expect(result.senderJid).toBe('5511@s.whatsapp.net')
			expect(result.isGroup).toBe(true)
			expect(result.timestamp).toBe(Math.floor(Date.parse('2026-04-18T05:00:00Z') / 1000))
		})
	})

	describe('chat state', () => {
		it('archive_update maps to canonical archiveUpdate', () => {
			const result = adaptBridgeEvent({
				type: 'archive_update',
				data: { jid: { user: '5511', server: 's.whatsapp.net' } }
			} as never)
			expect(result).toEqual({ type: 'archiveUpdate', jid: '5511@s.whatsapp.net' })
		})

		it('star_update reads action.starred even when wrapped', () => {
			const result = adaptBridgeEvent({
				type: 'star_update',
				data: {
					chat_jid: { user: '5511', server: 's.whatsapp.net' },
					message_id: 'MID1',
					from_me: true,
					action: { starred: true }
				}
			} as never)
			expect(result).toEqual({
				type: 'starUpdate',
				chatJid: '5511@s.whatsapp.net',
				messageId: 'MID1',
				fromMe: true,
				participantJid: undefined,
				starred: true
			})
		})
	})

	describe('calls', () => {
		it('pre_accept normalizes to camelCase preAccept', () => {
			const result = adaptBridgeEvent({
				type: 'incoming_call',
				data: {
					from: { user: '5511', server: 's.whatsapp.net' },
					stanza_id: 'STZ',
					timestamp: 1_734_000_000,
					offline: false,
					action: { type: 'pre_accept', call_id: 'CID', call_creator: { user: '5511', server: 's.whatsapp.net' } }
				}
			} as never)
			if (result?.type !== 'incomingCall') throw new Error('narrowing')
			expect(result.action.type).toBe('preAccept')
			expect(result.action.callId).toBe('CID')
		})

		it('offer carries callerPn + isVideo', () => {
			const result = adaptBridgeEvent({
				type: 'incoming_call',
				data: {
					from: { user: '5511', server: 's.whatsapp.net' },
					stanza_id: 'STZ',
					timestamp: 1_734_000_000,
					offline: false,
					action: {
						type: 'offer',
						call_id: 'CID2',
						call_creator: { user: '5511', server: 's.whatsapp.net' },
						caller_pn: { user: '5522', server: 's.whatsapp.net' },
						is_video: true,
						joinable: true,
						audio: []
					}
				}
			} as never)
			if (result?.type !== 'incomingCall' || result.action.type !== 'offer') throw new Error('narrowing')
			expect(result.action.callerPn).toBe('5522@s.whatsapp.net')
			expect(result.action.isVideo).toBe(true)
		})
	})

	describe('noop / passthrough', () => {
		it('history_sync collapses to noop', () => {
			expect(adaptBridgeEvent({ type: 'history_sync', data: {} } as never)).toEqual({
				type: 'noop',
				bridgeType: 'history_sync'
			})
		})

		it('raw_node passes through with tag/attrs', () => {
			const node = { tag: 'iq', attrs: { id: 'abc' }, content: undefined }
			const result = adaptBridgeEvent({ type: 'raw_node', data: node } as never)
			expect(result?.type).toBe('rawNode')
		})

		it('truly unknown event types return null (caller drops)', () => {
			expect(adaptBridgeEvent({ type: 'invented_2099', data: {} } as never)).toBe(null)
		})
	})
})
