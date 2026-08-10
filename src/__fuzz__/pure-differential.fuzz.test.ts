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

import { describe, it } from 'node:test'
import type { BinaryNode } from '../Types/index.ts'
import { compareOutcomes, runOutcome, showOutcome } from './harness/compare.ts'
import type { Divergence } from './harness/divergence.ts'
import { fuzz } from './harness/runner.ts'
import type { Random } from './harness/random.ts'
import { generateBinaryNode, generateDictionaryNode, generateErrorNode } from './generators/binary-node.ts'
import { generateJid, generateJidPair, generateMaybeJid, JID_SERVERS } from './generators/jid.ts'
import {
	generateAnyValue,
	generateBytes,
	generateNumber,
	generateString,
	HOSTILE_STRINGS
} from './generators/values.ts'
import { PURE_TARGET_NAMES } from './targets.ts'

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
	if (value instanceof Error) return value
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

/** Byte sizes chosen to straddle every AES/HMAC block and key boundary. */
const cryptoBuffer = (random: Random): Buffer =>
	Buffer.from(random.bytes(random.pick([0, 1, 15, 16, 17, 31, 32, 33, 48, 64, 100])))

const cryptoKey = (random: Random): Buffer => Buffer.from(random.bytes(random.pick([32, 16, 31, 33, 0, 64])))

const cryptoIv = (random: Random): Buffer => Buffer.from(random.bytes(random.pick([16, 12, 15, 17, 0, 32])))

const cryptoNonce = (random: Random): Buffer => Buffer.from(random.bytes(random.pick([12, 16, 8, 0, 13])))

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
	for (let depth = 0; depth < random.int(1, 400); depth++) {
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
	{ name: 'getCallStatusFromNode', generate: random => [generateBinaryNode(random, 1)], runs: 250 },
	{ name: 'getErrorCodeFromStreamError', generate: random => [generateErrorNode(random)], runs: 250 },
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
			for (let index = 0; index < random.int(0, 6); index++) {
				object[random.pick(['a', 'b', 'c', 'id', '__proto__', ''])] = random.bool(0.4)
					? undefined
					: generateAnyValue(random)
			}
			return [object]
		}
	},
	{
		name: 'unixTimestampSeconds',
		generate: random => [
			random.weighted<unknown>([
				[4, new Date(random.int(0, 4_102_444_800_000))],
				[2, undefined],
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
		generate: random => [{ userReceipt: random.bool(0.5) ? [receipt(random)] : undefined }, receipt(random)]
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
		generate: random => [
			{ pollUpdates: random.bool(0.5) ? [] : undefined },
			{ pollUpdateMessageKey: messageKey(random), senderTimestampMs: generateNumber(random) }
		]
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
	{
		name: 'getBinaryNodeChildBuffer',
		generate: random => [generateBinaryNode(random), random.pick(['error', 'item', 'enc', 'missing'])],
		runs: 250
	},
	{
		name: 'getBinaryNodeChildString',
		generate: random => [generateBinaryNode(random), random.pick(['error', 'item', 'enc', 'missing'])],
		runs: 250
	},
	{
		name: 'getBinaryNodeChildUInt',
		generate: random => [
			generateBinaryNode(random),
			random.pick(['error', 'item', 'enc', 'missing']),
			random.pick([1, 2, 3, 4, 8, 0])
		],
		runs: 250
	},
	{
		name: 'reduceBinaryNodeToDictionary',
		generate: random => [generateDictionaryNode(random), random.pick(['item', 'missing'])],
		runs: 250
	},
	{ name: 'assertNodeErrorFree', generate: random => [generateErrorNode(random)], runs: 250 },
	{
		name: 'binaryNodeToString',
		generate: random => [generateBinaryNode(random) as unknown as BinaryNode['content']],
		runs: 200
	},
	{ name: 'getBinaryNodeMessages', generate: random => [generateBinaryNode(random)], runs: 200 },

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
		generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)],
		runs: 200
	},
	{ name: 'aesDecrypt', generate: random => [cryptoBuffer(random), cryptoKey(random)], runs: 200 },
	{ name: 'aesEncryptCTR', generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)], runs: 200 },
	{ name: 'aesDecryptCTR', generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoIv(random)], runs: 200 },
	{
		name: 'aesEncryptGCM',
		generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoNonce(random), cryptoBuffer(random)],
		runs: 200
	},
	{
		name: 'aesDecryptGCM',
		generate: random => [cryptoBuffer(random), cryptoKey(random), cryptoNonce(random), cryptoBuffer(random)],
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
	{ name: 'decodeMediaRetryNode', generate: random => [generateErrorNode(random)], runs: 200 },
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
	{ name: 'extractE2ESessionFromRetryReceipt', generate: random => [generateBinaryNode(random)], runs: 200 },
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
	{ name: 'getHistoryMsg', generate: random => [messageContent(random)], runs: 200 },
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
	{ name: 'mediaMessageSHA256B64', generate: random => [messageContent(random)], runs: 200 },
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
		generate: random => [
			{
				message: {
					pollCreationMessage: {
						options: Array.from({ length: random.int(0, 4) }, () => ({ optionName: generateString(random) }))
					}
				},
				pollUpdates: Array.from({ length: random.int(0, 4) }, () => ({
					pollUpdateMessageKey: messageKey(random),
					vote: { selectedOptions: [generateBytes(random)] },
					senderTimestampMs: generateNumber(random)
				}))
			},
			random.bool(0.6) ? generateMaybeJid(random) : undefined
		],
		runs: 200
	},
	{
		name: 'getAggregateResponsesInEventMessage',
		generate: random => [
			{
				eventResponses: Array.from({ length: random.int(0, 4) }, () => ({
					eventResponseMessageKey: messageKey(random),
					eventResponseMessage: { response: random.pick(['GOING', 'NOT_GOING', 'MAYBE', 'UNKNOWN', 0, 1, 2]) },
					timestampMs: generateNumber(random)
				}))
			},
			random.bool(0.6) ? generateMaybeJid(random) : undefined
		],
		runs: 200
	},
	{
		name: 'updateMessageWithEventResponse',
		generate: random => [
			{ eventResponses: random.bool(0.5) ? [] : undefined },
			{ eventResponseMessageKey: messageKey(random), timestampMs: generateNumber(random) }
		]
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

					const comparison = compareOutcomes(localOutcome, upstreamOutcome)
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
						{ kind: 'return', value: upstreamArgs }
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
