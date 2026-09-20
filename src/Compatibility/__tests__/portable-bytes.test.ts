import { describe, it } from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import { base64Decode, base64Encode, sha256Sync } from '../../Runtime/bytes.ts'
import { generateMessageIDPortable, generateMessageIDV2Portable } from '../message-ids.ts'
import { generateMessageID, generateMessageIDV2 } from '../../Utils/generics.ts'
import { expect } from '../../__tests__/expect.ts'

describe('portable byte primitives', () => {
	it('sha256Sync matches node:crypto byte-for-byte, including padding boundaries', () => {
		const cases = [
			'',
			'a',
			'abc',
			'hello world',
			'x'.repeat(55),
			'y'.repeat(56),
			'z'.repeat(57),
			'w'.repeat(64),
			'v'.repeat(1000)
		]
		for (const text of cases) {
			const got = Buffer.from(sha256Sync(new TextEncoder().encode(text))).toString('hex')
			expect(got).toBe(createHash('sha256').update(text).digest('hex'))
		}
	})

	it('base64 helpers match Buffer, padded and unpadded', () => {
		for (let i = 0; i < 100; i++) {
			const buf = randomBytes(Math.floor(Math.random() * 100))
			const bytes = new Uint8Array(buf)
			const enc = base64Encode(bytes)
			expect(enc).toBe(buf.toString('base64'))
			expect(Array.from(base64Decode(enc))).toEqual(Array.from(bytes))
			// Auth mirrors store unpadded digests; Buffer tolerates them.
			expect(Array.from(base64Decode(enc.replace(/=+$/, '')))).toEqual(Array.from(bytes))
		}
	})

	it('portable message ids keep the Node shapes', () => {
		for (let i = 0; i < 50; i++) {
			expect(/^3EB0[0-9A-F]{18}$/.test(generateMessageIDV2Portable('5511@s.whatsapp.net'))).toBe(true)
			expect(/^3EB0[0-9A-F]{18}$/.test(generateMessageIDV2('5511@s.whatsapp.net'))).toBe(true)
			expect(/^3EB0[0-9A-F]{36}$/.test(generateMessageIDPortable())).toBe(true)
			expect(/^3EB0[0-9A-F]{36}$/.test(generateMessageID())).toBe(true)
		}
	})
})
