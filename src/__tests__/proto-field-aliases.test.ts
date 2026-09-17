import assert from 'node:assert/strict'
import { it } from 'node:test'
import { proto as upstream } from 'baileys'
import { proto as local } from '../WAProto/runtime.ts'

interface Codec {
	encode(value: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): Record<string, unknown> & { toJSON(): unknown }
	create(value: unknown): Record<string, unknown>
	fromObject(value: unknown): Record<string, unknown>
	fromPartial(value: unknown): Record<string, unknown>
	toObject(value: unknown, options?: Record<string, unknown>): Record<string, unknown>
}

const codec = (root: unknown, path: string): Codec => {
	let value = root as Record<string, unknown>
	for (const key of path.split('.')) value = value[key] as Record<string, unknown>
	return value as unknown as Codec
}

/**
 * The fields the pinned bridge round-trips under a different name. `samples` are the
 * values that discriminate the conversion, so a broken one cannot pass on `{}` alone.
 */
const ALIASED_FIELDS: readonly (readonly [string, string, string, readonly unknown[]])[] = [
	['SyncActionValue.AgentAction', 'deviceID', 'deviceId', [0, 7]],
	['SyncActionValue.ChatAssignmentAction', 'deviceAgentID', 'deviceAgentId', ['', 'abc']],
	[
		'Message.ExtendedTextMessage',
		'faviconMMSMetadata',
		'faviconMmsMetadata',
		[{}, { thumbnailDirectPath: 'direct-path', mediaKeyTimestamp: 7 }]
	],
	['Message.MessageHistoryMetadata', 'oldestMessageTimestamp', 'oldestMessageTimestampInWindow', [0, 7]]
]

for (const [path, publicKey, bridgeKey, samples] of ALIASED_FIELDS) {
	it(`preserves presence and conversions for ${path}.${publicKey}`, () => {
		const ours = codec(local, path)
		const theirs = codec(upstream, path)
		for (const input of [
			{},
			{ [publicKey]: null },
			{ [publicKey]: undefined },
			...samples.map(value => ({ [publicKey]: value }))
		]) {
			const snapshot = structuredClone(input)
			const bytes = theirs.encode(input).finish()
			assert.deepEqual(Buffer.from(ours.encode(input).finish()), Buffer.from(bytes))
			const decoded = ours.decode(bytes)
			assert.deepEqual(decoded.toJSON(), theirs.decode(bytes).toJSON())
			assert.equal(Object.hasOwn(decoded, publicKey), Object.hasOwn(theirs.decode(bytes), publicKey))
			assert.equal(Object.hasOwn(decoded, bridgeKey), false)
			assert.deepEqual(ours.toObject(ours.fromObject(input)), theirs.toObject(theirs.fromObject(input)))
			assert.deepEqual(ours.toObject(ours.fromPartial(input)), theirs.toObject(theirs.fromObject(input)))
			assert.deepEqual(input, snapshot)
		}
	})

	it(`accepts the bridge spelling in fromObject and reports the public one for ${path}.${publicKey}`, () => {
		const ours = codec(local, path)
		const theirs = codec(upstream, path)
		for (const value of samples) {
			// Upstream is the oracle: it produces this shape from the public spelling,
			// which is what a consumer must see.
			const expected = theirs.toObject(theirs.fromObject({ [publicKey]: value }))
			assert.deepEqual(ours.toObject(ours.fromObject({ [bridgeKey]: value })), expected)
			// `create` stores what it is given, so this pins the reported name rather
			// than the conversion.
			assert.equal(Object.hasOwn(ours.toObject(ours.create({ [bridgeKey]: value })), publicKey), true)
		}
		// An own public field still wins, as it does for upstream's own inputs.
		assert.deepEqual(
			ours.toObject(ours.fromObject({ [publicKey]: samples[1], [bridgeKey]: samples[0] })),
			theirs.toObject(theirs.fromObject({ [publicKey]: samples[1] }))
		)
	})

	it(`uses the public spelling when both names occur in ${path}.${publicKey}`, () => {
		const ours = codec(local, path)
		const theirs = codec(upstream, path)
		for (const value of [...samples, null, undefined]) {
			const input = Object.freeze({ [publicKey]: value, [bridgeKey]: samples[1] })
			const expected = theirs.encode({ [publicKey]: value }).finish()
			assert.deepEqual(Buffer.from(ours.encode(input).finish()), Buffer.from(expected))
		}
		const canonical = { [bridgeKey]: samples[1] }
		assert.deepEqual(
			Buffer.from(ours.encode(canonical).finish()),
			Buffer.from(theirs.encode({ [publicKey]: samples[1] }).finish())
		)
	})
}

it('translates nested aliases without mutating the caller', () => {
	const input = { value: { agentAction: { deviceID: 0 }, chatAssignment: { deviceAgentID: '' } } }
	const before = structuredClone(input)
	const ours = codec(local, 'SyncActionData')
	const theirs = codec(upstream, 'SyncActionData')
	const bytes = theirs.encode(input).finish()
	assert.deepEqual(Buffer.from(ours.encode(input).finish()), Buffer.from(bytes))
	assert.deepEqual(ours.decode(bytes).toJSON(), theirs.decode(bytes).toJSON())
	assert.deepEqual(ours.toObject(ours.fromPartial(input)), theirs.toObject(theirs.fromObject(input)))
	assert.deepEqual(input, before)
})

it('translates a renamed field two levels down without mutating the caller', () => {
	// Two holders deep, so the projection has to recurse to reach the renamed name.
	const input = {
		extendedTextMessage: { faviconMMSMetadata: { thumbnailDirectPath: 'direct-path' } },
		messageHistoryNotice: { messageHistoryMetadata: { oldestMessageTimestamp: 7, messageCount: 2 } }
	}
	const before = structuredClone(input)
	const ours = codec(local, 'Message')
	const theirs = codec(upstream, 'Message')
	const bytes = theirs.encode(input).finish()
	assert.deepEqual(Buffer.from(ours.encode(input).finish()), Buffer.from(bytes))
	assert.deepEqual(ours.decode(bytes).toJSON(), theirs.decode(bytes).toJSON())
	assert.deepEqual(
		ours.toObject(ours.fromPartial(input), { longs: String }),
		theirs.toObject(theirs.fromObject(input), { longs: String })
	)
	assert.deepEqual(input, before)
})

it('preserves AgentAction deviceID through the compatibility facade', () => {
	const input = { deviceID: 7 }
	const expected = upstream.SyncActionValue.AgentAction.encode(input).finish()
	// Source types retain bridge spellings; the built declarations expose Baileys names.
	const ours = codec(local, 'SyncActionValue.AgentAction')
	const actual = ours.encode(input).finish()
	assert.deepEqual(Buffer.from(actual), Buffer.from(expected))
	const decoded = ours.decode(expected)
	assert.equal(decoded.deviceID, 7)
	assert.deepEqual(ours.toObject(decoded), input)
	assert.equal(Object.hasOwn(decoded, 'deviceId'), false)
	assert.deepEqual(input, { deviceID: 7 })
})

it('decodes a fixed AgentAction wire fixture with the upstream public key', () => {
	const bytes = Uint8Array.from([0x10, 0x07])
	const expected = upstream.SyncActionValue.AgentAction.decode(bytes).toJSON()
	const actual = local.SyncActionValue.AgentAction.decode(bytes).toJSON()
	assert.deepEqual(expected, { deviceID: 7 })
	assert.deepEqual(actual, expected)
})

it('decodes fixed fixtures for the renamed fields with the upstream public key', () => {
	// Literal bytes, so neither encoder can hide a rename in a shared round trip.
	for (const [path, bytes] of [
		['Message.MessageHistoryMetadata', Uint8Array.from([0x10, 0x07])],
		['Message.ExtendedTextMessage', Uint8Array.from([0x8a, 0x02, 0x00])]
	] as const) {
		const ours = codec(local, path)
		const theirs = codec(upstream, path)
		assert.deepEqual(ours.decode(bytes).toJSON(), theirs.decode(bytes).toJSON())
	}
})

it('keeps fromPartial free of the encode-only codec requirement', () => {
	// BotAvatarMetadata has no bridge codec, and the pinned declarations omit both
	// that type and `avatarMetadata`, so this goes through the codec helper. Refusing
	// the value belongs to encode, which writes; the previous facade accepted this
	// input through fromPartial and returned the hydrated form of the bridge's own
	// partial, which was `{}`.
	const bot = codec(local, 'BotMetadata')
	const partial = bot.fromPartial({ avatarMetadata: {} })
	// The bridge accepts the holder and drops the type it cannot encode, which is
	// what the facade hydrates.
	assert.equal(partial.avatarMetadata, null)
	assert.deepEqual(bot.toObject(partial), {})
	assert.throws(() => bot.encode({ avatarMetadata: {} }), /protobuf codec unavailable for BotAvatarMetadata/)
})

it('translates aliases in fromPartial for either insertion order and both spellings', () => {
	const ours = codec(local, 'SyncActionValue.AgentAction')
	const theirs = codec(upstream, 'SyncActionValue.AgentAction')
	for (const [input, expected] of [
		[{ deviceID: 7, deviceId: 9 }, 7],
		[{ deviceId: 9, deviceID: 7 }, 7],
		[{ deviceId: 7 }, 7],
		// An inherited public spelling is not an own field, so the bridge name wins.
		[Object.assign(Object.create({ deviceID: 9 }), { deviceId: 4 }), 4]
	] as const) {
		const snapshot = structuredClone({ ...input })
		assert.deepEqual(ours.toObject(ours.fromPartial(input)), theirs.toObject(theirs.fromObject({ deviceID: expected })))
		assert.deepEqual({ ...input }, snapshot)
	}
})
