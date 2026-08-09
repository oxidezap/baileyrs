/**
 * The coverage ledger for the differential fuzzers.
 *
 * baileyrs and Baileys share 150-odd function exports. A fuzz suite that quietly
 * covers thirty of them and says nothing about the rest is worse than none — it
 * reads as assurance it does not provide. So every shared export has to appear
 * in exactly one of these two lists, and `coverage.fuzz.test.ts` fails when a new
 * one appears in neither.
 *
 * That turns "we should fuzz the new helper" from a thing somebody remembers into
 * a red test on the pull request that adds it.
 */

/** Helpers driven by `pure-differential.fuzz.test.ts`. */
export const PURE_TARGET_NAMES: readonly string[] = [
	// src/WABinary/jid-utils.ts
	'jidDecode',
	'jidEncode',
	'jidNormalizedUser',
	'areJidsSameUser',
	'transferDevice',
	'getServerFromDomainType',
	'isJidBot',
	'isJidBroadcast',
	'isJidGroup',
	'isJidMetaAI',
	'isJidNewsletter',
	'isJidStatusBroadcast',
	'isLidUser',
	'isPnUser',
	'isHostedLidUser',
	'isHostedPnUser',

	// src/Utils/generics.ts
	'encodeBigEndian',
	'unpadRandomMax16',
	'toNumber',
	'isStringNullOrEmpty',
	'getKeyAuthor',
	'getStatusFromReceiptType',
	'getCallStatusFromNode',
	'getErrorCodeFromStreamError',
	'getCodeFromWSError',
	'isWABusinessPlatform',
	'bytesToCrockford',
	'trimUndefined',
	'unixTimestampSeconds',
	'generateParticipantHashV2',
	'encodeNewsletterMessage',

	// src/Utils/messages.ts
	'getContentType',
	'normalizeMessageContent',
	'extractMessageContent',
	'getDevice',
	'aggregateMessageKeysNotFromMe',
	'hasNonNullishProperty',
	'updateMessageWithReceipt',
	'updateMessageWithReaction',
	'updateMessageWithPollUpdate',
	'updateMessageWithEventResponse',
	'prepareDisappearingMessageSettingContent',
	'assertMediaContent',
	'extractUrlFromText',
	'generateForwardMessageContent',
	'getAggregateVotesInPollMessage',
	'getAggregateResponsesInEventMessage',

	// src/WABinary/generic-utils.ts
	'getBinaryNodeChild',
	'getBinaryNodeChildren',
	'getAllBinaryNodeChildren',
	'getBinaryNodeChildBuffer',
	'getBinaryNodeChildString',
	'getBinaryNodeChildUInt',
	'reduceBinaryNodeToDictionary',
	'assertNodeErrorFree',
	'binaryNodeToString',
	'getBinaryNodeMessages',

	// src/Utils/crypto.ts — the deterministic half
	'aesDecrypt',
	'aesDecryptCTR',
	'aesDecryptGCM',
	'aesDecryptWithIV',
	'aesEncrypWithIV',
	'aesEncryptCTR',
	'aesEncryptGCM',
	'hkdf',
	'hkdfInfoKey',
	'hmacSign',
	'md5',
	'sha256',
	'generateSignalPubKey',

	// src/Utils/messages-media.ts, process-message.ts, signal.ts, auth-utils.ts
	'assertMeId',
	'buildAckStanza',
	'cleanMessage',
	'createSignalIdentity',
	'decodeMediaRetryNode',
	'extractDeviceJids',
	'extractE2ESessionFromRetryReceipt',
	'getChatId',
	'isRealMessage',
	'shouldIncrementChatUnread',
	'getHistoryMsg',
	'getPlatformId',
	'getCompanionPlatformId',
	'getCompanionWebClientType',
	'getStatusCodeForMediaRetry',
	'getUrlFromDirectPath',
	'extensionForMediaMessage',
	'mediaMessageSHA256B64',
	'encodeBase64EncodedStringForUpload',
	'xmppPreKey',
	'xmppSignedPreKey'
]

/**
 * Shared exports the differential fuzzers deliberately leave alone, each with the
 * reason. "Not fuzzed" is a claim like any other: it should be readable, and it
 * should be wrong-able.
 */
export const EXCLUDED_EXPORTS: Readonly<Record<string, string>> = {
	// Non-deterministic: the two implementations cannot agree on a random draw.
	aesEncrypt: 'generates a random IV; aesEncrypWithIV covers the deterministic half',
	encodeWAMessage: 'appends writeRandomPadMax16 padding, so two calls never agree; encodeNewsletterMessage fuzzes the same encoder unpadded',
	writeRandomPadMax16: 'pads with random bytes; unpadRandomMax16 covers the inverse',
	generateMessageID: 'draws a random message id on every call',
	generateMessageIDV2: 'draws a random message id on every call',
	generateMdTagPrefix: 'draws a random tag prefix on every call',
	generateRegistrationId: 'draws a random registration id on every call',
	initAuthCreds: 'generates fresh key material on every call',
	signedKeyPair: 'generates fresh key material on every call',
	getPreKeys: 'generates fresh key material on every call',
	buildPairingQRData: 'derives from live pairing state and fresh key material',

	// I/O, network or filesystem: not a pure comparison, and covered by e2e.
	fetchLatestBaileysVersion: 'fetches the version manifest over the network',
	fetchLatestWaWebVersion: 'fetches the version manifest over the network',
	getUrlInfo: 'fetches the target page over the network',
	getHttpStream: 'opens an HTTP connection',
	getStream: 'consumes a readable stream, so the input is not a value',
	toReadable: 'produces a stream, which cannot be deep-compared',
	toBuffer: 'consumes a readable stream, so the input is not a value',
	useMultiFileAuthState: 'reads and writes auth state on the filesystem',
	downloadMediaMessage: 'network + media pipeline; covered by the e2e suite',
	downloadContentFromMessage: 'network + media pipeline; covered by the e2e suite',
	downloadHistory: 'network + media pipeline; covered by the e2e suite',
	downloadAndProcessHistorySyncNotification: 'network + media pipeline; covered by the e2e suite',
	prepareWAMessageMedia: 'uploads media; covered by the e2e suite',
	generateLinkPreviewIfRequired: 'network fetch; covered by link-preview-compatibility',
	generateThumbnail: 'image codec; covered by the e2e suite',
	extractImageThumb: 'image codec; covered by the e2e suite',
	generateProfilePicture: 'image codec; covered by the e2e suite',
	getAudioDuration: 'audio codec',
	getAudioWaveform: 'audio codec',
	getMediaKeys: 'async HKDF wrapper; hkdf itself is fuzzed directly',
	encryptMediaRetryRequest: 'async and keyed by live session state',
	derivePairingCodeKey: 'async PBKDF2; pinned by crypto-compatibility',

	// Timers, events and other stateful machinery.
	delay: 'resolves on a timer, so the observable behaviour is wall-clock',
	delayCancellable: 'resolves on a timer, so the observable behaviour is wall-clock',
	promiseTimeout: 'races against a timer, so the observable behaviour is wall-clock',
	debouncedTimeout: 'schedules work on a timer and returns a live handle',
	bindWaitForEvent: 'subscribes to an emitter and resolves on a future event',
	bindWaitForConnectionUpdate: 'subscribes to an emitter and resolves on a future event',
	makeEventBuffer: 'stateful; covered by bridge-events.fuzz.test.ts',
	makeCacheableSignalKeyStore: 'stateful keystore; covered by the store test suite',
	addTransactionCapability: 'stateful keystore wrapper; covered by the store test suite',
	handleIdentityChange: 'mutates live session state',
	MessageRetryManager: 'class with internal state; covered by public-helpers-compatibility',
	makeWASocket: 'socket factory; covered by the e2e suite',
	default: 'the makeWASocket default export',

	// Classes whose contract is pinned by the dedicated USync suites.
	USyncQuery: 'class; covered by usync-compatibility',
	USyncUser: 'class; covered by usync-compatibility',
	USyncContactProtocol: 'class; covered by usync-compatibility',
	USyncDeviceProtocol: 'class; covered by usync-compatibility',
	USyncDisappearingModeProtocol: 'class; covered by usync-compatibility',
	USyncStatusProtocol: 'class; covered by usync-compatibility',
	USyncUsernameProtocol: 'class; covered by usync-compatibility',

	// Message construction: the send path is fuzzed end-to-end by
	// wire-fidelity.fuzz.test.ts, which is a stronger oracle than argument diffing.
	generateWAMessage: 'async send-path builder; covered by wire-fidelity.fuzz.test.ts',
	generateWAMessageContent: 'async send-path builder; covered by wire-fidelity.fuzz.test.ts',
	generateWAMessageFromContent: 'send-path builder; covered by wire-fidelity.fuzz.test.ts',
	processHistoryMessage: 'history-sync pipeline; covered by history-sync-inflate and the wire tests',

	// Keyed crypto whose inputs cannot be generated meaningfully: random input only
	// ever reaches the shared "reject" branch, so the differential proves nothing.
	decryptPollVote: 'needs real poll key material; covered by the message compatibility suite',
	decryptEventResponse: 'needs real event key material; covered by the message compatibility suite',
	decryptMediaRetryData: 'needs real retry key material; covered by the media retry suite',
	parseAndInjectE2ESessions: 'needs a live signal repository; covered by prekey-compatibility'
}
