import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { proto } from '../WAProto/runtime.ts'
import { expect } from './expect.ts'

type Dynamic = Record<string, unknown>

const encoded = (fixture: Dynamic): Uint8Array => proto.Message.encode(proto.Message.fromObject(fixture)).finish()

const shapeProbe = (source: string): Dynamic => {
	const result = spawnSync(process.execPath, ['--allow-natives-syntax', '--input-type=module', '-e', source], {
		cwd: new URL('../..', import.meta.url),
		encoding: 'utf8'
	})
	if (result.status !== 0) throw new Error(result.stderr)
	return JSON.parse(result.stdout) as Dynamic
}

describe('decoded protobuf message shape', () => {
	it('keeps the public object contract of a decoded message', () => {
		const fixture = { conversation: 'hello' }
		const decoded = proto.Message.decode(encoded(fixture))

		expect(decoded).toBeInstanceOf(proto.Message)
		expect(Object.keys(decoded)).toEqual(['conversation'])
		expect(decoded.toJSON()).toEqual(proto.Message.fromObject(fixture).toJSON())
		expect(Object.getOwnPropertyNames(decoded)).toEqual(['conversation'])
		expect(decoded.toJSON).toBe(Object.getPrototypeOf(decoded).toJSON)

		// Absent fields still resolve through the prototype defaults.
		expect(decoded.reactionMessage).toBe(null)
		expect(decoded.protocolMessage).toBe(null)
		expect(proto.Message.toObject(decoded, { defaults: true })).toEqual(
			proto.Message.toObject(proto.Message.fromObject(fixture), { defaults: true })
		)
	})

	it('keeps the same tree for nested, repeated and map fields', () => {
		const nested = {
			buttonsMessage: {
				text: 'heading',
				imageMessage: { caption: 'image', mediaKey: 'AQID' },
				buttons: [
					{ buttonId: 'one', buttonText: { displayText: 'first' }, type: 1 },
					{ buttonId: 'two', buttonText: { displayText: 'second' }, type: 1 }
				]
			}
		}
		const decoded = proto.Message.decode(encoded(nested))
		const expected = proto.Message.fromObject(nested)
		const buttons = decoded.buttonsMessage!

		expect(decoded.toJSON()).toEqual(expected.toJSON())
		expect(buttons).toBeInstanceOf(proto.Message.ButtonsMessage)
		expect(buttons.imageMessage).toBeInstanceOf(proto.Message.ImageMessage)
		expect(buttons.buttons!.length).toBe(2)
		expect(buttons.buttons![0]).toBeInstanceOf(proto.Message.ButtonsMessage.Button)
		expect(buttons.buttons![0]!.buttonText).toBeInstanceOf(proto.Message.ButtonsMessage.Button.ButtonText)
		// Repeated and map fields absent from the wire still read as the
		// prototype defaults rather than as own properties.
		expect(Object.keys(buttons.buttons![0]!.buttonText!)).toEqual(['displayText'])
		expect(buttons.contextInfo).toBe(null)

		const mapFixture = { field: { '1': { minVersion: 1, subfield: { '9': { isMessage: true } } } }, version: 3 }
		const config = proto.Config.decode(proto.Config.encode(proto.Config.fromObject(mapFixture)).finish())
		expect(config.toJSON()).toEqual(proto.Config.fromObject(mapFixture).toJSON())
		expect(config.field!['1']).toBeInstanceOf(proto.Field)
		expect(config.field!['1']!.subfield!['9']).toBeInstanceOf(proto.Field)
	})

	/**
	 * Regression guard for the decoded object's hidden class. Before the fresh
	 * instance, `hydrate` deleted the codec's own `toJSON` and re-parented what
	 * was left, which normalized every message into dictionary mode.
	 */
	it('decodes into fast-property instances that share a hidden class per field set', () => {
		const probe = shapeProbe(`
			import { proto } from './src/WAProto/runtime.ts'
			const bytes = fixture => proto.Message.encode(proto.Message.fromObject(fixture)).finish()
			const first = proto.Message.decode(bytes({ conversation: 'first' }))
			const second = proto.Message.decode(bytes({ conversation: 'second and longer' }))
			const reaction = proto.Message.decode(bytes({ reactionMessage: { text: 'x' } }))
			const nested = proto.Message.decode(bytes({ extendedTextMessage: { text: 'a', contextInfo: { stanzaId: 'b' } } }))
			console.log(JSON.stringify({
				fastProperties: %HasFastProperties(first) && %HasFastProperties(reaction) && %HasFastProperties(nested),
				fastNested: %HasFastProperties(nested.extendedTextMessage.contextInfo),
				sameFieldSet: %HaveSameMap(first, second),
				differentFieldSet: %HaveSameMap(first, reaction)
			}))
		`)

		expect(probe.fastProperties).toBe(true)
		expect(probe.fastNested).toBe(true)
		expect(probe.sameFieldSet).toBe(true)
		// Two different field sets are two different fast maps. Collapsing them
		// would mean materializing every schema field as an own property, which
		// would change `Object.keys()`; the property that matters is that neither
		// map is a dictionary.
		expect(probe.differentFieldSet).toBe(false)
	})
})
