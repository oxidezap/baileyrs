import assert from 'node:assert/strict'
import { it } from 'node:test'
import { proto as upstream } from 'baileys'
import { proto as local } from '../WAProto/runtime.ts'

interface Codec {
	encode(value: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): Record<string, unknown> & { toJSON(): unknown }
	fromObject(value: unknown): Record<string, unknown> & { toJSON(): unknown }
	fromPartial(value: unknown): Record<string, unknown> & { toJSON(): unknown }
	toObject(value: unknown, options?: Record<string, unknown>): Record<string, unknown>
}

const codec = (root: unknown, path: string): Codec => {
	let value = root as Record<string, unknown>
	for (const key of path.split('.')) value = value[key] as Record<string, unknown>
	return value as unknown as Codec
}

/**
 * One holder per 64-bit kind, including a field whose public name the facade
 * translates, because that path projects the partial before the codec sees it.
 */
const HOLDERS: readonly (readonly [string, string, readonly unknown[]])[] = [
	['Message.MessageHistoryMetadata', 'messageCount', [0, 7, -7, '9007199254740993']],
	['Message.MessageHistoryMetadata', 'oldestMessageTimestamp', [0, 7, 4294967296]],
	['Message.StickerPackMessage', 'stickerPackSize', [0, 7, 4294967296]],
	['WebMessageInfo', 'messageTimestamp', [0, 7, '18446744073709551615']]
]

for (const [path, field, values] of HOLDERS) {
	it(`${path}.${field} is a Long after fromPartial, as upstream's fromObject`, () => {
		const ours = codec(local, path)
		const theirs = codec(upstream, path)
		for (const value of values) {
			const partial = ours.fromPartial({ [field]: value })
			const object = theirs.fromObject({ [field]: value })
			assert.equal(partial[field]?.constructor?.name, 'Long')
			// The methods are what upstream code calls, so a word split is not enough.
			assert.equal(typeof (partial[field] as { toNumber?: unknown }).toNumber, 'function')
			assert.deepEqual(partial[field], object[field])
			assert.deepEqual(ours.toObject(partial), theirs.toObject(object))
			assert.deepEqual(partial.toJSON(), object.toJSON())
		}
	})
}

it('leaves null and undefined as they are instead of building an empty Long', () => {
	const ours = codec(local, 'Message.MessageHistoryMetadata')
	const theirs = codec(upstream, 'Message.MessageHistoryMetadata')
	for (const input of [{}, { messageCount: null }, { messageCount: undefined }]) {
		const partial = ours.fromPartial(input)
		// Nothing here becomes a Long, and the difference between this object's undefined
		// and upstream's null default is older than the conversion and invisible to toObject.
		assert.equal(partial.messageCount == null, true)
		assert.deepEqual(ours.toObject(partial), theirs.toObject(theirs.fromObject(input)))
	}
})

it('agrees with decode and fromObject on the same value', () => {
	const ours = codec(local, 'Message.MessageHistoryMetadata')
	const theirs = codec(upstream, 'Message.MessageHistoryMetadata')
	const bytes = theirs.encode({ messageCount: 7 }).finish()
	const paths = [ours.fromPartial({ messageCount: 7 }), ours.fromObject({ messageCount: 7 }), ours.decode(bytes)]
	for (const value of paths) assert.deepEqual(value.messageCount, theirs.fromObject({ messageCount: 7 }).messageCount)
	// The wire still carries the value the caller wrote.
	const partial = ours.fromPartial({ messageCount: '9007199254740993' })
	assert.deepEqual(
		Buffer.from(ours.encode(partial).finish()),
		Buffer.from(theirs.encode(theirs.fromObject({ messageCount: '9007199254740993' })).finish())
	)
	assert.deepEqual(
		ours.decode(ours.encode(partial).finish()).messageCount,
		theirs.fromObject({ messageCount: '9007199254740993' }).messageCount
	)
})
