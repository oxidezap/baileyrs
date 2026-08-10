/**
 * Differential fuzzing of the pure public helpers against upstream Baileys.
 *
 * Everything in here is a function both libraries export under the same name,
 * with no I/O, no clock and no randomness of its own — so for any input the two
 * must agree, and any input where they do not is either a bug or a divergence
 * somebody has to justify in `harness/divergence.ts`.
 *
 * The generated input is grammar-driven rather than random noise: `jidDecode`
 * only gets interesting at `5511999999999_1:3@hosted.lid`, and no amount of
 * random bytes ever produces that.
 *
 * `coverage.fuzz.test.ts` keeps this table honest — a shared export that lands
 * in neither the table nor the exclusion list fails the suite.
 */

import { createCipheriv, createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import type { BinaryNode } from '../Types/index.ts'
import { compareOutcomes, runOutcome, showOutcome } from './harness/compare.ts'
import type { Divergence } from './harness/divergence.ts'
import { fuzz } from './harness/runner.ts'
import type { Random } from './harness/random.ts'
import {
	generateBinaryNode,
	generateCallNode,
	generateDictionaryNode,
	generateErrorNode,
	generateMediaRetryNode,
	generateMessageStanza,
	generateResponseNode,
	generateTaggedNode,
	generateRetryReceiptNode,
	generateStreamErrorNode
} from './generators/binary-node.ts'
import { generateJid, generateJidPair, generateMaybeJid, JID_SERVERS } from './generators/jid.ts'
import {
	generateAnyValue,
	generateBytes,
	generateNumber,
	generateString,
	HOSTILE_STRINGS
} from './generators/values.ts'
import { PURE_TARGET_NAMES } from './targets.ts'

/** The option-name digest the poll aggregator buckets votes by. */
const sha256 = (value: Buffer): Buffer => createHash('sha256').update(value).digest()

/** The child tags the content accessors are asked for, shared by generator and query. */
const CONTENT_TAGS = ['error', 'item', 'enc', 'skmsg', 'missing'] as const

const upstream = (await import('baileys')) as unknown as Record<string, unknown>
const local = (await import('../index.ts')) as unknown as Record<string, unknown>

type Args = readonly unknown[]

/**
 * Fresh copies per side, so a helper that mutates its argument cannot
 * cross-contaminate the other implementation's run.
 *
 * `structuredClone` is not used: it turns a `Buffer` into a plain `Uint8Array`,
 * and several of these helpers call `Buffer` methods on their argument — the
 * clone would silently change what is being tested.
 */
const clone = <T>(value: T): T => {
	try {
		if (Buffer.isBuffer(value)) return Buffer.from(value) as T
		if (value instanceof Uint8Array) return value.slice() as T
		if (value instanceof Date) return new Date(value.getTime()) as T
	} catch {
		// Generated input can carry an own `__proto__` pointing at a typed-array
		// prototype: it satisfies `instanceof` without supporting the methods.
		// Fall through to the structural copy, which works on anything.
	}
	if (value instanceof Error) {
		// Copied, not shared: returning the same object would give both sides the
		// same reference, so the mutation check below could never see one side
		// mutate it and a mutating helper would cross-contaminate the other run.
		const copy = new Error(value.message)
		copy.name = value.name
		for (const key of Object.getOwnPropertyNames(value)) {
			if (key === 'stack' || key === 'message') continue
			Object.defineProperty(copy, key, {
				// Recursed, like the object branch below: copying a nested object by
				// reference would give both sides the same one, so a helper mutating
				// `error.data.code` would change it for both and the mutation check
				// would compare two identical objects and call it agreement.
				value: clone((value as unknown as Record<string, unknown>)[key]),
				enumerable: true,
				writable: true,
				configurable: true
			})
		}
		return copy as T
	}
	if (Array.isArray(value)) return value.map(item => clone(item)) as T
	if (typeof value === 'object' && value !== null) {
		const out: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(value)) {
			// Plain assignment to `__proto__` would move the prototype instead of
			// copying the property, quietly changing the value under test.
			Object.defineProperty(out, key, { value: clone(nested), enumerable: true, writable: true, configurable: true })
		}
		return out as T
	}
	return value
}

/**
 * A real AES-256-CBC ciphertext, so the decrypt targets reach their success path.
 *
 * Generating ciphertext, key and IV independently means the block and PKCS#7
 * padding checks reject essentially every input — and the comparator reads two
 * throws as agreement, so plaintext recovery was never compared.
 */
const cbcTuple = (random: Random): { sealed: Buffer; key: Buffer; iv: Buffer } => {
	const key = Buffer.from(random.bytes(32))
	const iv = Buffer.from(random.bytes(16))
	const cipher = createCipheriv('aes-256-cbc', key, iv)
	const plaintext = Buffer.from(random.bytes(random.pick([0, 1, 15, 16, 17, 32, 100])))
	return { sealed: Buffer.concat([cipher.update(plaintext), cipher.final()]), key, iv }
}

/** Flips one byte, so an otherwise valid ciphertext fails authentication. */
const corrupt = (random: Random, bytes: Buffer): Buffer => {
	if (bytes.length === 0) return bytes
	const copy = Buffer.from(bytes)
	const index = random.below(copy.length)
	copy[index] = copy[index]! ^ 0xff
	return copy
}

/** Byte sizes chosen to straddle every AES/HMAC block and key boundary. */
const cryptoBuffer = (random: Random): Buffer =>
	Buffer.from(random.bytes(random.pick([0, 1, 15, 16, 17, 31, 32, 33, 48, 64, 100])))

/**
 * Weighted toward the only length the cipher accepts, with the near-misses kept.
 *
 * Drawn uniformly, a valid key and a valid IV coincided about once in 36 — so
 * `aesDecryptCTR` produced output on 4 of 200 inputs and the other 196 compared
 * two rejections, which the oracle reads as agreement. The off-by-one lengths
 * are what make the reject path interesting, so they stay; they just stop being
 * the whole test.
 */
const cryptoKey = (random: Random): Buffer =>
	Buffer.from(
		random.bytes(
			random.weighted<number>([
				[6, 32],
				[1, 16],
				[1, 31],
				[1, 33],
				[1, 0],
				[1, 64]
			])
		)
	)

const cryptoIv = (random: Random): Buffer =>
	Buffer.from(
		random.bytes(
			random.weighted<number>([
				[6, 16],
				[1, 12],
				[1, 15],
				[1, 17],
				[1, 0],
				[1, 32]
			])
		)
	)

const cryptoNonce = (random: Random): Buffer =>
	Buffer.from(
		random.bytes(
			random.weighted<number>([
				[6, 12],
				[1, 16],
				[1, 8],
				[1, 0],
				[1, 13]
			])
		)
	)

/** WebSocket errors carry their code in the message text, so the text is the input. */
const wsError = (random: Random): Error => {
	const error = new Error(
		random.pick([
			'Unexpected server response: 401',
			'Unexpected server response: 503',
			'Unexpected server response: notanumber',
			'Opening handshake has timed out',
			'',
			'socket hang up'
		])
	)
	return error
}

/**
 * A poll message plus updates, with votes that actually match its options.
 *
 * `getAggregateVotesInPollMessage` buckets a vote by `sha256(optionName)`.
 * Drawing `selectedOptions` from random bytes gives that match no chance at all,
 * so every vote landed in the "Unknown" bucket and the helper's normal behaviour
 * — assigning voters to the declared options — was never compared. Most hashes
 * are therefore derived from the generated option names, with unknown and
 * malformed ones still drawn often enough to keep those paths covered.
 */
const pollWithVotes = (random: Random) => {
	const options = Array.from({ length: random.int(0, 4) }, () => ({ optionName: generateString(random) }))
	const knownHashes = options.map(option => sha256(Buffer.from(option.optionName || '')))

	const selected = () => {
		if (knownHashes.length > 0 && random.bool(0.75)) {
			return Array.from({ length: random.int(1, Math.min(2, knownHashes.length)) }, () => random.pick(knownHashes))
		}
		return random.bool(0.5) ? [Buffer.from(generateBytes(random))] : []
	}

	return {
		message: { pollCreationMessage: { options } },
		pollUpdates: Array.from({ length: random.int(0, 4) }, () => ({
			pollUpdateMessageKey: messageKey(random),
			vote: { selectedOptions: selected() },
			senderTimestampMs: generateNumber(random)
		}))
	}
}

/**
 * A protocol message carrying a history-sync notification, sometimes wrapped.
 *
 * `getHistoryMsg` normalises the content and then reads
 * `protocolMessage.historySyncNotification`. The generic content generator never
 * produces that field, so all 200 inputs took the missing-notification throw and
 * neither the wrapper normalisation nor the returned notification was compared.
 */
const historyNotificationContent = (random: Random): Record<string, unknown> => {
	const notification = random.bool(0.85)
		? {
				fileSha256: generateBytes(random),
				mediaKey: generateBytes(random),
				fileLength: generateNumber(random),
				syncType: random.int(0, 6),
				chunkOrder: random.int(0, 3),
				directPath: generateString(random)
			}
		: random.pick([{}, undefined])

	const inner = { protocolMessage: { type: random.int(0, 8), historySyncNotification: notification } }
	// Wrapped as often as not: the normalisation step is half of what this reads.
	if (random.bool(0.4)) {
		return { [random.pick(['ephemeralMessage', 'viewOnceMessage', 'deviceSentMessage'])]: { message: inner } }
	}
	return inner
}

/**
 * A media message with a `fileSha256`, which is the only field the digest helper
 * reads.
 *
 * The generic content generator populates `url` and `mimetype` and nothing else,
 * so `mediaMessageSHA256B64` compared `undefined` against `undefined` on every
 * input and could not have caught a difference in the byte conversion or the
 * base64 encoding.
 */
const mediaWithDigest = (random: Random): Record<string, unknown> => {
	const kind = random.pick(['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'])
	const digest = random.pick([
		generateBytes(random),
		Buffer.from(generateBytes(random)),
		new Uint8Array(0),
		new Uint8Array(32),
		undefined
	])
	return { [kind]: { url: generateString(random), mimetype: generateString(random), fileSha256: digest } }
}

/**
 * True when a stanza carries a `<message>` child protobufjs cannot read back.
 *
 * "Cannot read back", not "cannot decode": a truncated `WebMessageInfo` prefix
 * is still structurally valid protobuf and decodes without complaint, so a
 * structural parse cannot tell it from a whole one — measured, 27 of 42
 * malformed payloads parse cleanly. Re-encoding does tell them apart: only a
 * faithful serialisation round-trips to the identical bytes.
 *
 * A non-bytes payload — a string, or nothing at all — counts as unreadable
 * outright, which is what the generator produces for two of its five branches.
 */
const stanzaCarriesUnreadablePayload = (node: unknown): boolean => {
	if (typeof node !== 'object' || node === null) return false
	const content = (node as { content?: unknown }).content
	if (!Array.isArray(content)) return false
	const children = content.filter(
		child => typeof child === 'object' && child !== null && (child as { tag?: unknown }).tag === 'message'
	)
	if (children.length === 0) return false
	return children.some(child => {
		const payload = (child as { content?: unknown }).content
		if (!(payload instanceof Uint8Array)) return true
		try {
			const bytes = new Uint8Array(payload)
			const proto = upstream.proto as { WebMessageInfo: UpstreamCodec }
			return !Buffer.from(proto.WebMessageInfo.encode(proto.WebMessageInfo.decode(bytes)).finish()).equals(
				Buffer.from(bytes)
			)
		} catch {
			return true
		}
	})
}

interface UpstreamCodec {
	encode(message: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): unknown
}

interface PureTarget {
	/** Export name, identical in both packages. */
	readonly name: string
	readonly generate: (random: Random) => Args
	/** Iterations in smoke mode. */
	readonly runs?: number
	/**
	 * A tag describing the *input*, appended to the finding's detail.
	 *
	 * For the handful of targets where "is this input well-formed" needs a
	 * reference the allowlist registry cannot reach. `harness/divergence.ts`
	 * deliberately depends on nothing but the harness, so a predicate there can
	 * inspect the argument tuple structurally but cannot ask protobufjs whether a
	 * payload is a real `WebMessageInfo` — and for `getBinaryNodeMessages` that
	 * is the entire difference between the documented behaviour and a regression.
	 * Classifying here, where both libraries are already imported, keeps the
	 * registry honest without dragging a decoder into it.
	 */
	readonly tag?: (args: Args, localResult: unknown, upstreamResult: unknown) => string | undefined
}

/**
 * A message key, including the `*Alt` fields.
 *
 * `getKeyAuthor` resolves `participantAlt || remoteJidAlt || participant ||
 * remoteJid`. Without the first two the differential only ever exercised the
 * last two branches, so a codec that reordered that precedence — or dropped an
 * alt field entirely — read as agreement. Empty strings are drawn on purpose:
 * the operator is `||`, so `''` has to fall through to the next branch, and
 * that fall-through is the part most likely to drift.
 */
const altJid = (random: Random) =>
	random.weighted<() => string | undefined>([
		[6, () => undefined],
		[3, () => generateJid(random)],
		[1, () => '']
	])()

/**
 * Text for `extractUrlFromText`, which is one `String.match` against
 * `URL_REGEX` and returns the first hit.
 *
 * Measured over 250 draws of the generic string generator: *zero* matched, so
 * the differential only ever compared `undefined` to `undefined` — a regex that
 * had been changed on one side to match nothing at all would have passed. The
 * cases below are built around the parts of that pattern that can drift: the
 * https-only prefix, the two-letter TLD minimum, the optional port and path,
 * where the match stops (whitespace), which of several URLs comes back first,
 * and the negative lookahead that rejects `user:pass@host` — the one rule in
 * there that exists for a security reason rather than a parsing one.
 */
const urlText = (random: Random): string => {
	const host = () =>
		random.pick([
			'example.com',
			'a.co',
			'sub.domain.example.org',
			'xn--80ak6aa92e.com',
			'127.0.0.1.nip.io',
			'UPPER.CASE.NET'
		])
	const port = () => (random.bool(0.25) ? `:${random.pick([80, 443, 8080, 0, 65535, 99999])}` : '')
	const path = () =>
		random.bool(0.5) ? random.pick(['/', '/a/b?c=d&e=f', '/#frag', '/%20%zz', '/trailing.', '/a b']) : ''
	const url = () => `https://${host()}${port()}${path()}`

	return random.weighted<() => string>([
		// A bare URL, and a URL embedded in surrounding words — the match has to
		// start and stop in the right place.
		[4, url],
		[3, () => `${random.pick(['see ', 'go to ', '(', 'x'])}${url()}${random.pick([' now', ')', '', '\nnext'])}`],
		// More than one: the helper returns the *first*, and which one that is has
		// to be the same on both sides.
		[2, () => `${url()} and ${url()}`],
		// Near-misses that must not match: wrong scheme, single-letter TLD, no TLD,
		// and the credential form the lookahead exists to reject.
		[
			2,
			() =>
				random.pick([
					'http://example.com',
					'https://example.c',
					'https://localhost',
					'https://user:pass@example.com/x',
					'https://user:pass@example.com and https://example.net',
					'httpsx://example.com',
					'https://'
				])
		],
		[1, () => generateString(random)]
	])()
}

/**
 * Input for `encodeBase64EncodedStringForUpload`, which is three replacements
 * and a percent-encode: `+`→`-`, `/`→`_`, trailing `=` stripped.
 *
 * The generic string generator does not reach any of them in practice. Measured
 * over 250 draws: 8 contained `+` or `/` and *zero* ended with `=`, so the
 * padding strip — the one rule with an anchor in it, and the one most likely to
 * be got wrong — was never executed on either side. Real base64 of random bytes
 * produces all three naturally; the hand-written cases pin the edges the random
 * draw would need luck to hit.
 */
const uploadBase64 = (random: Random): string =>
	random.weighted<() => string>([
		[6, () => Buffer.from(random.bytes(random.int(1, 48))).toString('base64')],
		[
			3,
			() =>
				random.pick([
					// One, two, and no padding characters.
					'AA==',
					'AAA=',
					'AAAA',
					// Padding is only stripped at the end: an interior `=` must survive.
					'AA==BB==',
					// Nothing but padding, and the empty string.
					'====',
					'',
					// Both replaced characters, adjacent, with padding behind them.
					'+/+/==',
					// Characters encodeURIComponent has to escape but the replacements do not touch.
					'a b&c?d#e%f'
				])
		],
		[1, () => generateString(random)]
	])()

/**
 * `content` as upstream's copy would leave it, or undefined if it will not go.
 *
 * `generateWAMessageFromContent`'s upstream twin rebuilds content through the
 * protobuf codec, and that round trip is the entire difference between the two
 * implementations' copies. Running it here answers "is this difference the
 * documented one" exactly, where a structural description of its effects cannot.
 */
const attemptRoundTrip = (content: unknown): unknown => {
	try {
		const type = (upstream.proto as { Message: UpstreamMessageCodec }).Message
		return type.toObject(type.decode(type.encode(type.fromObject(structuredClone(content))).finish()), {
			longs: String,
			enums: Number,
			defaults: false,
			arrays: false,
			objects: false,
			oneofs: false
		})
	} catch {
		return undefined
	}
}

interface UpstreamMessageCodec {
	fromObject(value: unknown): unknown
	encode(message: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): unknown
	toObject(message: unknown, options: Record<string, unknown>): Record<string, unknown>
}

const messageKey = (random: Random) => ({
	remoteJid: generateMaybeJid(random),
	fromMe: random.bool(),
	id: random.pick(['ABC123', '', '3EB0' + '0'.repeat(32), 'BAE5' + 'F'.repeat(12)]),
	participant: random.bool(0.3) ? generateMaybeJid(random) : undefined,
	participantAlt: altJid(random),
	remoteJidAlt: altJid(random)
})

const receipt = (random: Random) => ({
	userJid: generateJid(random),
	receiptTimestamp: random.bool() ? generateNumber(random) : undefined,
	readTimestamp: random.bool() ? generateNumber(random) : undefined,
	playedTimestamp: random.bool() ? generateNumber(random) : undefined
})

/** A shallow message-content shape: enough to drive the content-type resolvers. */
/**
 * Mimetypes for the media branches.
 *
 * `extensionForMediaMessage` is `mimetype.split(';')[0].split('/')[1]`, so the
 * parameter and the slash are the whole of its logic. Generic hostile strings
 * contain neither: measured over 200 draws, not one carried a `;` and only 4
 * calls returned an extension at all — the other 196 threw on an absent or
 * unusable mimetype, which the oracle reads as agreement. The malformed ones
 * stay, because the split has to survive them; they just stop being all of it.
 */
const MIME_TYPES = [
	'image/jpeg',
	'image/webp',
	'video/mp4',
	'audio/ogg; codecs=opus',
	'application/pdf',
	'image/jpeg; charset=binary',
	// The shapes the two splits have to survive.
	'image/',
	'/jpeg',
	'image',
	';',
	''
] as const

const mediaBody = (random: Random): Record<string, unknown> => ({
	url: generateString(random),
	mimetype: random.bool(0.75) ? random.pick(MIME_TYPES) : generateString(random)
})

const messageContent = (random: Random, depth = 2): Record<string, unknown> => {
	const key = random.pick([
		'conversation',
		'extendedTextMessage',
		'imageMessage',
		'videoMessage',
		'documentMessage',
		'audioMessage',
		'stickerMessage',
		'reactionMessage',
		// `cleanMessage` normalises the key inside these two, and `isRealMessage`
		// treats both as non-real. Neither was reachable: `pollUpdateMessage` was
		// not in this list at all, and `reactionMessage` fell through to the media
		// body below, so all 16 draws of it on the fixed seed carried `{url,
		// mimetype}` and no `.key` — `normaliseKey(undefined)` then threw on both
		// sides, which the oracle reads as agreement.
		'pollUpdateMessage',
		// The three types `extensionForMediaMessage` special-cases to `.jpeg`
		// before it ever looks at a mimetype. None was reachable, so a regression
		// removing that branch passed every run.
		'locationMessage',
		'liveLocationMessage',
		'productMessage',
		'protocolMessage',
		'ephemeralMessage',
		'viewOnceMessage',
		'viewOnceMessageV2',
		'viewOnceMessageV2Extension',
		'documentWithCaptionMessage',
		'editedMessage',
		'deviceSentMessage',
		'senderKeyDistributionMessage',
		'pollCreationMessage',
		'messageContextInfo'
	])

	const wrappers = new Set([
		'ephemeralMessage',
		'viewOnceMessage',
		'viewOnceMessageV2',
		'viewOnceMessageV2Extension',
		'documentWithCaptionMessage',
		'editedMessage',
		'deviceSentMessage'
	])

	if (wrappers.has(key)) {
		// Wrappers nest, and the unwrapping helpers recurse — so nest them, including
		// past the point where a naive implementation would blow the stack.
		const inner = depth > 0 ? messageContent(random, depth - 1) : { conversation: generateString(random) }
		return { [key]: random.bool(0.85) ? { message: inner } : random.pick([{}, undefined, inner]) }
	}

	if (key === 'conversation') return { conversation: generateString(random) }
	if (key === 'extendedTextMessage') {
		return {
			extendedTextMessage: {
				text: generateString(random),
				contextInfo: random.bool(0.5)
					? { stanzaId: generateString(random), participant: generateMaybeJid(random) }
					: undefined
			}
		}
	}
	// The two with a nested key `cleanMessage` rewrites. Usually present, so the
	// `fromMe`/`remoteJid`/`participant` rewrites actually run; sometimes absent,
	// because both implementations reaching `normaliseKey(undefined)` is a real
	// shared behaviour and dropping it would stop testing that they still agree.
	if (key === 'reactionMessage') {
		return {
			reactionMessage: {
				key: random.bool(0.85) ? messageKey(random) : undefined,
				text: generateString(random)
			}
		}
	}
	if (key === 'pollUpdateMessage') {
		return {
			pollUpdateMessage: {
				pollCreationMessageKey: random.bool(0.85) ? messageKey(random) : undefined,
				senderTimestampMs: generateNumber(random)
			}
		}
	}
	// The `.jpeg` types carry no mimetype in practice, and the helper never reads
	// one for them — giving them a media body would test the wrong branch.
	if (key === 'locationMessage' || key === 'liveLocationMessage' || key === 'productMessage') {
		return {
			[key]: random.bool(0.8)
				? { degreesLatitude: generateNumber(random), degreesLongitude: generateNumber(random) }
				: {}
		}
	}
	return { [key]: random.bool(0.7) ? mediaBody(random) : {} }
}

/** A deliberately over-nested wrapper chain, to compare recursion limits rather than shapes. */
const deeplyNestedContent = (random: Random): Record<string, unknown> => {
	let content: Record<string, unknown> = { conversation: 'bottom' }
	// Drawn once. Re-drawing the bound every iteration compounds a survival
	// probability instead of choosing a depth: measured over 500 chains, the
	// median came out at 24 and nothing exceeded 67, so the hundreds-deep case
	// this generator exists for was unreachable. Drawn once: median 196, 364 of
	// 500 past 100.
	const target = random.int(1, 400)
	for (let depth = 0; depth < target; depth++) {
		content = {
			[random.pick(['ephemeralMessage', 'viewOnceMessage', 'documentWithCaptionMessage'])]: { message: content }
		}
	}
	return content
}

const TARGETS: readonly PureTarget[] = [
	// ---- src/WABinary/jid-utils.ts -----------------------------------------
	{ name: 'jidDecode', generate: random => [generateMaybeJid(random)], runs: 400 },
	{
		name: 'jidEncode',
		generate: random => [
			random.weighted<unknown>([
				[6, generateString(random)],
				[2, generateNumber(random)],
				[1, null],
				[1, undefined]
			]),
			random.pick(JID_SERVERS),
			random.bool(0.5) ? generateNumber(random) : undefined,
			random.bool(0.3) ? generateNumber(random) : undefined
		],
		runs: 400
	},
	{ name: 'jidNormalizedUser', generate: random => [generateMaybeJid(random)], runs: 400 },
	{ name: 'areJidsSameUser', generate: random => generateJidPair(random), runs: 400 },
	{ name: 'transferDevice', generate: random => generateJidPair(random), runs: 300 },
	{
		name: 'getServerFromDomainType',
		generate: random => [
			random.pick(JID_SERVERS),
			random.weighted<unknown>([
				[4, random.pick([0, 1, 128, 129])],
				[3, generateNumber(random)],
				[2, undefined],
				[1, generateString(random)]
			])
		]
	},
	...(
		[
			'isJidBot',
			'isJidBroadcast',
			'isJidGroup',
			'isJidMetaAI',
			'isJidNewsletter',
			'isJidStatusBroadcast',
			'isLidUser',
			'isPnUser',
			'isHostedLidUser',
			'isHostedPnUser'
		] as const
	).map(name => ({ name, generate: (random: Random) => [generateMaybeJid(random)], runs: 300 })),

	// ---- src/Utils/generics.ts ---------------------------------------------
	{
		name: 'encodeBigEndian',
		generate: random => [generateNumber(random), random.bool(0.7) ? random.pick([1, 2, 3, 4, 8, 0, -1]) : undefined]
	},
	{ name: 'unpadRandomMax16', generate: random => [generateBytes(random)], runs: 300 },
	{
		name: 'toNumber',
		generate: random => [
			random.weighted<unknown>([
				[3, generateNumber(random)],
				[
					3,
					{
						low: random.int(-2_147_483_648, 2_147_483_647),
						high: random.int(-2_147_483_648, 2_147_483_647),
						unsigned: random.bool()
					}
				],
				[2, generateString(random)],
				[2, undefined],
				[1, null],
				[1, generateAnyValue(random)]
			])
		]
	},
	{ name: 'isStringNullOrEmpty', generate: random => [generateAnyValue(random)] },
	{
		name: 'getKeyAuthor',
		generate: random => [random.bool(0.9) ? messageKey(random) : undefined, generateMaybeJid(random)]
	},
	{
		name: 'getStatusFromReceiptType',
		generate: random => [
			random.weighted<unknown>([
				[
					5,
					random.pick(['read', 'read-self', 'played', 'hist_sync', 'peer_msg', 'sender', 'inactive', 'delivery', ''])
				],
				[2, generateString(random)],
				[1, undefined]
			])
		]
	},
	{
		name: 'getCallStatusFromNode',
		// Call tags, not the generic pool: none of the tags this switches on appear
		// there, so every input fell to the `ringing` default.
		generate: random => [random.bool(0.85) ? generateCallNode(random) : generateBinaryNode(random, 1)],
		runs: 250
	},
	{
		name: 'getErrorCodeFromStreamError',
		// A real stream error most of the time: the generic error node names its
		// child `error` and puts the code on the child, so every case took the same
		// bad-session default.
		generate: random => [random.bool(0.85) ? generateStreamErrorNode(random) : generateErrorNode(random)],
		runs: 250
	},
	{
		name: 'isWABusinessPlatform',
		generate: random => [
			random.weighted<unknown>([
				[4, random.pick(['smba', 'smbi', 'android', 'ios', ''])],
				[2, generateString(random)]
			])
		]
	},
	{ name: 'bytesToCrockford', generate: random => [Buffer.from(generateBytes(random))], runs: 250 },
	{
		name: 'trimUndefined',
		generate: random => {
			const object: Record<string, unknown> = {}
			const keyCount = random.int(0, 6)
			for (let index = 0; index < keyCount; index++) {
				const key = random.pick(['a', 'b', 'c', 'id', '__proto__', ''])
				const value = random.bool(0.4) ? undefined : generateAnyValue(random)
				Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
			}
			return [object]
		}
	},
	{
		name: 'unixTimestampSeconds',
		// No `undefined`: the two implementations would each call `Date.now()`, and a
		// pair of calls straddling a second boundary reports a difference that is not
		// one — a flake no seed can reproduce.
		generate: random => [
			random.weighted<unknown>([
				[4, new Date(random.int(0, 4_102_444_800_000))],
				[1, new Date(Number.NaN)],
				[1, new Date(-1)]
			])
		]
	},
	{
		name: 'generateParticipantHashV2',
		generate: random => [Array.from({ length: random.int(0, 8) }, () => generateJid(random))],
		runs: 200
	},
	{ name: 'encodeNewsletterMessage', generate: random => [messageContent(random)], runs: 250 },

	// ---- src/Utils/messages.ts ---------------------------------------------
	{
		name: 'getContentType',
		generate: random => [random.bool(0.9) ? messageContent(random) : (random.pick([undefined, null, {}]) as unknown)],
		runs: 400
	},
	{
		name: 'normalizeMessageContent',
		generate: random =>
			random.bool(0.12) ? [deeplyNestedContent(random)] : [random.bool(0.9) ? messageContent(random) : undefined],
		runs: 300
	},
	{
		name: 'extractMessageContent',
		generate: random =>
			random.bool(0.12) ? [deeplyNestedContent(random)] : [random.bool(0.9) ? messageContent(random) : undefined],
		runs: 300
	},
	{
		name: 'getDevice',
		generate: random => [
			random.weighted<unknown>([
				[4, random.pick(['3EB0' + 'A'.repeat(32), 'BAE5' + 'B'.repeat(12), '3A' + 'C'.repeat(16), 'ABCD'])],
				[3, generateString(random)],
				[1, undefined]
			])
		]
	},
	{
		name: 'aggregateMessageKeysNotFromMe',
		// The helper buckets by `${remoteJid}:${participant || ''}`, so what it has
		// to get right is which keys share a bucket. Independently generated keys
		// never collided on a valid chat — 0 of 200 draws on the fixed seed — and
		// the only repeated composite keys were the malformed `undefined:` ones. A
		// regression that bucketed by `remoteJid` alone, merging two participants'
		// receipts in a group, therefore passed every run.
		//
		// So a chat and a participant are drawn first and shared across the batch:
		// same chat and same participant (one bucket), same chat and different
		// participants (which must stay separate), and unrelated keys alongside.
		generate: random => {
			const chat = generateJid(random)
			const participant = generateJid(random)
			const other = generateJid(random)
			return [
				Array.from({ length: random.int(0, 6) }, () =>
					random.weighted<() => Record<string, unknown>>([
						[3, () => ({ ...messageKey(random), fromMe: false, remoteJid: chat, participant })],
						[3, () => ({ ...messageKey(random), fromMe: false, remoteJid: chat, participant: other })],
						// Same chat, no participant at all: `participant || ''` puts these in
						// their own bucket, which is a third case and not the same as either.
						[2, () => ({ ...messageKey(random), fromMe: false, remoteJid: chat, participant: undefined })],
						// `fromMe` keys are skipped entirely, and unrelated keys keep the
						// batch from being one bucket by construction.
						[1, () => ({ ...messageKey(random), fromMe: true, remoteJid: chat, participant })],
						[3, () => messageKey(random)]
					])()
				)
			]
		},
		runs: 200
	},
	{
		name: 'hasNonNullishProperty',
		// The helper is `key in message && message[key] !== null && !== undefined`,
		// so the whole of it lives in whether the object actually has the key.
		// Drawing an arbitrary object and an independent hostile string as the key
		// meant it essentially never did — 1 of 150 draws on the fixed seed — so
		// every call took the false branch and an implementation that returned
		// `false` unconditionally passed. The key is now drawn from the object's own
		// property names most of the time, across the five cases that decide the
		// answer: a real value, `null`, `undefined`, absent, and inherited.
		generate: random => {
			const value = random.weighted<() => unknown>([
				[4, () => generateString(random)],
				[2, () => null],
				[2, () => undefined],
				[1, () => 0],
				[1, () => false]
			])()
			const own = random.pick(['text', 'caption', 'image', 'delete', '__proto__', 'constructor', ''])
			const object: Record<string, unknown> = {}
			// `defineProperty`, not assignment: `object.__proto__ = x` moves the
			// prototype instead of creating an own property, and `__proto__` is one of
			// the keys worth asking about.
			Object.defineProperty(object, own, { value, enumerable: true, writable: true, configurable: true })

			return [
				random.bool(0.8) ? object : generateAnyValue(random),
				random.weighted<() => unknown>([
					// The key the object owns: the true branch, and the two nullish
					// values that must still answer false despite `in` succeeding.
					[5, () => own],
					// A key it does not own, but which `in` finds on the prototype —
					// `toString`, `valueOf`. The helper uses `in`, so these answer true,
					// and that is worth pinning rather than discovering later.
					[2, () => random.pick(['toString', 'valueOf', 'hasOwnProperty', 'constructor'])],
					[2, () => random.pick(HOSTILE_STRINGS)]
				])()
			]
		}
	},
	{
		name: 'updateMessageWithReceipt',
		// The helper merges in place when a receipt for the same `userJid` is already
		// stored, and appends otherwise. Two independently generated receipts almost
		// never share a jid, so the merge branch — the one that can duplicate a user
		// or fail to overwrite their timestamps — was effectively never taken.
		generate: random => {
			const incoming = receipt(random)
			const stored = { ...receipt(random), userJid: random.bool(0.6) ? incoming.userJid : generateJid(random) }
			return [{ userReceipt: random.bool(0.75) ? [stored] : random.pick([[], undefined]) }, incoming]
		}
	},
	{
		name: 'updateMessageWithReaction',
		// The helper's whole job is "replace the previous reaction from the same
		// author, then append". Drawing the stored and incoming keys independently
		// left that replacement essentially unexercised: of 150 draws on the fixed
		// seed, 79 carried a stored reaction and the filter removed it 18 times —
		// but all 18 were the degenerate case where both keys have `fromMe: true`
		// and `getKeyAuthor` returns the same `'me'` for both. Zero shared an actual
		// JID author, so a regression in author resolution for anyone *else's*
		// reaction, or one that left two reactions from one participant, stayed
		// green. The stored key is now the incoming one most of the time, the same
		// way the receipt and poll-update generators already do it.
		generate: random => {
			const incoming = { key: messageKey(random), text: random.bool(0.8) ? generateString(random) : undefined }
			const storedKey = random.weighted<() => Record<string, unknown>>([
				// The same author, same key: the replacement has to fire.
				[5, () => ({ ...incoming.key })],
				// The same author reached by a different spelling of the key, so the
				// resolution order in `getKeyAuthor` is what decides it rather than a
				// shallow object comparison.
				[3, () => ({ ...messageKey(random), participantAlt: incoming.key.participantAlt })],
				// An unrelated author: the append path, which still has to work.
				[3, () => messageKey(random)]
			])()
			return [
				{ reactions: random.bool(0.75) ? [{ key: storedKey, text: generateString(random) }] : undefined },
				incoming
			]
		}
	},
	{
		name: 'updateMessageWithPollUpdate',
		// The helper replaces any prior update from the same author and keeps the new
		// one only when it carries a non-empty vote. With no stored updates and no
		// selectedOptions, every input took the empty-vote path and left the list
		// empty — neither insertion nor replacement was ever compared. So the message
		// starts with an update, often from the same author as the incoming one.
		generate: random => {
			const author = messageKey(random)
			const existing = random.bool(0.7)
				? [
						{
							pollUpdateMessageKey: random.bool(0.6) ? author : messageKey(random),
							vote: { selectedOptions: [Buffer.from(generateBytes(random))] },
							senderTimestampMs: generateNumber(random)
						}
					]
				: random.pick([[], undefined])
			return [
				{ pollUpdates: existing },
				{
					pollUpdateMessageKey: author,
					vote: random.bool(0.7)
						? { selectedOptions: Array.from({ length: random.int(1, 2) }, () => Buffer.from(generateBytes(random))) }
						: random.pick([{ selectedOptions: [] }, {}, undefined]),
					senderTimestampMs: generateNumber(random)
				}
			]
		}
	},
	{
		name: 'prepareDisappearingMessageSettingContent',
		generate: random => [random.bool(0.8) ? generateNumber(random) : undefined]
	},
	{
		name: 'assertMediaContent',
		generate: random => [random.bool(0.85) ? messageContent(random) : undefined],
		runs: 250
	},

	// ---- src/WABinary/generic-utils.ts -------------------------------------
	{
		name: 'getBinaryNodeChild',
		generate: random => [generateBinaryNode(random), random.pick(['error', 'item', 'participant', 'missing', ''])],
		runs: 250
	},
	{
		name: 'getBinaryNodeChildren',
		generate: random => [generateBinaryNode(random), random.pick(['error', 'item', 'participant', 'missing', ''])],
		runs: 250
	},
	{ name: 'getAllBinaryNodeChildren', generate: random => [generateBinaryNode(random)], runs: 250 },
	// These three read the *content* of the child they find, so the child has to
	// carry the tag being queried and bytes to read. Drawing the tag and the
	// content independently left every case returning undefined — see
	// `generateTaggedNode`.
	{
		name: 'getBinaryNodeChildBuffer',
		generate: random => {
			// The queried tag first, then a node built to carry it — see
			// `generateTaggedNode`.
			const tag = random.pick(CONTENT_TAGS)
			return [generateTaggedNode(random, CONTENT_TAGS, tag), tag]
		},
		runs: 250
	},
	{
		name: 'getBinaryNodeChildString',
		generate: random => {
			const tag = random.pick(CONTENT_TAGS)
			return [generateTaggedNode(random, CONTENT_TAGS, tag), tag]
		},
		runs: 250
	},
	{
		name: 'getBinaryNodeChildUInt',
		generate: random => {
			const tag = random.pick(CONTENT_TAGS)
			return [generateTaggedNode(random, CONTENT_TAGS, tag), tag, random.pick([1, 2, 3, 4, 8, 0])]
		},
		runs: 250
	},
	{
		name: 'reduceBinaryNodeToDictionary',
		generate: random => [generateDictionaryNode(random), random.pick(['item', 'missing'])],
		runs: 250
	},
	{
		// Both shapes: `generateErrorNode` always carries an `<error>` child, so on
		// its own it only ever exercised the throwing path.
		name: 'assertNodeErrorFree',
		generate: random => [random.bool(0.8) ? generateResponseNode(random) : generateErrorNode(random)],
		runs: 250
	},
	{
		name: 'binaryNodeToString',
		generate: random => [generateBinaryNode(random) as unknown as BinaryNode['content']],
		runs: 200
	},
	{
		name: 'getBinaryNodeMessages',
		generate: random => [random.bool(0.85) ? generateMessageStanza(random) : generateBinaryNode(random)],
		runs: 200,
		// Whether the stanza carries a `<message>` child the reference decoder
		// cannot read back. The two decoders' documented difference is entirely
		// about *malformed* payloads, and without this the allowlist entry could
		// only say "exactly one side threw" — which a regression that started
		// throwing on a perfectly good stanza also satisfies. Measured over 400
		// draws: all 42 one-sided throws carry at least one unfaithful payload,
		// and none carries only faithful ones.
		tag: args => (stanzaCarriesUnreadablePayload(args[0]) ? 'malformed payload' : 'well-formed payloads')
	},

	// ---- src/Utils/crypto.ts (the deterministic half) ----------------------
	// Sizes are generated off-spec on purpose: a 31-byte AES key has to fail the
	// same way on both sides, and "one throws, the other pads" is a real bug.
	{
		name: 'aesEncrypWithIV',
		generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)],
		runs: 200
	},
	{
		name: 'aesDecryptWithIV',
		generate: random => {
			if (random.bool(0.3)) return [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)]
			const { sealed, key, iv } = cbcTuple(random)
			return random.bool(0.75) ? [sealed, key, iv] : [corrupt(random, sealed), key, iv]
		},
		runs: 200
	},
	{
		name: 'aesDecrypt',
		// The IV is the first 16 bytes of the buffer here, so the tuple is prefixed
		// rather than passed separately.
		generate: random => {
			if (random.bool(0.3)) return [cryptoBuffer(random), cryptoKey(random)]
			const { sealed, key, iv } = cbcTuple(random)
			const framed = Buffer.concat([iv, sealed])
			return random.bool(0.75) ? [framed, key] : [corrupt(random, framed), key]
		},
		runs: 200
	},
	{ name: 'aesEncryptCTR', generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)], runs: 200 },
	{ name: 'aesDecryptCTR', generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)], runs: 200 },
	{
		name: 'aesEncryptGCM',
		generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoNonce(random), cryptoBuffer(random)],
		runs: 200
	},
	{
		name: 'aesDecryptGCM',
		// Most cases are a real encrypt-then-decrypt tuple, sometimes with one piece
		// corrupted. Generating the four arguments independently means the tag can
		// never authenticate, so both sides only ever threw — and the comparator
		// reads two throws as agreement, so successful plaintext recovery, which is
		// the entire point of the helper, was never compared.
		generate: random => {
			const key = Buffer.from(random.bytes(32))
			const nonce = Buffer.from(random.bytes(12))
			const additional = cryptoBuffer(random)
			const plaintext = cryptoBuffer(random)
			const cipher = createCipheriv('aes-256-gcm', key, nonce)
			if (additional.length > 0) cipher.setAAD(additional)
			const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])

			if (random.bool(0.7)) return [sealed, key, nonce, additional]
			// One piece off, so the reject path stays covered too.
			return random.pick([
				[corrupt(random, sealed), key, nonce, additional],
				[sealed, cryptoKey(random), nonce, additional],
				[sealed, key, cryptoNonce(random), additional],
				[sealed, key, nonce, cryptoBuffer(random)]
			])
		},
		runs: 200
	},
	{
		name: 'hkdf',
		generate: random => [
			cryptoBuffer(random),
			random.pick([0, 1, 16, 32, 64, 80, 255, 8_160, 8_161]),
			random.bool(0.8)
				? { salt: random.bool(0.6) ? cryptoBuffer(random) : undefined, info: generateString(random) }
				: {}
		],
		runs: 200
	},
	{
		name: 'hkdfInfoKey',
		generate: random => [
			random.pick(['image', 'video', 'audio', 'document', 'sticker', 'thumbnail-link', 'md-app-state', 'unknown', ''])
		]
	},
	{
		name: 'hmacSign',
		generate: random => [cryptoBuffer(random), cryptoKey(random), random.pick(['sha256', 'sha512', undefined, 'md5'])],
		runs: 200
	},
	{ name: 'md5', generate: random => [cryptoBuffer(random)], runs: 150 },
	{ name: 'sha256', generate: random => [cryptoBuffer(random)], runs: 150 },
	{
		name: 'generateSignalPubKey',
		generate: random => [
			random.weighted<unknown>([
				[4, random.bytes(32)],
				[3, random.bytes(33)],
				[2, generateBytes(random)]
			])
		],
		runs: 150
	},

	// ---- auth, signal and media helpers ------------------------------------
	{
		name: 'assertMeId',
		generate: random => [
			random.bool(0.8)
				? { me: random.bool(0.8) ? { id: generateMaybeJid(random) } : undefined }
				: generateAnyValue(random)
		]
	},
	{
		name: 'buildAckStanza',
		generate: random => [
			generateBinaryNode(random, 1),
			random.bool(0.5) ? generateNumber(random) : undefined,
			random.bool(0.5) ? generateMaybeJid(random) : undefined
		],
		runs: 200
	},
	{
		name: 'cleanMessage',
		generate: random => [
			{ key: messageKey(random), message: messageContent(random), participant: generateMaybeJid(random) },
			generateJid(random),
			generateJid(random)
		],
		runs: 200
	},
	{ name: 'createSignalIdentity', generate: random => [generateJid(random), generateBytes(random)], runs: 150 },
	{
		name: 'decodeMediaRetryNode',
		// Mostly well-formed retry stanzas, with the odd error node: feeding it only
		// error nodes reached the missing-`rmr` throw and nothing else.
		generate: random => [random.bool(0.85) ? generateMediaRetryNode(random) : generateErrorNode(random)],
		runs: 200
	},
	{
		name: 'extractDeviceJids',
		// The helper drops the caller's own device: it keeps a row only when
		// `(myUser !== user && myLid !== user) || myDevice !== device`. With the
		// query rows and the `myJid`/`myLid` arguments drawn independently, that
		// branch was never reached — measured at 0 of 366 generated device rows on
		// the fixed seed — so a regression that handed the caller its own device
		// back alongside its peers' stayed green.
		//
		// So the current identity is planted into some rows. Both device numbers
		// matter: the exclusion needs the user *and* the device to match, so a row
		// with the right user and a different device is the near-miss that must
		// still be kept, and it is the pair that pins the `&&`.
		generate: random => {
			const myJid = generateJid(random)
			const myLid = generateJid(random)
			const myUser = myJid.split('@')[0]!
			const myDevice = Number(myUser.split(':')[1] ?? 0)
			const rows = Array.from({ length: random.int(0, 3) }, () => ({
				// One row in three is the caller's own user, so the exclusion is
				// reachable at all; the rest are peers.
				id: random.bool(0.35) ? myJid : generateJid(random),
				devices: {
					deviceList: Array.from({ length: random.int(0, 3) }, () => ({
						// And within such a row, the caller's own device number as often as
						// any other — that is the difference between reaching the branch
						// and merely reaching the row.
						id: random.bool(0.4) ? myDevice : random.int(0, 5),
						keyIndex: random.int(0, 5),
						isHosted: random.bool()
					}))
				}
			}))
			return [rows, myJid, myLid, random.bool()]
		},
		runs: 200
	},
	{
		name: 'extractE2ESessionFromRetryReceipt',
		// A real key bundle most of the time: the generic generator has no `keys`
		// child, so every input returned null at the first lookup.
		generate: random => [random.bool(0.85) ? generateRetryReceiptNode(random) : generateBinaryNode(random)],
		runs: 200
	},
	{ name: 'getChatId', generate: random => [messageKey(random)], runs: 200 },
	{
		name: 'isRealMessage',
		generate: random => [
			{
				key: messageKey(random),
				message: messageContent(random),
				messageStubType: random.bool(0.4) ? random.int(0, 80) : undefined
			}
		],
		runs: 200
	},
	{
		name: 'shouldIncrementChatUnread',
		generate: random => [
			{
				key: messageKey(random),
				message: messageContent(random),
				messageStubType: random.bool(0.4) ? random.int(0, 80) : undefined
			}
		],
		runs: 200
	},
	{
		name: 'getHistoryMsg',
		generate: random => [random.bool(0.8) ? historyNotificationContent(random) : messageContent(random)],
		runs: 200
	},
	{
		name: 'getPlatformId',
		generate: random => [random.pick(['Chrome', 'Firefox', 'Safari', 'Edge', 'Opera', 'Desktop', '', 'unknown'])]
	},
	{
		name: 'getCompanionPlatformId',
		generate: random => [
			[
				random.pick(['Ubuntu', 'Mac OS', 'Windows', '']),
				random.pick(['Chrome', 'Firefox', 'Safari', '']),
				random.pick(['110.0', ''])
			]
		]
	},
	{
		name: 'getCompanionWebClientType',
		generate: random => [
			[
				random.pick(['Ubuntu', 'Mac OS', 'Windows', '']),
				random.pick(['Chrome', 'Firefox', 'Safari', 'Edge', 'Opera', '']),
				random.pick(['110.0', ''])
			]
		]
	},
	{ name: 'getStatusCodeForMediaRetry', generate: random => [generateNumber(random)] },
	{
		name: 'getUrlFromDirectPath',
		generate: random => [generateString(random), random.bool(0.5) ? generateString(random) : undefined]
	},
	{ name: 'extensionForMediaMessage', generate: random => [messageContent(random)], runs: 200 },
	{
		name: 'mediaMessageSHA256B64',
		generate: random => [random.bool(0.85) ? mediaWithDigest(random) : messageContent(random)],
		runs: 200
	},
	{ name: 'encodeBase64EncodedStringForUpload', generate: random => [uploadBase64(random)], runs: 200 },
	{
		name: 'xmppPreKey',
		generate: random => [{ public: generateBytes(random), private: generateBytes(random) }, generateNumber(random)],
		runs: 150
	},
	{
		name: 'xmppSignedPreKey',
		generate: random => [
			{
				keyPair: { public: generateBytes(random), private: generateBytes(random) },
				signature: generateBytes(random),
				keyId: generateNumber(random)
			}
		],
		runs: 150
	},
	{ name: 'extractUrlFromText', generate: random => [urlText(random)], runs: 250 },
	{
		name: 'generateForwardMessageContent',
		generate: random => [
			{ key: messageKey(random), message: messageContent(random) },
			random.bool(0.5) ? random.bool() : undefined
		],
		runs: 200,
		// Whether the whole difference is the copy strategy, answered by running
		// that strategy rather than describing it.
		//
		// The two implementations differ only in how they copy: upstream rebuilds
		// content through `proto.Message.decode(proto.Message.encode(content))`
		// while baileyrs shallow-clones. So the difference is explained exactly when
		// upstream's result *is* that round trip of baileyrs' result — which the
		// registry cannot compute, having no protobuf runtime.
		//
		// This replaced a structural rule that tried to describe the round trip's
		// effects from outside, and got them wrong in both directions: it excused a
		// dropped `extendedTextMessage.text` — a declared field, real body loss —
		// and once tightened it reported a `deviceSentMessage` carrying an
		// undeclared property as unexplained. Only the schema separates those two,
		// and the round trip *is* the schema. Measured: upstream equals the round
		// trip for both of those, and does not for a simulated body drop or a
		// changed value.
		tag: (_args, mine, theirs) => {
			if (mine === undefined || theirs === undefined) return undefined
			const copied = attemptRoundTrip(mine)
			if (copied === undefined) return undefined
			return JSON.stringify(copied) === JSON.stringify(theirs) ? 'copy strategy' : 'not the copy strategy'
		}
	},
	{
		name: 'getAggregateVotesInPollMessage',
		generate: random => [pollWithVotes(random), random.bool(0.6) ? generateMaybeJid(random) : undefined],
		runs: 200
	},
	{
		name: 'getAggregateResponsesInEventMessage',
		// The aggregator reads `eventResponse` off each update — a convenience field
		// the runtime attaches after decryption, deliberately absent from the wire
		// protobuf. Generating the wire shape instead meant every update read as
		// UNKNOWN and the GOING / NOT_GOING / MAYBE buckets were never filled.
		generate: random => [
			{
				eventResponses: Array.from({ length: random.int(0, 4) }, () => ({
					eventResponseMessageKey: messageKey(random),
					eventResponse: random.pick(['GOING', 'NOT_GOING', 'MAYBE', 'UNKNOWN', '', undefined]),
					timestampMs: generateNumber(random)
				}))
			},
			random.bool(0.6) ? generateMaybeJid(random) : undefined
		],
		runs: 200
	},
	{
		name: 'updateMessageWithEventResponse',
		// The defining branch is the replacement: it filters out any existing
		// response from the same author before appending. With the list always empty
		// only the append ran, so a regression that left duplicates from one author,
		// or dropped a different author's response, compared equal.
		generate: random => {
			const author = messageKey(random)
			return [
				{
					eventResponses: random.bool(0.75)
						? [
								{ eventResponseMessageKey: random.bool(0.6) ? author : messageKey(random), eventResponse: 'GOING' },
								...(random.bool(0.4) ? [{ eventResponseMessageKey: messageKey(random), eventResponse: 'MAYBE' }] : [])
							]
						: random.pick([[], undefined])
				},
				{
					eventResponseMessageKey: author,
					eventResponse: random.pick(['GOING', 'NOT_GOING', 'MAYBE', undefined]),
					timestampMs: generateNumber(random)
				}
			]
		}
	},
	{ name: 'getCodeFromWSError', generate: random => [wsError(random)], runs: 200 }
]

const targetNames = TARGETS.map(target => target.name)

describe('pure helper differential — baileyrs vs baileys', () => {
	it('covers every helper this fuzzer claims to cover', () => {
		const missing = targetNames.filter(
			name => typeof local[name] !== 'function' || typeof upstream[name] !== 'function'
		)
		if (missing.length > 0) {
			throw new Error(`not a shared function export in both packages: ${missing.join(', ')}`)
		}
		const undeclared = targetNames.filter(name => !PURE_TARGET_NAMES.includes(name))
		if (undeclared.length > 0) {
			throw new Error(`add to PURE_TARGET_NAMES in targets.ts: ${undeclared.join(', ')}`)
		}
		// And the reverse. Without this, adding a name to PURE_TARGET_NAMES would
		// satisfy the coverage ledger while the helper is never actually called —
		// the ledger would be recording an intention rather than a fact.
		const covered = new Set(targetNames)
		const claimed = PURE_TARGET_NAMES.filter(name => !covered.has(name))
		if (claimed.length > 0) {
			throw new Error(`listed in PURE_TARGET_NAMES but no fuzz case builds arguments for them: ${claimed.join(', ')}`)
		}
	})

	for (const target of TARGETS) {
		it(`${target.name}`, async () => {
			const localFunction = local[target.name] as (...args: unknown[]) => unknown
			const upstreamFunction = upstream[target.name] as (...args: unknown[]) => unknown

			await fuzz<Args>({
				target: `pure:${target.name}`,
				runs: target.runs ?? 150,
				// The argument list keeps its length while shrinking: a report about
				// calling a two-argument helper with one argument answers a question
				// nobody asked.
				shrinkRoot: false,
				generate: target.generate,
				check: args => {
					// Each side gets its own copy: several of these helpers mutate their
					// first argument, and that mutation is as much a contract as the
					// return value — so both are compared.
					const localArgs = clone(args) as unknown[]
					const upstreamArgs = clone(args) as unknown[]

					const localOutcome = runOutcome(() => localFunction(...localArgs))
					const upstreamOutcome = runOutcome(() => upstreamFunction(...upstreamArgs))

					const findings: Divergence[] = []

					// `coerceScalars: false`: for a plain helper, returning the number 123
					// where upstream returns the string "123" is a real API difference —
					// `typeof`, `===` and arithmetic all expose it. The integer coercion
					// exists so a Rust u64 can be compared against a protobufjs Long, and
					// that is the codec fuzzer's problem, not this one's.
					//
					// `preservePresence: true` for the same reason one level down: a key
					// deleted and a key left holding `undefined` are different objects to
					// `Object.keys`, spread and `in`. Collapsing them made the mutation
					// check unable to see one side deleting a property — and made
					// `trimUndefined`, whose whole job is that deletion, untestable here.
					const strict = { coerceScalars: false, preservePresence: true }
					// The two results as well as the arguments: a classification like "is this
					// difference the documented copy strategy" is a statement about the
					// outputs, and only this file has the protobuf runtime to answer it.
					const tag = target.tag?.(
						args,
						localOutcome.kind === 'return' ? localOutcome.value : undefined,
						upstreamOutcome.kind === 'return' ? upstreamOutcome.value : undefined
					)
					const withTag = (detail: string) => (tag === undefined ? detail : `${detail} [${tag}]`)
					const comparison = compareOutcomes(localOutcome, upstreamOutcome, strict)
					if (!comparison.same) {
						findings.push({
							target: `pure:${target.name}`,
							input: args,
							local: showOutcome(localOutcome),
							upstream: showOutcome(upstreamOutcome),
							detail: withTag(comparison.detail ?? 'return values differ')
						})
					}

					const mutation = compareOutcomes(
						{ kind: 'return', value: localArgs },
						{ kind: 'return', value: upstreamArgs },
						strict
					)
					if (!mutation.same) {
						findings.push({
							target: `pure:${target.name}#mutation`,
							input: args,
							local: localArgs,
							upstream: upstreamArgs,
							detail: withTag('the helpers left their arguments in different states')
						})
					}

					return findings
				}
			})
		})
	}
})
