import type { BinaryNode, MessageUpsertType, WAMessage, WAPatchCreate } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import type { ILogger } from '../Utils/logger.ts'
import type { SocketContext } from './types.ts'

/**
 * The one place an unexpected failure is reported, shared by the socket's
 * `onUnexpectedError` property and by the internal paths that raise them.
 *
 * `report` cannot throw. Some of its callers are bridge callbacks that borrow
 * memory and are contractually forbidden from raising, so a consumer whose
 * handler throws would cost the session its borrowed batches. A handler that
 * fails is reported through the logger and the caller carries on.
 */
export const makeUnexpectedErrorReporter = (logger: ILogger) => {
	const logUnexpected = (err: unknown, msg: string) => logger.error({ err }, `unexpected error in '${msg}'`)
	let handler: (err: unknown, msg: string) => void = logUnexpected

	return {
		report: (err: unknown, msg: string) => {
			try {
				handler(err, msg)
			} catch (reportingError) {
				logger.error({ err: reportingError }, 'the onUnexpectedError handler threw')
				logUnexpected(err, msg)
			}
		},
		get handler() {
			return handler
		},
		set handler(next: (err: unknown, msg: string) => void) {
			handler = next
		}
	}
}

/**
 * Upstream has no timeout on `waitForSocketOpen`; the bridge requires one, so
 * one has to be chosen.
 *
 * It is the core's own transport connect ceiling, not `connectTimeoutMs`. That
 * config reaches neither the transport nor the core, so a value below the
 * ceiling would reject a wait while the attempt behind it was still running and
 * about to succeed. A value above it would sit past the point the attempt was
 * already abandoned.
 */
const TRANSPORT_CONNECT_TIMEOUT_MS = 20_000

export const makeInternalMethods = (ctx: SocketContext) => {
	/** Warned once per socket rather than per call, as with the other no-ops. */
	let warnedAboutResync = false

	return {
		/**
		 * `waitForSocket`, not `waitForConnected`: upstream waits for the socket
		 * to open, which is not the same as being logged in, and the bridge
		 * separates the two.
		 *
		 * A rejection means the socket did not open within one connect attempt,
		 * not that it never will: the engine reconnects on its own, and a caller
		 * that wants the next attempt waits again.
		 */
		waitForSocketOpen: async (): Promise<void> => {
			await (await ctx.getClient()).waitForSocket(TRANSPORT_CONNECT_TIMEOUT_MS)
		},

		/**
		 * Publishes a message onto the event bus, which is this layer's own job.
		 * Buffered as upstream buffers it, so a replay of many messages
		 * consolidates into the batches a listener expects rather than one
		 * event per call.
		 *
		 * The push-name half of upstream's version is not reproduced: contact
		 * state belongs to the core, and writing it from here would make two
		 * writers for one value.
		 */
		upsertMessage: ctx.ev.createBufferedFunction(async (msg: WAMessage, type: MessageUpsertType): Promise<void> => {
			ctx.ev.emit('messages.upsert', { messages: [msg], type })
		}),

		/**
		 * The same reporter the socket's own failure paths use, rather than a
		 * second one that only a consumer could reach: a dispatcher that threw
		 * or a wire batch that would not decode arrives here. The socket
		 * redefines this as an accessor, so assigning to it replaces the
		 * handler those paths report through.
		 */
		onUnexpectedError: (err: Error, msg: string): void => {
			ctx.reportUnexpectedError(err, msg)
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
			collections?: readonly ('critical_block' | 'critical_unblock_low' | 'regular_high' | 'regular_low' | 'regular')[],
			isInitialSync?: boolean
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
