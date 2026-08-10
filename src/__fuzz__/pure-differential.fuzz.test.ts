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

interface PureTarget {
	/** Export name, identical in both packages. */
	readonly name: string
	readonly generate: (random: Random) => Args
	/** Iterations in smoke mode. */
	readonly runs?: number
}

const messageKey = (random: Random) => ({
	remoteJid: generateMaybeJid(random),
	fromMe: random.bool(),
	id: random.pick(['ABC123', '', '3EB0' + '0'.repeat(32), 'BAE5' + 'F'.repeat(12)]),
	participant: random.bool(0.3) ? generateMaybeJid(random) : undefined
})

const receipt = (random: Random) => ({
	userJid: generateJid(random),
	receiptTimestamp: random.bool() ? generateNumber(random) : undefined,
	readTimestamp: random.bool() ? generateNumber(random) : undefined,
	playedTimestamp: random.bool() ? generateNumber(random) : undefined
})

/** A shallow message-content shape: enough to drive the content-type resolvers. */
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
	return { [key]: random.bool(0.7) ? { url: generateString(random), mimetype: generateString(random) } : {} }
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
		generate: random => [Array.from({ length: random.int(0, 6) }, () => messageKey(random))],
		runs: 200
	},
	{ name: 'hasNonNullishProperty', generate: random => [generateAnyValue(random), random.pick(HOSTILE_STRINGS)] },
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
		generate: random => [
			{ reactions: random.bool(0.5) ? [{ key: messageKey(random), text: generateString(random) }] : undefined },
			{ key: messageKey(random), text: random.bool(0.8) ? generateString(random) : undefined }
		]
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
		runs: 200
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
		generate: random => [
			Array.from({ length: random.int(0, 3) }, () => ({
				id: generateJid(random),
				devices: {
					deviceList: Array.from({ length: random.int(0, 3) }, () => ({
						id: random.int(0, 5),
						keyIndex: random.int(0, 5),
						isHosted: random.bool()
					}))
				}
			})),
			generateJid(random),
			generateJid(random),
			random.bool()
		],
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
	{ name: 'encodeBase64EncodedStringForUpload', generate: random => [generateString(random)], runs: 200 },
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
	{ name: 'extractUrlFromText', generate: random => [generateString(random)], runs: 250 },
	{
		name: 'generateForwardMessageContent',
		generate: random => [
			{ key: messageKey(random), message: messageContent(random) },
			random.bool(0.5) ? random.bool() : undefined
		],
		runs: 200
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
					const comparison = compareOutcomes(localOutcome, upstreamOutcome, strict)
					if (!comparison.same) {
						findings.push({
							target: `pure:${target.name}`,
							input: args,
							local: showOutcome(localOutcome),
							upstream: showOutcome(upstreamOutcome),
							detail: comparison.detail
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
							detail: 'the helpers left their arguments in different states'
						})
					}

					return findings
				}
			})
		})
	}
})
