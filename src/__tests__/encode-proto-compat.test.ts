/**
 * The boundary that keeps this library tolerant of two inputs the bridge codec
 * refuses from 0.8.0 on.
 *
 * Both were written before — an empty string in a 64-bit field as `0`, an
 * unpaired surrogate as U+FFFD — and upstream Baileys still encodes both, so
 * passing the refusal through would break the send path for callers. The bytes
 * asserted below are written out by hand rather than derived from the codec:
 * deriving them would make the test agree with whatever the codec does.
 */

import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'
import { encodeProtoCompat } from '../Compatibility/encode-proto.ts'
import { repairProtoMessage } from '../Compatibility/proto-runtime.ts'
import { proto } from '../WAProto/runtime.ts'
import { expect } from './expect.ts'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('encodeProtoCompat — inputs the bridge codec stopped accepting', () => {
	it('writes 0 for an empty string in a 64-bit field', () => {
		// Message.stickerMessage = field 26 (d201), one nested byte for fileLength
		// = field 9 (48) holding 0.
		expect(hex(encodeProtoCompat('Message', { stickerMessage: { fileLength: '' } }))).toBe('d201024800')
	})

	it('substitutes U+FFFD for an unpaired surrogate in a text field', () => {
		// conversation = field 1 (0a), length 3, then the UTF-8 for U+FFFD.
		expect(hex(encodeProtoCompat('Message', { conversation: '\udfff' }))).toBe('0a03efbfbd')
	})

	it('leaves a message the codec accepts exactly as it was', () => {
		expect(hex(encodeProtoCompat('Message', { conversation: 'hi' }))).toBe('0a026869')
	})

	/**
	 * The repair is not a licence to write any number at all. A string that is
	 * merely not a number was never accepted, and coercing it would put a value on
	 * the wire that nobody sent — the failure mode the bridge's stricter contract
	 * exists to prevent.
	 */
	it('still refuses a value that was never accepted', () => {
		expect(() => encodeProtoCompat('Message', { stickerMessage: { fileLength: 'abc' } })).toThrow()
		expect(() => encodeProtoCompat('Message', { stickerMessage: { fileLength: 1.5 } })).toThrow()
	})

	it('propagates a failure it does not explain, rather than retrying into a second throw', () => {
		// An unknown type never reaches the repair: there is no schema to walk, so
		// the original error is what the caller sees.
		expect(() => encodeProtoCompat('NoSuchMessageType', { a: 1 })).toThrow()
	})

	it('repairs a field nested several messages deep', () => {
		const bytes = encodeProtoCompat('Message', {
			ephemeralMessage: { message: { stickerMessage: { fileLength: '', mimetype: 'x' } } }
		})
		// The sticker survives with a mimetype, so the message was rebuilt rather
		// than emptied on the way through.
		const decoded = proto.Message.decode(bytes)
		expect(decoded.ephemeralMessage?.message?.stickerMessage?.mimetype).toBe('x')
	})

	it('repairs every element of a repeated field', () => {
		const repaired = repairProtoMessage('Message.ListMessage', {
			sections: [{ title: '\udfff' }, { title: 'ok' }, { title: '\ud800' }]
		}) as { sections: { title: string }[] }
		expect(repaired.sections.map(section => section.title)).toEqual(['�', 'ok', '�'])
	})
})

describe('repairProtoMessage — copy-on-write contract', () => {
	it('returns the same reference when there is nothing to repair', () => {
		const message = { conversation: 'hi' }
		expect(repairProtoMessage('Message', message)).toBe(message)
	})

	it('returns the same reference for a type it has no schema for', () => {
		const message = { anything: 1 }
		expect(repairProtoMessage('NoSuchMessageType', message)).toBe(message)
	})

	it('does not mutate the caller’s message', () => {
		const message = { conversation: '\udfff' }
		const repaired = repairProtoMessage('Message', message) as { conversation: string }
		expect(message.conversation).toBe('\udfff')
		expect(repaired.conversation).toBe('�')
	})

	it('shares the branches it did not touch', () => {
		const untouched = { url: 'https://example.test' }
		const message = { conversation: '\udfff', imageMessage: untouched }
		const repaired = repairProtoMessage('Message', message) as { imageMessage: unknown }
		// Copy-on-write: only the branch that changed is rebuilt.
		expect(repaired.imageMessage).toBe(untouched)
	})
})

describe('proto.X.encode — the same repair through the facade', () => {
	/**
	 * The facade hangs the retry off `finish` rather than `encode`, because the
	 * bridge's writer is lazy: `encode` queues the fields and `finish` is what
	 * writes them, so a refused value surfaces there. A test that only called
	 * `encode()` would pass against a facade that never repairs anything.
	 */
	it('repairs through the lazy writer, at finish rather than encode', () => {
		const writer = proto.Message.encode({ stickerMessage: { fileLength: '' as never } })
		expect(hex(writer.finish())).toBe('d201024800')
	})

	it('substitutes an unpaired surrogate through the facade too', () => {
		expect(hex(proto.Message.encode({ conversation: '\udfff' }).finish())).toBe('0a03efbfbd')
	})

	it('leaves an acceptable message untouched through the facade', () => {
		expect(hex(proto.Message.encode({ conversation: 'hi' }).finish())).toBe('0a026869')
	})
})
