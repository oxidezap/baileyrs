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
	for (let index = 0; index < random.int(0, 5); index++) {
		attributes[random.pick(ATTRIBUTE_KEYS)] = random.bool(0.85) ? random.pick(ATTRIBUTE_VALUES) : generateString(random)
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
