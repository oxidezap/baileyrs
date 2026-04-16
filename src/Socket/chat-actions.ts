import type { ChatModification, WAPatchName } from '../Types/index'
import type { SocketContext } from './types'

export const makeChatActionMethods = (ctx: SocketContext) => ({
	pinChat: async (jid: string, pin: boolean) => {
		await (await ctx.getClient()).pinChat(jid, pin)
	},

	muteChat: async (jid: string, muteUntil?: number | null) => {
		await (await ctx.getClient()).muteChat(jid, muteUntil)
	},

	archiveChat: async (jid: string, archive: boolean) => {
		await (await ctx.getClient()).archiveChat(jid, archive)
	},

	starMessage: async (jid: string, messageId: string, star: boolean) => {
		await (await ctx.getClient()).starMessage(jid, messageId, star)
	},

	/**
	 * Compatibility wrapper for original Baileys chatModify API.
	 * Routes to the appropriate bridge method based on the modification type.
	 *
	 * Fully supported: archive, pin, mute, star, markRead, delete, deleteForMe, pushNameSetting
	 * Not yet in bridge (app-state patches): clear, contact, disableLinkPreviews, labels, quickReply
	 */
	chatModify: async (mod: ChatModification, jid: string) => {
		const client = await ctx.getClient()
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
		} else {
			// App-state-patch variants not yet exposed by bridge:
			// clear, contact, disableLinkPreviews, addLabel, addChatLabel,
			// removeChatLabel, addMessageLabel, removeMessageLabel, quickReply
			const variant = Object.keys(mod)[0]
			ctx.logger.warn(
				{ variant, jid },
				'chatModify: variant requires app-state patch support not yet available in bridge'
			)
		}
	},

	/**
	 * Force re-sync of app state collections.
	 *
	 * In the Rust bridge architecture, app state is managed internally by the engine
	 * and synced automatically on connect. This method is a no-op provided for API
	 * compatibility with upstream Baileys.
	 */
	resyncAppState: async (_collections?: readonly WAPatchName[], _isInitialSync?: boolean) => {
		ctx.logger.info('resyncAppState: app state is synced automatically by the Rust bridge')
	},

	/**
	 * Fetch disappearing message duration for contacts.
	 *
	 * Not yet supported — requires USyncQuery which is handled internally by the bridge.
	 * Disappearing mode changes are emitted via the 'disappearing_mode_changed' event.
	 */
	fetchDisappearingDuration: async (..._jids: string[]) => {
		ctx.logger.warn(
			'fetchDisappearingDuration: not yet available in bridge mode — listen for disappearing_mode_changed events instead'
		)
		return undefined
	}
})
