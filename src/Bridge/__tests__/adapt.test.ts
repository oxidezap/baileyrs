import { describe, it } from 'node:test'
import type { MessageWireInfo, WhatsAppEvent } from '@oxidezap/whatsapp-rust-bridge'
import { adaptBridgeEvent, adaptBridgeMessageWire } from '../adapt.ts'
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

		it('new pairing lifecycle events are acknowledged explicitly', () => {
			expect(adaptBridgeEvent({ type: 'pairing_code_refresh', data: { force_manual: true } } as never)).toEqual({
				type: 'noop',
				bridgeType: 'pairing_code_refresh',
				detail: 'force_manual'
			})
			expect(adaptBridgeEvent({ type: 'pair_passkey_request', data: { request_options_json: '{}' } } as never)).toEqual(
				{ type: 'noop', bridgeType: 'pair_passkey_request' }
			)
			expect(
				adaptBridgeEvent({
					type: 'pair_passkey_confirmation',
					data: { code: 'ABCD-EFGH', skip_handoff_ux: false }
				} as never)
			).toEqual({
				type: 'noop',
				bridgeType: 'pair_passkey_confirmation',
				detail: 'confirmation_required'
			})
			expect(
				adaptBridgeEvent({ type: 'pair_passkey_error', data: { error: 'denied', continuation: false } } as never)
			).toEqual({ type: 'noop', bridgeType: 'pair_passkey_error', detail: 'denied' })
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

	describe('dirty state', () => {
		it('normalizes the typed dirty marker', () => {
			expect(
				adaptBridgeEvent({
					type: 'dirty_state',
					data: { dirty_type: 'groups', timestamp: 1_725_000_000 }
				} as never)
			).toEqual({ type: 'dirtyState', dirtyType: 'groups', timestamp: 1_725_000_000 })
		})

		it('rejects a dirty marker without a type', () => {
			expect(adaptBridgeEvent({ type: 'dirty_state', data: { dirty_type: '' } } as never)).toBe(null)
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

		it('PR #567 join-request variants narrow to canonical membership* / revoked* shapes', () => {
			const expected = {
				membership_approval_request: 'membershipApprovalRequest',
				created_membership_requests: 'createdMembershipRequests',
				revoked_membership_requests: 'revokedMembershipRequests'
			} as const
			for (const [tag, canonical] of Object.entries(expected)) {
				const result = adaptBridgeEvent({
					type: 'group_update',
					data: {
						group_jid: { user: '120', server: 'g.us' },
						timestamp: 0,
						is_lid_addressing_mode: false,
						action: { type: tag }
					}
				} as unknown as WhatsAppEvent)
				if (result?.type !== 'groupUpdate') throw new Error('narrowing')
				expect(result.action.type).toBe(canonical)
			}
		})
	})

	describe('messages & receipts', () => {
		it('maps the compact wire envelope without changing message semantics', () => {
			const info: MessageWireInfo = {
				chat: '120@g.us',
				sender: '5511@s.whatsapp.net',
				senderAlt: '999@lid',
				isFromMe: false,
				isGroup: true,
				id: 'WIRE1',
				timestamp: 1_734_000_000,
				pushName: 'alice',
				isViewOnce: true,
				isOffline: true,
				unavailableRequestId: 'PDO-1',
				edit: '1'
			}
			const result = adaptBridgeMessageWire({ conversation: 'hi' }, info)
			expect(result).toEqual({
				type: 'message',
				chatJid: '120@g.us',
				senderJid: '5511@s.whatsapp.net',
				isGroup: true,
				isFromMe: false,
				id: 'WIRE1',
				timestamp: 1_734_000_000,
				pushName: 'alice',
				participantAlt: '999@lid',
				remoteJidAlt: undefined,
				isViewOnce: true,
				isOffline: true,
				unavailableRequestId: 'PDO-1',
				editAttribute: '1',
				messageProto: { conversation: 'hi' }
			})
		})

		it('maps compact outgoing DM recipient alternates to remoteJidAlt', () => {
			const result = adaptBridgeMessageWire(
				{ conversation: 'hi' },
				{
					chat: '5511@s.whatsapp.net',
					sender: '111@lid',
					recipientAlt: '222@lid',
					isFromMe: true,
					isGroup: false,
					id: 'WIRE2',
					timestamp: 1_734_000_000,
					pushName: '',
					isViewOnce: false,
					isOffline: false
				}
			)
			expect(result?.senderJid).toBeUndefined()
			expect(result?.participantAlt).toBeUndefined()
			expect(result?.remoteJidAlt).toBe('222@lid')
			expect(result?.isViewOnce).toBeUndefined()
			expect(result?.isOffline).toBeUndefined()
		})

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
			// Group has no remoteJidAlt (the group JID has no alternate form).
			expect(result.remoteJidAlt).toBeUndefined()
		})

		// Incoming DM: the chat IS the partner, and the partner's alternate
		// address is exposed by the core as `sender_alt` (read from the stanza's
		// sender_pn/sender_lid). It must surface as `remoteJidAlt`. Regression:
		// it used to be read from `recipient_alt`, which the core never fills for
		// incoming messages, so DMs never got a remoteJidAlt.
		it('incoming DM maps sender_alt → remoteJidAlt (not participantAlt)', () => {
			const result = adaptBridgeEvent({
				type: 'message',
				data: {
					message: { conversation: 'hi' },
					info: {
						id: 'DM1',
						timestamp: 1_734_000_000,
						source: {
							chat: { user: '259829012635749', server: 'lid' },
							sender: { user: '259829012635749', server: 'lid' },
							sender_alt: { user: '6283164859390', server: 's.whatsapp.net' },
							is_from_me: false,
							is_group: false
						}
					}
				}
			} as never)
			if (result?.type !== 'message') throw new Error('narrowing')
			expect(result.remoteJidAlt).toBe('6283164859390@s.whatsapp.net')
			expect(result.participantAlt).toBeUndefined()
			expect(result.senderJid).toBeUndefined() // DMs carry no senderJid
		})

		// Outgoing DM: the partner is the recipient, whose alternate lives in
		// `recipient_alt`. (The core only populates this for outgoing messages.)
		it('outgoing DM maps recipient_alt → remoteJidAlt', () => {
			const result = adaptBridgeEvent({
				type: 'message',
				data: {
					message: { conversation: 'hi' },
					info: {
						id: 'DM2',
						timestamp: 1_734_000_000,
						source: {
							chat: { user: '6283164859390', server: 's.whatsapp.net' },
							sender: { user: '111', server: 'lid' },
							recipient_alt: { user: '259829012635749', server: 'lid' },
							is_from_me: true,
							is_group: false
						}
					}
				}
			} as never)
			if (result?.type !== 'message') throw new Error('narrowing')
			expect(result.isFromMe).toBe(true)
			expect(result.remoteJidAlt).toBe('259829012635749@lid')
			expect(result.participantAlt).toBeUndefined()
		})

		// An incoming DM without any alternate (no sender_alt) must NOT crash and
		// must leave remoteJidAlt undefined — the field is genuinely optional.
		it('incoming DM with no alternate leaves remoteJidAlt undefined', () => {
			const result = adaptBridgeEvent({
				type: 'message',
				data: {
					message: { conversation: 'hi' },
					info: {
						id: 'DM3',
						timestamp: 1_734_000_000,
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
			expect(result.remoteJidAlt).toBeUndefined()
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

		it('infers a group receipt from its canonical group JID when is_group is stale', () => {
			const result = adaptBridgeEvent({
				type: 'receipt',
				data: {
					message_ids: ['GROUP-ACK'],
					timestamp: 1_734_000_000,
					source: {
						chat: { user: '120', server: 'g.us' },
						sender: { user: '5511', server: 's.whatsapp.net' },
						is_from_me: false,
						is_group: false
					}
				}
			} as never)
			if (result?.type !== 'receipt') throw new Error('narrowing')
			expect(result.isGroup).toBe(true)
			expect(result.senderJid).toBe('5511@s.whatsapp.net')
		})
	})

	describe('chat state', () => {
		it('archive_update maps to canonical archiveUpdate (default archived=true)', () => {
			const result = adaptBridgeEvent({
				type: 'archive_update',
				data: { jid: { user: '5511', server: 's.whatsapp.net' } }
			} as never)
			expect(result).toEqual({ type: 'archiveUpdate', jid: '5511@s.whatsapp.net', archived: true })
		})

		it('archive_update propagates action.archived=false (unarchive)', () => {
			const result = adaptBridgeEvent({
				type: 'archive_update',
				data: { jid: { user: '5511', server: 's.whatsapp.net' }, action: { archived: false } }
			} as never)
			expect(result).toEqual({ type: 'archiveUpdate', jid: '5511@s.whatsapp.net', archived: false })
		})

		it('label_edit_update maps to canonical labelEdit (predefinedId stringified)', () => {
			const result = adaptBridgeEvent({
				type: 'label_edit_update',
				data: {
					label_id: '7',
					action: { name: 'Clientes', color: 3, deleted: false, predefinedId: 2 }
				}
			} as never)
			expect(result).toEqual({
				type: 'labelEdit',
				labelId: '7',
				name: 'Clientes',
				color: 3,
				deleted: false,
				predefinedId: '2'
			})
		})

		it('label_edit_update tolerates a sparse action (typed defaults, no undefined leaks)', () => {
			const result = adaptBridgeEvent({
				type: 'label_edit_update',
				data: { label_id: '7', action: { deleted: true } }
			} as never)
			expect(result).toEqual({
				type: 'labelEdit',
				labelId: '7',
				name: '',
				color: 0,
				deleted: true,
				predefinedId: undefined
			})
		})

		it('label_association_update maps add/remove from action.labeled', () => {
			const add = adaptBridgeEvent({
				type: 'label_association_update',
				data: {
					label_id: '7',
					chat_jid: { user: '5511', server: 's.whatsapp.net' },
					action: { labeled: true }
				}
			} as never)
			expect(add).toEqual({
				type: 'labelAssociation',
				labelId: '7',
				chatJid: '5511@s.whatsapp.net',
				labeled: true
			})

			const remove = adaptBridgeEvent({
				type: 'label_association_update',
				data: {
					label_id: '7',
					chat_jid: { user: '5511', server: 's.whatsapp.net' },
					action: { labeled: false }
				}
			} as never)
			expect(remove).toEqual({
				type: 'labelAssociation',
				labelId: '7',
				chatJid: '5511@s.whatsapp.net',
				labeled: false
			})
		})

		it('clear_chat_update maps to chatClear (messages.delete all) and noops without a jid', () => {
			expect(
				adaptBridgeEvent({
					type: 'clear_chat_update',
					data: { jid: { user: '5511', server: 's.whatsapp.net' } }
				} as never)
			).toEqual({ type: 'chatClear', jid: '5511@s.whatsapp.net' })
			expect(adaptBridgeEvent({ type: 'clear_chat_update', data: {} } as never)).toEqual({
				type: 'noop',
				bridgeType: 'clear_chat_update'
			})
		})

		it('user_status_mute_update is a documented noop (no Baileys counterpart)', () => {
			expect(adaptBridgeEvent({ type: 'user_status_mute_update', data: {} } as never)).toEqual({
				type: 'noop',
				bridgeType: 'user_status_mute_update'
			})
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
		it('pre_accept normalizes to the upstream preaccept status', () => {
			const result = adaptBridgeEvent({
				type: 'incoming_call',
				data: {
					from: { user: '5511', server: 's.whatsapp.net', device: 7 },
					stanza_id: 'STZ',
					timestamp: 1_734_000_000,
					offline: false,
					action: {
						type: 'pre_accept',
						call_id: 'CID',
						call_creator: { user: '5522', server: 's.whatsapp.net', device: 3 }
					}
				}
			} as never)
			if (result?.type !== 'incomingCall') throw new Error('narrowing')
			expect(result.action.type).toBe('preaccept')
			expect(result.action.callId).toBe('CID')
			expect(result.from).toBe('5511:7@s.whatsapp.net')
			expect(result.action.callCreator).toBe('5522:3@s.whatsapp.net')
		})

		it('preserves transport and relay-latency signaling statuses', () => {
			for (const [bridgeType, expected] of [
				['transport', 'transport'],
				['relay_latency', 'relaylatency']
			] as const) {
				const result = adaptBridgeEvent({
					type: 'incoming_call',
					data: {
						from: { user: '5511', server: 's.whatsapp.net' },
						stanza_id: 'STZ',
						timestamp: 1_734_000_000,
						offline: false,
						action: {
							type: bridgeType,
							call_id: 'CID-SIGNAL',
							call_creator: { user: '5511', server: 's.whatsapp.net' }
						}
					}
				} as never)
				if (result?.type !== 'incomingCall') throw new Error('narrowing')
				expect(result.action.type).toBe(expected)
			}
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

		it('missed_call maps to the Baileys timeout call status', () => {
			const result = adaptBridgeEvent({
				type: 'missed_call',
				data: {
					from: { user: '5511', server: 's.whatsapp.net' },
					call_id: 'MISSED-1',
					timestamp: 1_734_000_000,
					reason: 'offline'
				}
			} as never)
			if (result?.type !== 'incomingCall') throw new Error('narrowing')
			expect(result.offline).toBe(true)
			expect(result.action).toEqual({ type: 'timeout', callId: 'MISSED-1' })
		})

		it('call_ended_elsewhere maps its terminal outcome', () => {
			const result = adaptBridgeEvent({
				type: 'call_ended_elsewhere',
				data: {
					from: { user: '5511', server: 's.whatsapp.net' },
					call_id: 'ELSEWHERE-1',
					timestamp: 1_734_000_000,
					outcome: 'accepted'
				}
			} as never)
			if (result?.type !== 'incomingCall') throw new Error('narrowing')
			expect(result.action).toEqual({ type: 'accept', callId: 'ELSEWHERE-1' })
		})
	})

	describe('noop / passthrough', () => {
		it('offline_sync_completed preserves the drained item count', () => {
			expect(adaptBridgeEvent({ type: 'offline_sync_completed', data: { count: 17 } } as never)).toEqual({
				type: 'offlineSyncCompleted',
				count: 17
			})
		})

		it('server_ack preserves the typed fields needed by the internal ACK handler', () => {
			expect(
				adaptBridgeEvent({
					type: 'server_ack',
					data: {
						id: 'ACK-1',
						class: 'message',
						from: { user: '5511', server: 's.whatsapp.net' },
						timestamp: 1_734_000_000,
						error: '479'
					}
				} as never)
			).toEqual({
				type: 'serverAck',
				id: 'ACK-1',
				class: 'message',
				from: '5511@s.whatsapp.net',
				timestamp: 1_734_000_000,
				error: '479'
			})
		})

		it('history_sync with empty payload yields an empty historySync canonical', () => {
			// Bridge change moved this off the noop path. With an empty
			// proto we still produce a CanonicalHistorySync with empty
			// arrays — the dispatcher emits messaging-history.set unchanged.
			expect(adaptBridgeEvent({ type: 'history_sync', data: {} } as never)).toEqual({
				type: 'historySync',
				chats: [],
				contacts: [],
				messages: [],
				lidPnMappings: [],
				syncType: undefined,
				progress: undefined,
				pastParticipants: undefined,
				chunkOrder: undefined,
				peerDataRequestSessionId: undefined,
				batchIndex: undefined,
				isFinalBatch: true
			})
		})

		it('history_sync propagates peerDataRequestSessionId from bridge overlay', () => {
			const result = adaptBridgeEvent({
				type: 'history_sync',
				data: { peerDataRequestSessionId: 'PDO-XYZ', syncType: 4 }
			} as never)
			if (result?.type !== 'historySync') throw new Error('narrowing')
			expect(result.peerDataRequestSessionId).toBe('PDO-XYZ')
			expect(result.syncType).toBe(4)
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
