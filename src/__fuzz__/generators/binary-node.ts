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

/** A node whose children are `<item>`s carrying key/value attributes, for the dictionary reducer. */
export const generateDictionaryNode = (random: Random): BinaryNode => ({
	tag: random.pick(['props', 'list', 'dict']),
	attrs: generateAttributes(random),
	content: Array.from({ length: random.int(0, 6) }, () => ({
		tag: random.bool(0.8) ? 'item' : random.pick(TAGS),
		attrs: random.bool(0.8)
			? { name: random.pick(ATTRIBUTE_KEYS), value: random.pick(ATTRIBUTE_VALUES) }
			: generateAttributes(random),
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
