import { describe, it } from 'node:test'
import { createProtoCompatibilityFacade } from '../Compatibility/proto-runtime.ts'
import { proto } from '../WAProto/runtime.ts'
import { expect } from './expect.ts'

type Dynamic = Record<string, unknown>

// An empty source namespace: nothing here needs a working codec, and it keeps the
// facade independent of the shared bridge namespace that `../WAProto/runtime.ts`
// installs its descriptors onto.
const freshNamespace = (): Dynamic => createProtoCompatibilityFacade({}).proto as Dynamic

const descriptorOf = (target: object, key: string): PropertyDescriptor => {
	const descriptor = Object.getOwnPropertyDescriptor(target, key)
	if (!descriptor) throw new Error(`missing descriptor: ${key}`)
	return descriptor
}

describe('lazy proto namespace', () => {
	it('installs entries as accessors and settles them on first read', () => {
		const namespace = freshNamespace()
		expect(typeof descriptorOf(namespace, 'Message').get).toBe('function')
		expect(namespace.Message).toBeDefined()
		const settled = descriptorOf(namespace, 'Message')
		expect(settled.get).toBeUndefined()
		expect(settled.writable).toBe(true)
		expect(settled.enumerable).toBe(true)
		expect(settled.configurable).toBe(true)
	})

	it('returns the same value on every read', () => {
		const namespace = freshNamespace()
		expect(namespace.Message).toBe(namespace.Message)
		expect((namespace.Message as Dynamic).ExtendedTextMessage).toBe((namespace.Message as Dynamic).ExtendedTextMessage)
	})

	it('defers nested types until their container is read', () => {
		const namespace = freshNamespace()
		const message = namespace.Message as Dynamic
		expect(typeof descriptorOf(message, 'ExtendedTextMessage').get).toBe('function')
		const extended = message.ExtendedTextMessage as Dynamic
		expect(descriptorOf(message, 'ExtendedTextMessage').get).toBeUndefined()
		expect(typeof descriptorOf(extended, 'FontType').get).toBe('function')
		expect(extended.FontType).toBeDefined()
		expect(descriptorOf(extended, 'FontType').get).toBeUndefined()
	})

	it('settles on the object being read when descriptors are shared', () => {
		// `../WAProto/runtime.ts` copies these descriptors onto the bridge
		// namespace, so one getter is reachable from two objects; settling on the
		// definition site would leave the other rebuilding on every access.
		const namespace = freshNamespace()
		const copy: Dynamic = {}
		Object.defineProperties(copy, Object.getOwnPropertyDescriptors(namespace))
		expect(copy.Message).toBe(namespace.Message)
		expect(descriptorOf(copy, 'Message').get).toBeUndefined()
		expect(descriptorOf(namespace, 'Message').get).toBeUndefined()
	})

	it('keeps enumerability and membership without reading', () => {
		const namespace = freshNamespace()
		expect('Message' in namespace).toBe(true)
		expect(Object.keys(namespace)).toContain('Message')
		expect(Object.keys(namespace)).toContain('ADVEncryptionType')
		expect(typeof descriptorOf(namespace, 'Message').get).toBe('function')
	})

	it('accepts assignment over an unread entry', () => {
		const namespace = freshNamespace()
		const replacement = { marker: true }
		namespace.Message = replacement
		expect(namespace.Message).toBe(replacement)
		expect(descriptorOf(namespace, 'Message').get).toBeUndefined()
	})

	it('supports deletion of an unread entry', () => {
		const namespace = freshNamespace()
		delete namespace.Message
		expect('Message' in namespace).toBe(false)
	})

	it('reports enums as plain value maps', () => {
		const namespace = freshNamespace()
		const advEncryption = namespace.ADVEncryptionType as Record<string, number>
		expect(advEncryption.E2EE).toBe(0)
		expect(namespace.ADVEncryptionType).toBe(advEncryption)
	})

	it('keeps the exported namespace lazy after the bridge merge', () => {
		// Guards the descriptor copy in `../WAProto/runtime.ts`: an `Object.assign`
		// there would read every entry and settle the whole namespace on import.
		expect(typeof descriptorOf(proto as unknown as object, 'BotMetricsEntryPoint').get).toBe('function')
	})

	it('keeps the exported namespace fully functional', () => {
		const message = proto.Message.create({
			conversation: 'hello',
			extendedTextMessage: { text: 'world' }
		})
		const decoded = proto.Message.decode(proto.Message.encode(message).finish())
		expect(decoded.conversation).toBe('hello')
		expect(decoded.extendedTextMessage?.text).toBe('world')
		expect(decoded).toBeInstanceOf(proto.Message)
		expect(proto.Message.ExtendedTextMessage.FontType.SYSTEM).toBe(0)
	})
})
