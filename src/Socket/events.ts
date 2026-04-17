import type { MessageInfo, WhatsAppEvent } from 'whatsapp-rust-bridge'
import type { BaileysEventMap, BinaryNode, ConnectionState, WAMessage, WAPresence } from '../Types/index'
import { DisconnectReason, WAProto } from '../Types/index'
import { Boom } from '../Utils/boom'
import type { SocketContext } from './types'
import { jidStr } from './types'

const DEF_CALLBACK_PREFIX = 'CB:'

const DEF_TAG_PREFIX = 'TAG:'

/** Emit CB: pattern events on the ws EventEmitter for retrocompat */
const emitCBEvents = (ctx: SocketContext, node: BinaryNode) => {
	const { ws } = ctx
	const l0 = node.tag
	const l1 = node.attrs || {}
	const l2 = Array.isArray(node.content) ? (node.content[0] as BinaryNode)?.tag : ''

	// Emit TAG:id for IQ response matching (used by query/waitForMessage)
	const id = l1.id
	if (id) {
		ws.emit(`${DEF_TAG_PREFIX}${id}`, node)
	}

	for (const [key, val] of Object.entries(l1)) {
		if (l2) {
			ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}:${val},${l2}`, node)
		}

		ws.emit(`${DEF_CALLBACK_PREFIX}${l0},${key}:${val}`, node)
	}

	if (l2) {
		ws.emit(`${DEF_CALLBACK_PREFIX}${l0},,${l2}`, node)
	}

	ws.emit(`${DEF_CALLBACK_PREFIX}${l0}`, node)
}

/** Convert bridge message event data to a Baileys WAMessage */
const bridgeMessageToWAMessage = (msgData: Record<string, unknown>, info: MessageInfo): WAMessage => {
	const message = msgData as unknown as WAProto.IMessage
	return WAProto.WebMessageInfo.fromObject({
		key: {
			remoteJid: jidStr(info.source.chat),
			fromMe: info.source.is_from_me,
			id: info.id,
			participant: info.source.is_group ? jidStr(info.source.sender) : undefined
		},
		message,
		messageTimestamp: info.timestamp,
		pushName: info.push_name,
		status: WAProto.WebMessageInfo.Status.SERVER_ACK
	}) as WAMessage
}

/** Create the event handler that maps bridge events → Baileys events */
export const makeEventHandler = (
	ctx: SocketContext,
	callbacks?: {
		onPairSuccess?: (data: { platform?: string; businessName?: string }) => void
	}
) => {
	return (event: WhatsAppEvent) => {
		const { ev } = ctx

		const emitClose = (reason: string, statusCode: number) =>
			ev.emit('connection.update', {
				connection: 'close',
				lastDisconnect: { error: new Boom(reason, { statusCode }), date: new Date() }
			} as Partial<ConnectionState>)

		switch (event.type) {
			case 'connected':
				ev.emit('connection.update', { connection: 'open' } as Partial<ConnectionState>)
				break

			case 'disconnected':
				emitClose('Connection closed', DisconnectReason.connectionClosed)
				break

			case 'qr':
			case 'pairing_code':
				ev.emit('connection.update', { qr: event.data.code } as Partial<ConnectionState>)
				break

			case 'pair_success': {
				const { id, lid, platform, business_name } = event.data as {
					id: string
					lid: string
					platform?: string
					business_name?: string
				}
				ctx.setUser({ id, lid })
				callbacks?.onPairSuccess?.({ platform, businessName: business_name })
				break
			}

			case 'pair_error':
				emitClose('Pairing failed: ' + event.data.error, DisconnectReason.connectionClosed)
				break

			case 'logged_out':
				emitClose('Logged out', DisconnectReason.loggedOut)
				break

			case 'connect_failure':
				emitClose(event.data.message || 'Connection failure', DisconnectReason.connectionClosed)
				break

			case 'stream_error':
				emitClose('Stream error: ' + event.data.code, DisconnectReason.badSession)
				break

			case 'client_outdated':
				emitClose('Client outdated', DisconnectReason.badSession)
				break

			case 'temporary_ban':
				emitClose('Temporary ban', DisconnectReason.forbidden)
				break

			// ── Messages ──
			case 'message': {
				const { message: msgData, info } = event.data
				const chatJid = jidStr(info.source.chat)

				// Filter ignored JIDs
				if (ctx.fullConfig.shouldIgnoreJid?.(chatJid)) {
					break
				}

				// Skip own events if emitOwnEvents is false
				if (!ctx.fullConfig.emitOwnEvents && info.source.is_from_me) {
					break
				}

				const waMsg = bridgeMessageToWAMessage(msgData, info)
				ev.emit('messages.upsert', { messages: [waMsg], type: 'notify' } as BaileysEventMap['messages.upsert'])
				break
			}

			case 'receipt': {
				const d = event.data
				const chat = d.source.chat
				const sender = d.source.sender
				const firstId = event.data.message_ids?.[0]
				if (chat && firstId) {
					ev.emit('message-receipt.update', [
						{
							key: {
								remoteJid: jidStr(chat),
								id: firstId,
								fromMe: d.source.is_from_me,
								participant: d.source.is_group ? jidStr(sender) : undefined
							},
							receipt: { receiptTimestamp: d.timestamp }
						}
					])
				}

				break
			}

			// ── Contacts ──
			case 'push_name_update': {
				const d = event.data
				if (d.jid) {
					ev.emit('contacts.update', [{ id: jidStr(d.jid), notify: d.new_push_name }])
				}

				break
			}

			case 'contact_update':
			case 'contact_updated': {
				const d = event.data
				if (d.jid) {
					ev.emit('contacts.update', [{ id: jidStr(d.jid) }])
				}

				break
			}

			case 'picture_update': {
				const d = event.data
				if (d.jid) {
					ev.emit('contacts.update', [{ id: jidStr(d.jid), imgUrl: 'changed' }])
				}

				break
			}

			case 'self_push_name_updated':
				break

			// ── Presence ──
			case 'presence': {
				const d = event.data
				if (d.from) {
					const jid = jidStr(d.from)
					ev.emit('presence.update', {
						id: jid,
						presences: {
							[jid]: {
								lastKnownPresence: (d.unavailable ? 'unavailable' : 'available') as WAPresence,
								lastSeen: d.last_seen ?? undefined
							}
						}
					})
				}

				break
			}

			case 'chat_presence': {
				const d = event.data
				const chat = d.source.chat
				const sender = d.source.sender
				if (chat && sender) {
					ev.emit('presence.update', {
						id: jidStr(chat),
						presences: {
							[jidStr(sender)]: {
								lastKnownPresence: (d.state || 'composing') as WAPresence
							}
						}
					})
				}

				break
			}

			// ── Groups ──
			case 'group_update': {
				const d = event.data
				if (d.group_jid) {
					ev.emit('groups.update', [{ id: jidStr(d.group_jid) }] as BaileysEventMap['groups.update'])
				}

				break
			}

			// ── Chat state updates (app state sync) ──
			case 'archive_update': {
				const d = event.data
				if (d.jid) {
					ev.emit('chats.update', [{ id: jidStr(d.jid), archived: true }])
				}

				break
			}

			case 'pin_update': {
				const d = event.data
				if (d.jid) {
					ev.emit('chats.update', [{ id: jidStr(d.jid), pinned: d.timestamp || undefined }])
				}

				break
			}

			case 'mute_update': {
				const d = event.data
				if (d.jid) {
					ev.emit('chats.update', [{ id: jidStr(d.jid), muteEndTime: d.timestamp || undefined }])
				}

				break
			}

			case 'star_update': {
				const d = event.data
				if (d.chat_jid && event.data.message_id) {
					ev.emit('messages.update', [
						{
							key: {
								remoteJid: jidStr(d.chat_jid),
								id: event.data.message_id,
								fromMe: d.from_me,
								participant: d.participant_jid ? jidStr(d.participant_jid) : undefined
							},
							update: { starred: !!(d.action as Record<string, unknown>)?.starred }
						}
					])
				}

				break
			}

			case 'mark_chat_as_read_update': {
				const d = event.data
				if (d.jid) {
					ev.emit('chats.update', [{ id: jidStr(d.jid), unreadCount: 0 }])
				}

				break
			}

			// ── Sync events ──
			case 'offline_sync_completed':
			case 'offline_sync_preview':
				// Internal sync signals — no Baileys event equivalent
				break

			case 'history_sync':
				// History sync data — complex mapping, handled by bridge internally
				ctx.logger.debug('history_sync event received (handled by bridge)')
				break

			// ── Device/account ──
			case 'device_list_update':
				// Device list changed — bridge handles session updates internally
				break

			case 'disappearing_mode_changed':
				// Handled by bridge internally
				break

			case 'stream_replaced':
				ev.emit('connection.update', {
					connection: 'close',
					lastDisconnect: {
						error: new Boom('Connection replaced', { statusCode: DisconnectReason.connectionReplaced }),
						date: new Date()
					}
				} as Partial<ConnectionState>)
				break

			case 'qr_scanned_without_multidevice':
				ctx.logger.warn('QR scanned but multi-device not enabled on phone')
				break

			// ── Other ──
			case 'undecryptable_message':
				ctx.logger.warn({ event: event.data }, 'undecryptable message received')
				break

			case 'notification':
			case 'business_status_update':
			case 'newsletter_live_update':
			case 'contact_number_changed':
			case 'contact_sync_requested':
			case 'user_about_update':
				// These events exist but have no standard Baileys equivalent
				ctx.logger.trace({ eventType: event.type }, 'bridge event (no Baileys mapping)')
				break

			default: {
				// Handle raw_node events (not in WhatsAppEvent union yet — added by bridge extension)
				const evType = (event as { type: string }).type
				if (evType === 'raw_node') {
					const node = (event as unknown as { data: BinaryNode }).data
					if (node) {
						emitCBEvents(ctx, node)
					}
				} else {
					ctx.logger.debug({ eventType: evType }, 'unknown bridge event')
				}

				break
			}
		}
	}
}
