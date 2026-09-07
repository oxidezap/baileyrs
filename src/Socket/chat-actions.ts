import type { proto } from '../WAProto/runtime.ts'
import type { QuickReplyAction } from '../Types/Bussines.ts'
import type { LabelActionBody } from '../Types/Label.ts'
import type { ChatModification } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import type { SocketContext } from './types.ts'

/**
 * Refuse a field the mutation carries but the wire call cannot. Dropping it
 * would report success for a change that never happened, which is the failure
 * this whole path exists to stop.
 */
const rejectUnsupportedFields = (where: string, value: object, fields: readonly string[]) => {
	const present = fields.filter(field => (value as Record<string, unknown>)[field] != null)
	if (present.length) {
		throw new Boom(`${where}: ${present.join(', ')} cannot be set through this client`, {
			statusCode: 400,
			data: { fields: present }
		})
	}
}

export const makeChatActionMethods = (ctx: SocketContext) => {
	const methods = {
		pinChat: async (jid: string, pin: boolean) => {
			await ctx.withClient(client => client.pinChat(jid, pin))
		},

		muteChat: async (jid: string, muteUntil?: number | null) => {
			await ctx.withClient(client => client.muteChat(jid, muteUntil))
		},

		archiveChat: async (jid: string, archive: boolean) => {
			await ctx.withClient(client => client.archiveChat(jid, archive))
		},

		starMessage: async (jid: string, messageId: string, star: boolean) => {
			await ctx.withClient(client => client.starMessage(jid, messageId, star))
		},

		/**
		 * Compatibility wrapper for original Baileys chatModify API.
		 * Routes to the appropriate bridge method based on the modification type.
		 *
		 * Every variant either runs or throws. A variant that resolved without
		 * doing anything told the caller their chat was labelled when nothing was
		 * synced, and no signature or type catches that.
		 */
		chatModify: async (mod: ChatModification, jid: string) => {
			return ctx.withClient(async client => {
				if ('archive' in mod) {
					await client.archiveChat(jid, mod.archive)
				} else if ('pin' in mod) {
					await client.pinChat(jid, mod.pin)
				} else if ('mute' in mod) {
					await client.muteChat(jid, mod.mute)
				} else if ('star' in mod) {
					for (const msg of mod.star.messages) {
						await client.starMessage(jid, msg.id, mod.star.star)
					}
				} else if ('markRead' in mod) {
					await client.markChatAsRead(jid, mod.markRead)
				} else if ('delete' in mod) {
					await client.deleteChat(jid)
				} else if ('deleteForMe' in mod) {
					await client.deleteMessageForMe(jid, mod.deleteForMe.key.id!, !!mod.deleteForMe.key.fromMe)
				} else if ('pushNameSetting' in mod) {
					await client.setPushName(mod.pushNameSetting)
				} else if ('contact' in mod) {
					// Save/rename a contact (syncs the name to linked devices). `jid` is the
					// contact's bare PN jid.
					if (mod.contact) {
						rejectUnsupportedFields('chatModify contact', mod.contact, ['lidJid', 'pnJid', 'username'])
						await client.saveContact(
							jid,
							mod.contact.fullName ?? undefined,
							mod.contact.firstName ?? undefined,
							mod.contact.saveOnPrimaryAddressbook ?? true
						)
					} else {
						// Its own method, not `saveContact` with empty fields: removal is
						// the one contact mutation the wire models as a `Remove`, and a
						// `Set` carrying empty values renames the contact to "".
						await client.removeContact(jid)
					}
				} else if ('clear' in mod) {
					// Clear a chat's messages while keeping the chat. `lastMessages` (the
					// message range) is ignored, same as the `delete` branch — the bridge
					// clears the whole chat. deleteStarred/deleteMedia aren't part of the
					// Baileys `clear` shape, so default both to false (keep starred + media).
					if (mod.clear) {
						await client.clearChat(jid, false, false)
					}
				} else if ('disableLinkPreviews' in mod) {
					await client.setLinkPreviewsDisabled(mod.disableLinkPreviews.isPreviewsDisabled ?? false)
				} else if ('addLabel' in mod) {
					// One upstream variant, two wire actions: an edit carrying
					// `deleted` is the delete, not a separate modification.
					if (mod.addLabel.deleted) {
						await client.deleteLabel(mod.addLabel.id)
					} else {
						rejectUnsupportedFields('chatModify addLabel', mod.addLabel, ['predefinedId'])
						// The mutation replaces the whole label, so a missing field is
						// not "leave it alone", it is "set it to nothing". Upstream can
						// omit one because it builds the proto directly; this call
						// cannot, so both are required rather than defaulted.
						if (mod.addLabel.name === undefined || mod.addLabel.color === undefined) {
							throw new Boom(
								'chatModify addLabel: name and color are both required, because the label mutation is a full replace and an omitted field would reset it',
								{ statusCode: 400 }
							)
						}
						await client.createLabel(mod.addLabel.id, mod.addLabel.name, mod.addLabel.color)
					}
				} else if ('addChatLabel' in mod) {
					await client.addChatLabel(mod.addChatLabel.labelId, jid)
				} else if ('removeChatLabel' in mod) {
					await client.removeChatLabel(mod.removeChatLabel.labelId, jid)
				} else if ('addMessageLabel' in mod) {
					await client.addMessageLabel(mod.addMessageLabel.labelId, jid, mod.addMessageLabel.messageId)
				} else if ('removeMessageLabel' in mod) {
					await client.removeMessageLabel(mod.removeMessageLabel.labelId, jid, mod.removeMessageLabel.messageId)
				} else if ('quickReply' in mod) {
					// Upstream's `timestamp` is the app-state index key, the same slot
					// the core calls `id`. Deleting is the same upsert with `deleted`.
					// `||`, not `??`: upstream treats an empty timestamp as absent and
					// mints a key, and the core rejects an empty index outright.
					const id = mod.quickReply.timestamp || String(Math.floor(Date.now() / 1000))
					if (mod.quickReply.deleted) {
						await client.deleteQuickReply(id)
					} else {
						await client.setQuickReply(
							id,
							mod.quickReply.shortcut ?? '',
							mod.quickReply.message ?? '',
							mod.quickReply.keywords ?? [],
							mod.quickReply.count ?? 0
						)
					}
				} else {
					const variant = Object.keys(mod)[0] ?? '(empty)'
					throw new Boom(`chatModify: unsupported modification '${variant}'`, {
						statusCode: 400,
						data: { variant, jid }
					})
				}
			})
		},

		// Upstream models all of these as sugar over `chatModify`, and so do we:
		// one place decides which bridge call a modification becomes, so the
		// method and the modification can never disagree.

		addOrEditContact: async (jid: string, contact: proto.SyncActionValue.IContactAction) => {
			await methods.chatModify({ contact }, jid)
		},

		removeContact: async (jid: string) => {
			await methods.chatModify({ contact: null }, jid)
		},

		addLabel: async (jid: string, labels: LabelActionBody) => {
			await methods.chatModify({ addLabel: { ...labels } }, jid)
		},

		addChatLabel: async (jid: string, labelId: string) => {
			await methods.chatModify({ addChatLabel: { labelId } }, jid)
		},

		removeChatLabel: async (jid: string, labelId: string) => {
			await methods.chatModify({ removeChatLabel: { labelId } }, jid)
		},

		addMessageLabel: async (jid: string, messageId: string, labelId: string) => {
			await methods.chatModify({ addMessageLabel: { labelId, messageId } }, jid)
		},

		removeMessageLabel: async (jid: string, messageId: string, labelId: string) => {
			await methods.chatModify({ removeMessageLabel: { labelId, messageId } }, jid)
		},

		star: async (jid: string, messages: { id: string; fromMe?: boolean }[], star: boolean) => {
			await methods.chatModify({ star: { messages, star } }, jid)
		},

		// No jid: a quick reply is account-wide, keyed only by its index.
		addOrEditQuickReply: async (quickReply: QuickReplyAction) => {
			await methods.chatModify({ quickReply }, '')
		},

		removeQuickReply: async (timestamp: string) => {
			await methods.chatModify({ quickReply: { timestamp, deleted: true } }, '')
		}
	}
	return methods
}
