import { bench, describe } from 'vitest'
import { BufferJSON, initAuthCreds } from '../src/Utils/index.ts'

const creds = initAuthCreds()
// A keystore-like payload: many small binary records, as persisted by legacy auth-state code.
const keys = Object.fromEntries(
	Array.from({ length: 200 }, (_, i) => [
		`pre-key-${i}`,
		{ private: Buffer.alloc(32, i), public: Buffer.alloc(32, 255 - i) }
	])
)
const serializedCreds = JSON.stringify(creds, BufferJSON.replacer)
const serializedKeys = JSON.stringify(keys, BufferJSON.replacer)

describe('BufferJSON', () => {
	bench('stringify auth creds', () => {
		JSON.stringify(creds, BufferJSON.replacer)
	})

	bench('parse auth creds', () => {
		JSON.parse(serializedCreds, BufferJSON.reviver)
	})

	bench('stringify 200 pre-keys', () => {
		JSON.stringify(keys, BufferJSON.replacer)
	})

	bench('parse 200 pre-keys', () => {
		JSON.parse(serializedKeys, BufferJSON.reviver)
	})
})
