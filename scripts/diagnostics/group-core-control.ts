// Correctness-only control. No benchmark or performance measurement is performed here.
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { test } from 'node:test'
import { createTestClient, destroyClients, roundtrip, settle, type TestClient } from '../../benchmarks/e2e/fixture.ts'

test('controlled group lifecycle with original fixture and workload', { timeout: 1_200_000 }, async () => {
	const clients: TestClient[] = []
	let phase = 'create-clients'
	let round = -1
	try {
		for (const label of ['group-sender', 'group-receiver', 'group-observer'])
			clients.push(await createTestClient({ label }))
		const [sender, receiver, observer] = clients
		phase = 'group-create'
		const group = await sender!.sock.groupCreate('CodSpeed synthetic group', [receiver!.jid, observer!.jid])
		assert.ok(group.id.endsWith('@g.us'), 'group creation failed')
		phase = 'warmup'
		for (round = 0; round < 8; round++) await roundtrip(sender!, [receiver!, observer!], 64, group.id)
		phase = 'settle'
		await settle()
		phase = 'delivery'
		await roundtrip(sender!, [receiver!, observer!], 64, group.id)
		appendFileSync('.diagnostic-core-state.jsonl', JSON.stringify({ phase: 'completed', passed: true }) + '\n')
	} catch (error) {
		const text = String(error)
		appendFileSync(
			'.diagnostic-core-state.jsonl',
			JSON.stringify({
				phase,
				round,
				identityUnavailable: text.includes('device list account identity unavailable'),
				notConnected: text.includes('not connected'),
				timeout: /timed out|timeout/i.test(text)
			}) + '\n'
		)
		throw error
	} finally {
		await destroyClients(clients)
	}
})
