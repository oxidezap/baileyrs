/**
 * BinaryNode generator.
 *
 * The node accessors in `src/WABinary/generic-utils.ts` are the first thing every
 * stanza handler touches, and they are all shape-tolerant by design: a missing
 * child, a string where bytes were expected, an attribute that is not a number.
 * The generator therefore produces well-formed stanzas most of the time and
 * violates one property at a time the rest of the time, which is how real server
 * traffic degrades.
 */

import type { BinaryNode } from '../../Types/index.ts'
import type { Random } from '../harness/random.ts'
import { generateString } from './values.ts'

const TAGS = [
	'iq',
	'message',
	'error',
	'result',
	'item',
	'participant',
	'participants',
	'device',
	'devices',
	'user',
	'list',
	'add',
	'remove',
	'promote',
	'demote',
	'stream:error',
	'ack',
	'receipt',
	'notification',
	'offline',
	'enc',
	'skmsg',
	'plaintext',
	'success',
	'failure',
	'not-authorized',
	'conflict',
	'xmlstreamend',
	'',
	'UPPER',
	'weird tag'
] as const

const ATTRIBUTE_KEYS = [
	'id',
	'type',
	'from',
	'to',
	'jid',
	'lid',
	'participant',
	'code',
	'text',
	't',
	'v',
	'edit',
	'offline',
	'count',
	'error',
	'reason',
	'class',
	'xmlns',
	'',
	'__proto__'
] as const

const ATTRIBUTE_VALUES = [
	'',
	'0',
	'1',
	'-1',
	'200',
	'401',
	'403',
	'404',
	'408',
	'428',
	'440',
	'500',
	'515',
	'not-a-number',
	'15551234567@s.whatsapp.net',
	'120363000000000000@g.us',
	'status@broadcast',
	'true',
	'false',
	'9007199254740993',
	'1e3',
	'0x10',
	' 42 ',
	'NaN'
] as const

const generateAttributes = (random: Random): Record<string, string> => {
	const attributes: Record<string, string> = {}
	const count = random.int(0, 5)
	for (let index = 0; index < count; index++) {
		const key = random.pick(ATTRIBUTE_KEYS)
		const value = random.bool(0.85) ? random.pick(ATTRIBUTE_VALUES) : generateString(random)
		// `__proto__` has to stay an own property: assigning it would call the
		// inherited setter, drop the key, and never hand the hostile shape to a
		// BinaryNode consumer at all.
		Object.defineProperty(attributes, key, { value, enumerable: true, writable: true, configurable: true })
	}
	return attributes
}

const generateContent = (random: Random, depth: number): BinaryNode['content'] =>
	random.weighted<() => BinaryNode['content']>([
		[depth > 0 ? 5 : 0, () => Array.from({ length: random.int(0, 4) }, () => generateBinaryNode(random, depth - 1))],
		[3, () => undefined],
		[2, () => random.pick(ATTRIBUTE_VALUES)],
		[2, () => random.bytes(random.int(0, 24))],
		[1, () => generateString(random)],
		[1, () => []]
	])()

export const generateBinaryNode = (random: Random, depth = 2): BinaryNode => ({
	tag: random.pick(TAGS),
	attrs: generateAttributes(random),
	content: generateContent(random, depth)
})

/** A stanza shaped like a real error reply, so the error-path helpers see their branch. */
export const generateErrorNode = (random: Random): BinaryNode => ({
	tag: random.pick(['iq', 'stream:error', 'ack', 'message']),
	attrs: { type: 'error', id: String(random.int(1, 9999)) },
	content: [
		{
			tag: 'error',
			attrs: { code: random.pick(ATTRIBUTE_VALUES), text: random.pick(['forbidden', 'not-acceptable', '']) },
			content: random.bool() ? [{ tag: random.pick(TAGS), attrs: {} }] : undefined
		}
	]
})

/**
 * An IQ reply that carries an `<error>` child only some of the time.
 *
 * `assertNodeErrorFree` throws exactly when that child is present, and
 * `generateErrorNode` always builds one — so all 250 inputs took the throwing
 * path, both sides threw, and the comparator called it agreement. The successful
 * path was never compared at all: an implementation that started rejecting every
 * ordinary error-free stanza would have passed this target.
 *
 * The error case stays the common one, since that is where the status-code
 * parsing lives; roughly a third are clean replies.
 */
export const generateResponseNode = (random: Random): BinaryNode => {
	const children: BinaryNode[] = []
	if (random.bool(0.65)) {
		children.push({
			tag: 'error',
			attrs: { code: random.pick(ATTRIBUTE_VALUES), text: random.pick(['forbidden', 'not-acceptable', '']) }
		})
	}
	// Ordinary siblings, so a clean reply is a realistic stanza rather than an
	// empty one — `assertNodeErrorFree` has to ignore all of them.
	for (let index = random.int(0, 2); index > 0; index--) {
		children.push({ tag: random.pick(['item', 'participant', 'list', 'enc']), attrs: generateAttributes(random) })
	}

	return {
		tag: random.pick(['iq', 'ack', 'result', 'message']),
		attrs: { id: String(random.int(1, 9999)), ...(random.bool(0.5) ? { type: 'error' } : {}) },
		content: random.bool(0.9) ? random.shuffle(children) : random.pick([[], undefined])
	}
}

/**
 * A parent whose children actually carry the tag the accessor will query.
 *
 * `generateBinaryNode` draws the child tag and the child content independently,
 * and the target draws the queried tag independently again — so on the fixed
 * seed none of the 250 `getBinaryNodeChildBuffer` cases and none of the 250
 * `getBinaryNodeChildUInt` cases found a child with byte content, and
 * `getBinaryNodeChildString` found one. Every one of those compared `undefined`
 * against `undefined`: the buffer extraction, the UTF-8 decode and the
 * big-endian accumulation were never run.
 *
 * So the child tag is drawn from the same pool the query is, and the content is
 * weighted toward the types these accessors are about — with the wrong types
 * still drawn, since returning `undefined` for a string is also behaviour worth
 * pinning.
 */
export const generateTaggedNode = (random: Random, tags: readonly string[], queried?: string): BinaryNode => ({
	tag: random.pick(['iq', 'notification', 'message']),
	attrs: generateAttributes(random),
	content: Array.from({ length: random.int(1, 4) }, () => ({
		// The tag the caller is about to query, when it is known. Drawing the child
		// tag and the queried tag independently left the accessor looking for a
		// child that is usually not there: measured, 52 of 250 buffer cases reached
		// a value. Passing the query in first raises that to most of them, while the
		// 15% that draw elsewhere keep the "no such child" path covered.
		tag:
			queried !== undefined && random.bool(0.85) ? queried : random.bool(0.8) ? random.pick(tags) : random.pick(TAGS),
		attrs: generateAttributes(random),
		// Thunks, so only the chosen branch draws from the stream. Passing values
		// built every branch and discarded all but one, which couples the
		// deterministic sequence to draws that are never used — a later weight edit
		// then shifts every downstream value.
		content: random.weighted<() => BinaryNode['content']>([
			// Lengths span the widths getBinaryNodeChildUInt is asked for, including
			// buffers shorter than the requested length.
			[5, () => random.bytes(random.pick([0, 1, 2, 3, 4, 8, 16]))],
			[3, () => Buffer.from(random.bytes(random.pick([1, 2, 4, 8])))],
			[3, () => generateString(random)],
			[2, () => random.pick(ATTRIBUTE_VALUES)],
			[1, () => undefined],
			[1, () => []]
		])()
	}))
})

/**
 * A node whose children are `<item>`s carrying key/value attributes, for the
 * dictionary reducer.
 *
 * `reduceBinaryNodeToDictionary` reads two attribute spellings — the key is
 * `attrs.name` or, when that is absent, `attrs.config_code`, and the value is
 * `attrs.value || attrs.config_value`. Only the first pair was generated, and
 * neither config key is in the generic attribute pool, so the fallback branch
 * never ran and a regression that dropped or miskeyed a config-code entry
 * stayed green. All four combinations are drawn now, including the ones where
 * the value side is missing and the `||` has to fall through.
 */
const dictionaryItemAttrs = (random: Random): Record<string, string> => {
	const key = random.pick(ATTRIBUTE_KEYS)
	const value = random.pick(ATTRIBUTE_VALUES)
	return random.weighted<() => Record<string, string>>([
		[4, () => ({ name: key, value })],
		[3, () => ({ config_code: key, config_value: value })],
		// Mixed spellings: the key from one pair, the value from the other. Both
		// resolutions are independent in the reducer, so both crossings are real.
		[2, () => ({ name: key, config_value: value })],
		[2, () => ({ config_code: key, value })],
		// A key with no value at all: `attrs.value || attrs.config_value` is then
		// undefined, which the reducer stores as-is.
		[1, () => ({ name: key })],
		[1, () => ({ config_code: key })]
	])()
}

export const generateDictionaryNode = (random: Random): BinaryNode => ({
	tag: random.pick(['props', 'list', 'dict']),
	attrs: generateAttributes(random),
	content: Array.from({ length: random.int(0, 6) }, () => ({
		tag: random.bool(0.8) ? 'item' : random.pick(TAGS),
		attrs: random.bool(0.8) ? dictionaryItemAttrs(random) : generateAttributes(random),
		content: undefined
	}))
})

/**
 * A media-retry reply stanza, shaped the way the server actually sends one.
 *
 * `decodeMediaRetryNode` reads `<rmr>` before anything else and does it with a
 * non-null assertion, so a node without that child throws on the first line.
 * Feeding it only malformed nodes therefore exercises exactly one branch — both
 * implementations throw, the comparator calls that agreement, and the status
 * mapping, the error branch and the ciphertext extraction are never compared at
 * all.
 *
 * So the valid shape is the common case here and the malformed ones are
 * variations on it: `<error>` present (the failure path, whose code drives
 * `getStatusCodeForMediaRetry`), `<encrypt>` with both `enc_p` and `enc_iv` (the
 * success path), and each of those with a piece missing.
 */
export const generateMediaRetryNode = (random: Random): BinaryNode => {
	const content: BinaryNode[] = []

	// Usually present — without it the decoder cannot reach any other branch.
	if (random.bool(0.85)) {
		content.push({
			tag: 'rmr',
			attrs: {
				jid: random.pick(['15551234567@s.whatsapp.net', '120363000000000000@g.us', '']),
				from_me: random.pick(['true', 'false', '']),
				...(random.bool(0.5) ? { participant: random.pick(['15550000000@s.whatsapp.net', '']) } : {})
			}
		})
	}

	if (random.bool(0.45)) {
		// The error path. The codes are the ones getStatusCodeForMediaRetry maps,
		// plus values outside its table.
		content.push({
			tag: 'error',
			attrs: { code: random.pick(['0', '1', '2', '3', '4', '5', '404', '-1', 'not-a-number', '']) }
		})
	} else if (random.bool(0.8)) {
		// The success path, sometimes missing one half of the key material.
		const encrypted: BinaryNode[] = []
		if (random.bool(0.85)) encrypted.push({ tag: 'enc_p', attrs: {}, content: random.bytes(random.pick([0, 1, 32])) })
		if (random.bool(0.85)) encrypted.push({ tag: 'enc_iv', attrs: {}, content: random.bytes(random.pick([0, 12, 16])) })
		content.push({ tag: 'encrypt', attrs: {}, content: encrypted })
	}

	return {
		tag: 'notification',
		attrs: { id: String(random.int(1, 9999)), type: 'media-retry' },
		content
	}
}

/**
 * A call stanza, using the tags `getCallStatusFromNode` actually switches on.
 *
 * The generic tag pool contains none of them, so every generated node fell to
 * the `default` arm and the helper returned `ringing` for all 250 inputs — the
 * whole mapping, including the `terminate` timeout branch, was untested while
 * the target reported coverage of it.
 */
const CALL_TAGS = [
	'offer',
	'offer_notice',
	'terminate',
	'preaccept',
	'transport',
	'relaylatency',
	'reject',
	'accept',
	'call',
	''
] as const

export const generateCallNode = (random: Random): BinaryNode => ({
	tag: random.pick(CALL_TAGS),
	attrs: {
		// `terminate` splits on exactly this value, so it has to be drawn often.
		...(random.bool(0.6) ? { reason: random.pick(['timeout', 'declined', 'busy', '', 'TIMEOUT']) } : {}),
		'call-id': random.pick(['ABC123', '']),
		from: random.pick(['15551234567@s.whatsapp.net', ''])
	},
	content: random.bool(0.3) ? [{ tag: random.pick(TAGS), attrs: {} }] : undefined
})

/**
 * A retry receipt carrying a session key bundle.
 *
 * `extractE2ESessionFromRetryReceipt` bails at the first `keys` lookup, and the
 * generic node generator has no `keys` tag — so all 200 inputs returned `null`
 * and none of the length validation, the registration-id parsing, the optional
 * pre-key or the prefixed-public-key construction was ever compared.
 *
 * The lengths and the type byte are the interesting boundaries, so they are the
 * thing that varies: 32 is the only accepted key length and 5 the only accepted
 * bundle type, and each is drawn off-value often enough to exercise the reject
 * paths as well as the accept one.
 */
export const generateRetryReceiptNode = (random: Random): BinaryNode => {
	const key = (length: number) => random.bytes(length)
	const keyLength = () => random.pick([32, 32, 32, 31, 33, 0])
	const uint = (bytes: number) => Buffer.from(random.bytes(bytes))

	const keys: BinaryNode[] = [
		// Type byte 5 is the only one accepted; anything else must reject.
		{ tag: 'type', attrs: {}, content: Buffer.from([random.pick([5, 5, 5, 4, 6])]) },
		{ tag: 'identity', attrs: {}, content: key(keyLength()) },
		{
			tag: 'skey',
			attrs: {},
			content: [
				{ tag: 'id', attrs: {}, content: uint(3) },
				{ tag: 'value', attrs: {}, content: key(keyLength()) },
				{ tag: 'signature', attrs: {}, content: key(random.pick([64, 0, 32])) }
			]
		}
	]

	// The optional pre-key: present about half the time, sometimes malformed.
	if (random.bool(0.5)) {
		keys.push({
			tag: 'key',
			attrs: {},
			content: [
				{ tag: 'id', attrs: {}, content: uint(3) },
				{ tag: 'value', attrs: {}, content: key(keyLength()) }
			]
		})
	}

	return {
		tag: 'receipt',
		attrs: { type: 'retry', from: '15551234567@s.whatsapp.net', id: String(random.int(1, 9999)) },
		content: [
			{ tag: 'registration', attrs: {}, content: uint(4) },
			{ tag: 'keys', attrs: {}, content: random.bool(0.9) ? keys : keys.slice(0, random.int(0, 2)) }
		]
	}
}

/**
 * A `<message>` stanza whose child content is a real, populated `WebMessageInfo`.
 *
 * `getBinaryNodeMessages` is the only accessor that decodes rather than reads:
 * it picks every `<message>` child and runs `WebMessageInfo.decode(...).toJSON()`
 * over its bytes. The generic node generator never produces the tag and the
 * payload together — the `message` tag exists in its pool, but its content is
 * drawn independently, so it is a string, `undefined` or a couple of random bytes
 * essentially every time. Both sides then throw, or both return `[]`, and the
 * comparator reads that as agreement. The decoder and the JSON projection — where
 * a divergence in field naming, int64 rendering or bytes encoding would actually
 * show — were never reached.
 *
 * The bytes are written here by hand rather than by either library's encoder. An
 * encoder-produced payload would make the target circular: a bug shared by the
 * encoder and the decoder cancels out, and a bug in only one library's encoder
 * feeds the two sides different-looking-but-equally-broken input. A literal wire
 * encoding is what the server sends, so it is what the fixture is.
 */
const varint = (value: bigint): number[] => {
	const bytes: number[] = []
	let remaining = value
	do {
		const byte = Number(remaining & 0x7fn)
		remaining >>= 7n
		bytes.push(remaining > 0n ? byte | 0x80 : byte)
	} while (remaining > 0n)
	return bytes
}

const varintField = (field: number, value: bigint): number[] => [...varint(BigInt(field) << 3n), ...varint(value)]

const bytesField = (field: number, payload: Uint8Array | number[]): number[] => [
	...varint((BigInt(field) << 3n) | 2n),
	...varint(BigInt(payload.length)),
	...payload
]

const stringField = (field: number, value: string): number[] => [...bytesField(field, Buffer.from(value, 'utf8'))]

/** Timestamps span the boundary where a 64-bit field stops fitting in a JS number. */
const TIMESTAMPS = [0n, 1n, 1700000000n, 4294967296n, 9007199254740991n, 9007199254740993n, 18446744073709551615n]

/** Statuses 0-5 are defined; the rest are the unknown values a newer server sends. */
const STATUSES = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 99n]

const webMessageInfo = (random: Random): number[] => {
	const key = [
		...stringField(1, random.pick(['15551234567@s.whatsapp.net', '120363000000000000@g.us', ''])),
		...varintField(2, random.bool() ? 1n : 0n),
		...stringField(3, random.bool(0.85) ? `3EB0${random.int(0, 0xffffff).toString(16).toUpperCase()}` : ''),
		...(random.bool(0.3) ? stringField(4, generateString(random)) : [])
	]

	// `conversation` and `extendedTextMessage` are the two shapes the accessor's
	// callers actually read, and the second is nested — so a projection that
	// flattens or renames a nested field shows up here and not in the first.
	const message = random.bool(0.6)
		? stringField(1, generateString(random))
		: bytesField(6, [
				...stringField(1, generateString(random)),
				...(random.bool(0.5) ? stringField(2, generateString(random)) : [])
			])

	return [
		...bytesField(1, key),
		...(random.bool(0.9) ? bytesField(2, message) : []),
		...varintField(3, random.pick(TIMESTAMPS)),
		...(random.bool(0.7) ? varintField(4, random.pick(STATUSES)) : []),
		...(random.bool(0.4) ? stringField(5, random.pick(['15550000000@s.whatsapp.net', ''])) : []),
		...(random.bool(0.5) ? stringField(19, generateString(random)) : []),
		// Repeated string: written unpacked, which is the only legal form for it.
		...(random.bool(0.3)
			? Array.from({ length: random.int(1, 3) }, () => stringField(26, generateString(random))).flat()
			: []),
		// A bytes field, so the JSON projection's base64/array choice is compared.
		...(random.bool(0.4) ? bytesField(49, random.bytes(random.pick([0, 1, 32]))) : [])
	]
}

export const generateMessageStanza = (random: Random): BinaryNode => {
	const child = (): BinaryNode => {
		const payload = webMessageInfo(random)
		return {
			tag: 'message',
			attrs: { id: String(random.int(1, 9999)) },
			content: random.weighted<BinaryNode['content']>([
				[8, Buffer.from(payload)],
				// Truncated mid-field: the decoder has to reject rather than return a
				// half-built message.
				[1, Buffer.from(payload.slice(0, Math.max(0, payload.length - random.int(1, 4))))],
				[1, Buffer.from(random.bytes(random.int(0, 16)))],
				[1, generateString(random)],
				[1, undefined]
			])
		}
	}

	return {
		tag: random.pick(['message', 'notification', 'iq']),
		attrs: generateAttributes(random),
		content: random.weighted<() => BinaryNode['content']>([
			[
				8,
				() => [
					// Non-`message` siblings have to be skipped, not decoded.
					...(random.bool(0.5) ? [{ tag: 'enc', attrs: {}, content: random.bytes(8) } as BinaryNode] : []),
					...Array.from({ length: random.int(1, 3) }, child),
					...(random.bool(0.3) ? [{ tag: 'participant', attrs: { jid: '' } } as BinaryNode] : [])
				]
			],
			[1, () => []],
			[1, () => undefined],
			[1, () => Buffer.from(webMessageInfo(random))]
		])()
	}
}

/**
 * A stream error shaped the way `getErrorCodeFromStreamError` reads one.
 *
 * That helper takes the *first child's tag* as the reason and the *parent's*
 * `code` attribute as the status. `generateErrorNode` always names its child
 * `error` and puts the code on the child, so every input resolved to reason
 * `error` with no parent code and fell to the same bad-session default — the
 * `conflict` mapping, the explicit status codes and the restart-required rewrite
 * were never compared.
 */
const STREAM_REASONS = ['conflict', 'not-authorized', 'gone', 'bad-request', 'system-shutdown', 'xml-not-well-formed']

export const generateStreamErrorNode = (random: Random): BinaryNode => ({
	tag: 'stream:error',
	// 515 is the restart-required code the helper rewrites the reason for.
	attrs: random.bool(0.6) ? { code: random.pick(['401', '403', '408', '428', '440', '500', '515', '', 'nope']) } : {},
	content: random.bool(0.85)
		? [{ tag: random.pick(STREAM_REASONS), attrs: random.bool(0.4) ? { code: random.pick(ATTRIBUTE_VALUES) } : {} }]
		: random.pick([[], undefined])
})
