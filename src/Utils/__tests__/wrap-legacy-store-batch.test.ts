/**
 * `wrap-legacy-store` batch path: the upstream Baileys keyStore is already
 * batch-shaped (`set({ [type]: { [id]: value | null } })`), so `setMany` /
 * `deleteMany` must collapse a same-store batch into ONE `keys.set` call.
 * The adapter is id-addressed (no list-a-category), so it declares only
 * `batch` capability — never `enumerate` / `prefixDelete`.
 */

import { describe, test } from 'node:test'
import { expect } from '../../__tests__/expect.ts'
import { makeWrapped } from './_legacy-store-fixtures.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('wrap-legacy-store: setMany / deleteMany batching', () => {
	test('declares batch capability but not enumerate/prefixDelete', async () => {
		const { wrapped } = await makeWrapped()
		expect(wrapped.capabilities).toEqual({ batch: true })
		// An id-addressed keyStore cannot enumerate, so these must be absent.
		expect(wrapped.listKeys).toBeUndefined()
		expect(wrapped.deletePrefix).toBeUndefined()
	})

	test('setMany collapses a bridge-only batch into ONE keyStore.set call', async () => {
		const { wrapped, keys } = await makeWrapped()
		let setCalls = 0
		const origSet = keys.set.bind(keys)
		keys.set = async (data: Parameters<typeof keys.set>[0]) => {
			setCalls++
			return origSet(data)
		}

		// `sent_message` → upstream type `bridge-sent-message` (raw passthrough).
		await wrapped.setMany!('sent_message', [
			['chatA:m1', enc('one')],
			['chatA:m2', enc('two')],
			['chatB:m3', enc('three')]
		])

		expect(setCalls).toEqual(1)
		expect(keys.raw['bridge-sent-message']?.['chatA:m1']).toBeDefined()
		expect(keys.raw['bridge-sent-message']?.['chatA:m2']).toBeDefined()
		expect(keys.raw['bridge-sent-message']?.['chatB:m3']).toBeDefined()
	})

	test('deleteMany collapses tombstones into ONE keyStore.set call', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.setMany!('sent_message', [
			['m1', enc('a')],
			['m2', enc('b')]
		])

		let setCalls = 0
		const origSet = keys.set.bind(keys)
		keys.set = async (data: Parameters<typeof keys.set>[0]) => {
			setCalls++
			return origSet(data)
		}

		await wrapped.deleteMany!('sent_message', ['m1', 'm2'])

		expect(setCalls).toEqual(1)
		expect(keys.raw['bridge-sent-message']?.['m1']).toBeUndefined()
		expect(keys.raw['bridge-sent-message']?.['m2']).toBeUndefined()
	})

	test('setMany on a converter store applies per-entry conversion + one set', async () => {
		const { wrapped, keys } = await makeWrapped()
		// `tc_token` → upstream `tctoken`, value goes through the converter.
		await wrapped.setMany!('tc_token', [
			['111@s.whatsapp.net', enc('{"token":[1,2,3],"token_timestamp":100}')],
			['222@s.whatsapp.net', enc('{"token":[4,5,6],"token_timestamp":200}')]
		])
		// Both ids landed under the upstream `tctoken` type.
		expect(keys.raw['tctoken']?.['111@s.whatsapp.net']).toBeDefined()
		expect(keys.raw['tctoken']?.['222@s.whatsapp.net']).toBeDefined()
	})

	// Codex review fix: a persistence failure must reach Rust so it skips the
	// follow-up self-index rewrite. Previously these swallowed the error.
	test('setMany REJECTS when the underlying keyStore.set throws', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.set = async () => {
			throw new Error('db down')
		}
		await expect(wrapped.setMany!('sent_message', [['m1', enc('a')]])).rejects.toThrow(/db down/)
	})

	test('setMany on the converter route REJECTS when keyStore.set throws', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.set = async () => {
			throw new Error('db down')
		}
		await expect(
			wrapped.setMany!('tc_token', [['111@s.whatsapp.net', enc('{"token":[1],"token_timestamp":1}')]])
		).rejects.toThrow(/db down/)
	})

	test('deleteMany REJECTS when the underlying keyStore.set throws', async () => {
		const { wrapped, keys } = await makeWrapped()
		// Seed first with the real set, then swap in a throwing one.
		await wrapped.setMany!('sent_message', [['m1', enc('a')]])
		keys.set = async () => {
			throw new Error('db down')
		}
		await expect(wrapped.deleteMany!('sent_message', ['m1'])).rejects.toThrow(/db down/)
	})
})
