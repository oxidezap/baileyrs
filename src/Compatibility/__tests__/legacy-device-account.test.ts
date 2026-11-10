import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWhatsAppClient, initWasmEngine } from '@oxidezap/whatsapp-rust-bridge'
import { createDeviceProjection } from '../legacy-store/device.ts'
import { makeWrapped } from '../../Utils/__tests__/_legacy-store-fixtures.ts'

// Fixed protobuf fields 1..4, independent of the current bridge encoder.
const accountBytes = new Uint8Array([
	10,
	1,
	1,
	18,
	32,
	...Array(32).fill(7),
	26,
	64,
	...Array(64).fill(8),
	34,
	64,
	...Array(64).fill(9)
])
const account = () => ({
	details: new Uint8Array([1]),
	accountSignatureKey: new Uint8Array(32).fill(7),
	accountSignature: new Uint8Array(64).fill(8),
	deviceSignature: new Uint8Array(64).fill(9)
})
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

initWasmEngine()

test('installed bridge restores the paired account from the authoritative legacy device projection', async () => {
	const { wrapped, creds } = await makeWrapped()
	creds.me = { id: '123:1@s.whatsapp.net', name: 'synthetic' }
	creds.account = account()
	const record = JSON.parse(new TextDecoder().decode((await wrapped.get('device', 'device'))!))
	assert.deepEqual(record.account, [...accountBytes])
	const client = await createWhatsAppClient(
		{ connect() {}, send() {}, disconnect() {} },
		{
			async execute() {
				throw new Error('unexpected HTTP')
			}
		},
		null,
		wrapped
	)
	try {
		const restored = await client.getAccount()
		assert.ok(restored)
		assert.deepEqual(Array.from(restored.accountSignatureKey), Array(32).fill(7))
	} finally {
		await client.disconnect()
		client.free()
	}
})

test('inline account hydration preserves omission, applies bytes and clears explicit null', async () => {
	const { creds } = await makeWrapped()
	const projection = createDeviceProjection(creds)
	projection.prepare('device', bytes({ account: [...accountBytes] }))()
	assert.deepEqual(Array.from(creds.account!.accountSignatureKey!), Array(32).fill(7))
	projection.prepare('device', bytes({ push_name: 'updated' }))()
	assert.ok(creds.account)
	const previous = creds.account
	assert.throws(() => projection.prepare('device', bytes({ account: [10, 255] })))
	assert.equal(creds.account, previous)
	projection.prepare('device', bytes({ account: null }))()
	assert.equal(creds.account, undefined)
})
