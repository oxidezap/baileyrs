import assert from 'node:assert/strict'
import { it } from 'node:test'
import { startCallAudioPump } from '../Socket/calls.ts'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

for (const stalledAt of ['read', 'push'] as const) {
	it(`does not replay overdue encoded audio slots after a stalled ${stalledAt}`, async t => {
		t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
		let pulls = 0
		const sent: number[] = []
		const pump = startCallAudioPump(
			() => {
				sent.push(Date.now())
				if (stalledAt === 'push' && sent.length === 1) t.mock.timers.setTime(500)
				return true
			},
			{
				async next() {
					if (stalledAt === 'read' && pulls++ === 0) await new Promise(resolve => setTimeout(resolve, 500))
					return new Uint8Array([1])
				}
			},
			{ timing: { mode: 'clock', packetDurationMs: 60 } }
		)
		try {
			await flush()
			if (stalledAt === 'read') {
				t.mock.timers.tick(500)
				await flush()
			}
			assert.deepEqual(sent, [stalledAt === 'read' ? 500 : 0])
			t.mock.timers.tick(59)
			await flush()
			assert.equal(sent.length, 1)
			t.mock.timers.tick(1)
			await flush()
			assert.equal(sent[1], 560)
			t.mock.timers.tick(60)
			await flush()
			assert.equal(sent[2], 620)
		} finally {
			pump.stop()
			await pump.done
		}
	})
}

it('includes ordinary source read latency in the encoded packet period', async t => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
	const sent: number[] = []
	const pump = startCallAudioPump(
		() => {
			sent.push(Date.now())
			return true
		},
		{
			async next() {
				await new Promise(resolve => setTimeout(resolve, 10))
				return new Uint8Array([1])
			}
		},
		{ timing: { mode: 'clock', packetDurationMs: 60 } }
	)
	try {
		t.mock.timers.tick(10)
		await flush()
		assert.deepEqual(sent, [10])
		t.mock.timers.tick(50)
		await flush()
		t.mock.timers.tick(10)
		await flush()
		assert.deepEqual(sent, [10, 70])
	} finally {
		pump.stop()
		await pump.done
	}
})
