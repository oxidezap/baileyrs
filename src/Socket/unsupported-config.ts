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
	// History sync is driven by the engine and shaped by `downloadHistory`.
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
	'countryCode'
] as const satisfies ReadonlyArray<keyof SocketConfig>

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
 * Say once, at construction, which unsupported options this caller passed.
 *
 * `warn` and not `error`: nothing is broken, and a socket must never fail to
 * build over a diagnostic — hence the guard around the call, which also keeps a
 * minimal test logger from throwing.
 *
 * @param config the object handed to `makeWASocket`, before defaults are merged
 * @param logger the socket's logger
 */
export const warnUnsupportedConfig = (
	config: object,
	logger: { warn?: (payload: object, message: string) => void }
) => {
	const options = unsupportedConfigKeys(config)
	if (!options.length) return

	logger?.warn?.(
		{ options },
		'these options are accepted for upstream compatibility but nothing reads them here: the engine owns that behaviour'
	)
}
