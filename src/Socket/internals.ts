import type { BinaryNode, MessageUpsertType, WAMessage, WAPatchCreate } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import type { SocketContext } from './types.ts'

/**
 * Upstream has no timeout on `waitForSocketOpen`; the bridge requires one. This
 * is the socket's own connect timeout, so the wait cannot outlive the attempt
 * it is waiting on.
 */
const waitTimeoutMs = (ctx: SocketContext): number => ctx.fullConfig?.connectTimeoutMs ?? 20_000

export const makeInternalMethods = (ctx: SocketContext) => {
	/** Warned once per socket rather than per call, as with the other no-ops. */
	let warnedAboutResync = false

	return {
		/**
		 * `waitForSocket`, not `waitForConnected`: upstream waits for the socket
		 * to open, which is not the same as being logged in, and the bridge
		 * separates the two.
		 */
		waitForSocketOpen: async (): Promise<void> => {
			await (await ctx.getClient()).waitForSocket(waitTimeoutMs(ctx))
		},

		/**
		 * Publishes a message onto the event bus, which is this layer's own job.
		 * The push-name half of upstream's version is not reproduced: contact
		 * state belongs to the core, and writing it from here would make two
		 * writers for one value.
		 */
		upsertMessage: async (msg: WAMessage, type: MessageUpsertType): Promise<void> => {
			ctx.ev.emit('messages.upsert', { messages: [msg], type })
		},

		/**
		 * A consumer extension point rather than protocol state, so it lives
		 * here. Overridable: assigning to it replaces this default.
		 */
		onUnexpectedError: (err: Error, msg: string): void => {
			ctx.logger.error({ err }, `unexpected error in '${msg}'`)
		},

		/**
		 * Resolves without forcing anything, and says so once.
		 *
		 * The engine syncs app state on connect and re-syncs every collection
		 * when the server raises the `syncd_app_state` dirty bit, so the state a
		 * caller wants current already is. There is no on-demand resync to
		 * delegate to, and rejecting would break a call whose intent is met.
		 */
		resyncAppState: async (
			collections: readonly ('critical_block' | 'critical_unblock_low' | 'regular_high' | 'regular_low' | 'regular')[],
			isInitialSync: boolean
		): Promise<void> => {
			void collections
			void isInitialSync
			if (!warnedAboutResync) {
				warnedAboutResync = true
				ctx.logger.warn(
					'resyncAppState is a no-op: the engine syncs app state on connect and again whenever the server marks it dirty'
				)
			}
		},

		/**
		 * Refused: the offset is protocol state the core keeps from the stanzas
		 * it already reads. A second clock here would drift from the one that
		 * actually timestamps outgoing messages.
		 */
		updateServerTimeOffset: (node: BinaryNode): never => {
			void node
			throw new Boom(
				'updateServerTimeOffset is not supported: the engine tracks the server clock offset itself, and a second one here would diverge from the one it stamps messages with',
				{ statusCode: 501 }
			)
		},

		/**
		 * Refused one layer down. The core's session instance is `pub(crate)`,
		 * and what exists returns a half-built stanza plus a sequence number, so
		 * exposing it would hand JavaScript the job of finishing and sequencing
		 * a lifecycle stanza.
		 */
		sendUnifiedSession: async (): Promise<never> => {
			throw new Boom(
				'sendUnifiedSession is not supported: it is connection lifecycle machinery the engine owns, not a consumer operation',
				{ statusCode: 501 }
			)
		},

		/**
		 * Refused: the bridge exposes app-state actions typed per action and
		 * deliberately no generic. Accepting a raw patch here would mean
		 * building mutation indices and schema versions in TypeScript, beside
		 * the copy the core already maintains.
		 */
		appPatch: async (patchCreate: WAPatchCreate): Promise<never> => {
			void patchCreate
			throw new Boom(
				'appPatch is not supported: use the typed chatModify variants, which is the only app-state surface this package can offer without a second implementation of the patch format',
				{ statusCode: 501 }
			)
		},

		/**
		 * Null rather than absent, and rather than a shadow. Retry is the
		 * engine's, so there is no manager here to hand out, and saying so in
		 * the type is more useful than leaving the field missing.
		 */
		messageRetryManager: null
	}
}
