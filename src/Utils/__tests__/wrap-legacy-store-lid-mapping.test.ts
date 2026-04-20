/**
 * Cross-impl gap for `lid_mapping`:
 *   • Bridge: `lid:{X}` → JSON `LidPnMappingEntry`; `pn:{X}` → bytes(LID).
 *   • Upstream: bare `{pnUser}` → string LID; `{lidUser}_reverse` → string PN.
 * Without conversion, upstream falls back to USYNC re-fetch on every cold start.
 */

import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import { expect } from '../../__tests__/expect.ts'
import { makeWrapped } from './_legacy-store-fixtures.ts'

const PN_USER = '559980000003'
const LID_USER = '100000037037034'
const ENC = (s: string) => new TextEncoder().encode(s)

describe('wrap-legacy-store: lid_mapping key-name translation', () => {
	test('bridge SET pn:{X} → upstream bare key {X}', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('lid_mapping', `pn:${PN_USER}`, ENC(LID_USER))
		expect(keys.raw['lid-mapping']?.[PN_USER]).toBeDefined()
		expect(keys.raw['lid-mapping']?.[`pn:${PN_USER}`]).toBeUndefined()
	})

	test('bridge SET lid:{X} → upstream key {X}_reverse', async () => {
		const { wrapped, keys } = await makeWrapped()
		const entry = {
			lid: LID_USER,
			phone_number: PN_USER,
			created_at: 1700000000,
			updated_at: 1700000000,
			learning_source: 'usync'
		}
		await wrapped.set('lid_mapping', `lid:${LID_USER}`, ENC(JSON.stringify(entry)))
		expect(keys.raw['lid-mapping']?.[`${LID_USER}_reverse`]).toBeDefined()
		expect(keys.raw['lid-mapping']?.[`lid:${LID_USER}`]).toBeUndefined()
	})
})

describe('wrap-legacy-store: lid_mapping value-byte translation', () => {
	test('bridge `pn:` write surfaces a STRING for upstream (not Buffer)', async () => {
		const { wrapped, keys } = await makeWrapped()
		await wrapped.set('lid_mapping', `pn:${PN_USER}`, ENC(LID_USER))
		// Upstream's `_getLIDsForPNsImpl` does `stored[pnUser]` → expects string.
		expect(typeof keys.raw['lid-mapping']?.[PN_USER]).toBe('string')
		expect(keys.raw['lid-mapping']?.[PN_USER]).toBe(LID_USER)
	})

	test('bridge `lid:` write surfaces phone_number STRING under {lid}_reverse', async () => {
		const { wrapped, keys } = await makeWrapped()
		const entry = {
			lid: LID_USER,
			phone_number: PN_USER,
			created_at: 1,
			updated_at: 1,
			learning_source: 'usync'
		}
		await wrapped.set('lid_mapping', `lid:${LID_USER}`, ENC(JSON.stringify(entry)))
		expect(keys.raw['lid-mapping']?.[`${LID_USER}_reverse`]).toBe(PN_USER)
	})

	test('bridge GET pn:{X} reads upstream string back as raw LID bytes', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.raw['lid-mapping'] = { [PN_USER]: LID_USER }
		const out = (await wrapped.get('lid_mapping', `pn:${PN_USER}`)) as Uint8Array
		expect(Buffer.from(out).toString('utf-8')).toBe(LID_USER)
	})

	test('bridge GET lid:{X} reconstructs synthetic LidPnMappingEntry from upstream', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.raw['lid-mapping'] = { [`${LID_USER}_reverse`]: PN_USER }
		const out = (await wrapped.get('lid_mapping', `lid:${LID_USER}`)) as Uint8Array
		const parsed = JSON.parse(Buffer.from(out).toString('utf-8')) as {
			lid: string
			phone_number: string
			learning_source: string
			created_at: number
			updated_at: number
		}
		expect(parsed.lid).toBe(LID_USER)
		expect(parsed.phone_number).toBe(PN_USER)
		expect(parsed.learning_source).toBe('wrap-legacy-store')
		expect(parsed.created_at).toBeGreaterThan(0)
	})

	test('round-trip: bridge SET both directions → read both back', async () => {
		const { wrapped, keys } = await makeWrapped()
		const entry = {
			lid: LID_USER,
			phone_number: PN_USER,
			created_at: 1,
			updated_at: 1,
			learning_source: 'peer_pn_message'
		}
		await wrapped.set('lid_mapping', `lid:${LID_USER}`, ENC(JSON.stringify(entry)))
		await wrapped.set('lid_mapping', `pn:${PN_USER}`, ENC(LID_USER))
		expect(keys.raw['lid-mapping']?.[PN_USER]).toBe(LID_USER)
		expect(keys.raw['lid-mapping']?.[`${LID_USER}_reverse`]).toBe(PN_USER)

		const lidBack = Buffer.from((await wrapped.get('lid_mapping', `pn:${PN_USER}`)) as Uint8Array).toString('utf-8')
		expect(lidBack).toBe(LID_USER)
		const entryBack = JSON.parse(
			Buffer.from((await wrapped.get('lid_mapping', `lid:${LID_USER}`)) as Uint8Array).toString('utf-8')
		) as { lid: string; phone_number: string }
		expect(entryBack.lid).toBe(LID_USER)
		expect(entryBack.phone_number).toBe(PN_USER)
	})
})
