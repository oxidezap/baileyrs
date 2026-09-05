/**
 * Options `SocketConfig` accepts that nothing on this side reads.
 *
 * Being a drop-in replacement means accepting the whole upstream shape, so none
 * of these throws and none of them ever will. But the Rust engine owns
 * keepalive, retry, history sync, link previews and its own message and group
 * caches, so for these keys there is no reader to hand the value to — and a
 * consumer that passes one is describing behaviour it will not get.
 *
 * That gap is expensive precisely because it is quiet. Two shapes found in a
 * production bot, both dead for months, both looking deliberate:
 *
 * ```ts
 * cachedGroupMetadata: async jid => myOwnCache.get(jid)   // never called
 * getMessage: async key => myStore.get(key.id)            // never called
 * ```
 *
 * `enableRecentMessageCache: true` is worse: it names a cache the consumer
 * believes it turned on.
 *
 * The list is deliberately hand-maintained rather than derived. Deriving it
 * (scanning for reads) would quietly go wrong in both directions — an option
 * read through a computed key would look unsupported, and one only mentioned in
 * a type would look supported. A test anchors every entry to `SocketConfig`, so
 * an option that starts being read here fails the audit for whoever removes it.
 */

import type { SocketConfig } from '../Types/index.ts'

export const UNSUPPORTED_CONFIG_KEYS = [
	// The engine runs its own keepalive (WA Web's idle-ping + dead-socket
	// watchdog) and its own Fibonacci reconnect ladder.
	'keepAliveIntervalMs',
	// Retry of an undecryptable message is engine-side, keyed off its own store
	// of sent messages; there is nothing for a consumer counter to count.
	'maxMsgRetryCount',
	'msgRetryCounterCache',
	'retryRequestDelayMs',
	// The engine decides its own post-login queries.
	'fireInitQueries',
	// Presence is explicit here: call `sendPresenceUpdate` after `open`.
	'markOnlineOnConnect',
	// History sync is driven by the engine.
	'syncFullHistory',
	'shouldSyncHistoryMessage',
	// Link previews are not generated on this side.
	'generateHighQualityLinkPreview',
	'linkPreviewImageThumbnailWidth',
	// Session recreation and the recent-message cache are engine-side, and
	// configured through `cache` (CacheConfig), not through these flags.
	'enableAutoSessionRecreation',
	'enableRecentMessageCache',
	// App-state MAC verification happens in the engine.
	'appStateMacVerification',
	// The engine resolves group metadata and sent messages from its own stores;
	// these two are the ones consumers most often carry over from upstream and
	// keep believing in.
	'cachedGroupMetadata',
	'getMessage',
	// Upstream hooks with no counterpart on this side.
	'patchMessageBeforeSending',
	'customUploadHosts',
	'countryCode',
	// Timeouts and transport knobs the engine owns. `connectTimeoutMs` is the
	// one to point at: `Socket/internals.ts` already documented that it "reaches
	// neither the transport nor the core", and it was still missing from the
	// first version of this list. Proxy and TLS configuration goes through
	// `options.dispatcher`, which is read — `agent` and `fetchAgent` are not.
	'connectTimeoutMs',
	'qrTimeout',
	'agent',
	'fetchAgent',
	'mobile',
	// The QR is published on `connection.update`; drawing it is the consumer's.
	'printQRInTerminal',
	// Offline delivery is the engine's, and history sync is driven by it too.
	'ignoreOfflineMessages',
	'downloadHistory',
	// Caches the engine keeps natively, in Rust, keyed off its own stores.
	'mediaCache',
	'userDevicesCache',
	'callOfferCache',
	'placeholderResendCache'
] as const satisfies ReadonlyArray<keyof SocketConfig>

/**
 * The other half: options something on this side actually reads.
 *
 * Only here to make the classification total. Nothing consumes this list at
 * runtime; its job is to let the assertion below fail the build when a new
 * member of `SocketConfig` belongs to neither list — which is exactly how the
 * first version of the catalog shipped twelve keys short.
 */
export const READ_CONFIG_KEYS = [
	'waWebSocketUrl',
	'options',
	'logger',
	'version',
	'browser',
	'pushName',
	'auth',
	'cache',
	'deviceProps',
	'wantedPreKeyCount',
	'dangerSkipCertChainVerify',
	'emitOwnEvents',
	'shouldIgnoreJid',
	'defaultQueryTimeoutMs',
	'transactionOpts',
	'makeSignalRepository'
] as const satisfies ReadonlyArray<keyof SocketConfig>

/**
 * Every member of `SocketConfig` is classified.
 *
 * A compile error here means a new option was added without deciding whether
 * this library reads it. Put it in whichever list is true and the error goes
 * away; the README presents the unread one as authoritative, so leaving an
 * option out of both is what makes that claim false.
 */
type UnclassifiedConfigKey = Exclude<
	keyof SocketConfig,
	(typeof UNSUPPORTED_CONFIG_KEYS)[number] | (typeof READ_CONFIG_KEYS)[number]
>
const _everyConfigKeyIsClassified: UnclassifiedConfigKey extends never ? true : never = true
void _everyConfigKeyIsClassified

/**
 * Which unsupported options this caller actually passed.
 *
 * Only own, non-`undefined` properties count: spreading a partial config
 * commonly leaves `{ getMessage: undefined }` behind, and warning about a key
 * whose value is absent would be noise about nothing.
 *
 * @param config the object handed to `makeWASocket`, before defaults are merged
 * @returns the offending keys, in catalog order (stable across consumers)
 */
export const unsupportedConfigKeys = (config: object): string[] =>
	UNSUPPORTED_CONFIG_KEYS.filter(
		key => Object.hasOwn(config, key) && (config as Record<string, unknown>)[key] !== undefined
	)

/**
 * Say once per socket, at construction, which unsupported options this caller
 * passed.
 *
 * Per socket, not per process: a replacement socket built after a terminal
 * close carries its own configuration decision, and `Socket/internals.ts`
 * already warns "once per socket rather than per call" for its own no-ops.
 *
 * `warn` and not `error`: nothing is broken.
 *
 * A socket must never fail to build over a diagnostic. That guarantee is
 * unconditional, so the guard covers the whole of it — the reading as well as
 * the writing:
 *
 *  - the optional chaining, for a logger with no `warn` (a minimal one in a
 *    test, say);
 *  - the `try` around the logging call, for a logger whose `warn` throws — a
 *    synchronous transport failing there would take down `makeWASocket` itself;
 *  - the same `try` around the inspection, because telling a passed option from
 *    a spread leftover means reading `config[key]`, and reading fires getters. A
 *    config with a throwing accessor, or a proxy with a throwing trap, would
 *    otherwise fail construction from outside the logging call.
 *
 * All of it only ever bites consumers who passed an inert option, which is the
 * one group this warning exists to help. The failure is swallowed rather than
 * reported, because the only thing left to report it with is the logger that
 * just threw.
 *
 * @param config the object handed to `makeWASocket`, before defaults are merged
 * @param logger the socket's logger
 */
export const warnUnsupportedConfig = (
	config: object,
	logger: { warn?: (payload: object, message: string) => void }
) => {
	try {
		const options = unsupportedConfigKeys(config)
		if (!options.length) return

		logger?.warn?.(
			{ options },
			'these options are accepted for upstream compatibility but nothing reads them here: the engine owns that behaviour'
		)
	} catch {
		// See above: nothing here is worth failing a socket over.
	}
}
