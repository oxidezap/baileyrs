import { test } from 'vitest'
import { createTestClient, destroyClients, roundtrip, settle, type TestClient } from './fixture.ts'
import { integrationOptions } from '../options.ts'

test('bartender/group with three members', async ({ bench }) => {
	const clients: TestClient[] = []
	try {
		for (const label of ['group-sender', 'group-receiver', 'group-observer']) {
			clients.push(await createTestClient({ label }))
		}
		const [sender, receiver, observer] = clients
		const group = await sender!.sock.groupCreate('CodSpeed synthetic group', [receiver!.jid, observer!.jid])
		if (!group.id.endsWith('@g.us')) throw new Error('group creation failed')
		// Match the group E2E fixture: warm group traffic directly, independently
		// of the DM fixture and its Signal ratchets.
		// Each roundtrip waits for both members' delivery and receipts, so the
		// observer's decryption and receipt are always inside the measured call.
		for (let i = 0; i < 8; i++) await roundtrip(sender!, [receiver!, observer!], 64, group.id)
		await bench('warmed sender-key send through delivery', { beforeEach: () => settle() }, async () => {
			await roundtrip(sender!, [receiver!, observer!], 64, group.id)
		}).run(integrationOptions)
	} finally {
		await destroyClients(clients)
	}
})
