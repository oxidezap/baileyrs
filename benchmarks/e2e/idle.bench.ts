import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'vitest'
import { destroyClients, idle, requireMock, roundtrip, settle, warmedPair, type TestClient } from './fixture.ts'
import { integrationOptions } from '../options.ts'

requireMock()
test('bartender/idle after activity', async ({ bench }) => {
	let pair: [TestClient, TestClient] | undefined
	let before: NodeJS.MemoryUsage | undefined
	let after: NodeJS.MemoryUsage | undefined
	let windows = 0
	const setup = async () => {
		assert.ok(global.gc, 'Run idle benchmarks with --expose-gc')
		pair = await warmedPair()
		for (let i = 0; i < 32; i++) await roundtrip(pair[0], pair[1], 4096)
		await idle(pair[0])
	}
	const finish = async () => {
		try {
			if (pair) {
				// Liveness check is outside the measured idle window.
				await roundtrip(pair[0], pair[1])
				await mkdir('benchmark-results', { recursive: true })
				await writeFile(
					'benchmark-results/idle.json',
					JSON.stringify(
						{
							schemaVersion: 1,
							node: process.version,
							sessions: 2,
							idleWindowMs: 1000,
							windowsExecuted: windows,
							snapshotScope: 'last completed window; previous warmups excluded from the snapshot interval',
							workload: { messages: 32, payloadBytes: 4096 },
							before,
							after,
							note: 'Process-wide snapshots after GC, including shared WASM memory. Not per-session allocations.'
						},
						null,
						2
					)
				)
			}
		} finally {
			if (pair) await destroyClients(pair)
		}
	}
	try {
		await setup()
		await bench(
			'connected 1s after 32 messages',
			{
				beforeEach: async () => {
					// Start each window from a quiet session, not mid-way through a
					// receipt or server notification left over from the last one.
					await settle()
					global.gc!()
					before = process.memoryUsage()
				},
				afterEach: () => {
					global.gc!()
					after = process.memoryUsage()
					windows++
				}
			},
			async () => {
				await idle(pair![0])
			}
		).run(integrationOptions)
	} finally {
		await finish()
	}
})
