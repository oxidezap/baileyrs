import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'vitest'
import { createTestClient, destroyTestClient, idle } from './fixture.ts'
import { integrationOptions } from '../options.ts'

test('bartender/one connected idle session', async ({ bench }) => {
	assert.ok(global.gc, 'Run idle benchmarks with --expose-gc')
	const snapshot = () => {
		global.gc!()
		return process.memoryUsage()
	}
	const runtimeBaseline = snapshot()
	const client = await createTestClient({ label: 'bench-single-idle' })
	let before: NodeJS.MemoryUsage | undefined
	let after: NodeJS.MemoryUsage | undefined
	let windows = 0
	try {
		await idle(client)
		await bench(
			'connected 1s without traffic',
			{
				beforeEach: () => {
					before = snapshot()
				},
				afterEach: () => {
					after = snapshot()
					windows++
				}
			},
			async () => {
				await idle(client)
			}
		).run(integrationOptions)
		assert.equal(client.sock.ws.isOpen, true)
		await mkdir('benchmark-results', { recursive: true })
		await writeFile(
			'benchmark-results/single-idle.json',
			JSON.stringify(
				{
					schemaVersion: 1,
					node: process.version,
					sessions: 1,
					idleWindowMs: 1000,
					windowsExecuted: windows,
					workload: { messages: 0 },
					runtimeBaseline,
					before,
					after,
					snapshotScope: 'last completed window; previous warmups excluded from the snapshot interval',
					note: 'Process-wide snapshots after GC. Runtime, WASM arena and session overhead are included.'
				},
				null,
				2
			)
		)
	} finally {
		await destroyTestClient(client)
	}
})
