/**
 * Encoded-audio pumps, sources, sinks and socket-method wiring — without a
 * live call.
 *
 * A live engine loop needs a connection, a peer and a relay, none of which
 * exists here (the mock server answers no call stanzas and there is no
 * account to dial with). What this pins is everything around that loop:
 *
 * - the silence and file sources packetize and pace without a microphone,
 *   ffmpeg, or any codec in the package;
 * - the pump moves every packet, counts shed audio instead of erroring on
 *   it, and stops on a spent source, an abort, or a throwing push;
 * - the media router delivers each encoded frame to the right call's sinks,
 *   never throws back into the bridge pump, and ends pumps on `ended`;
 * - the socket methods validate arguments ahead of the bridge and report a
 *   missing audio domain as 501 rather than `not a function`.
 *
 * The real bridge surface — that the preview client carries these operations
 * with these shapes — is `call-audio-surface.test.ts`.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
	asCallAudioClient,
	endMediaCallIfPresent,
	makeCallAudioMethods,
	makeCallMediaRouter,
	makeFileCallAudioSource,
	makeSilenceCallAudioSource,
	MLOW_SILENCE_PACKET,
	openFilePacketReader,
	startCallAudioPump,
	type CallAudioBridgeClient,
	type CallMediaRouter
} from '../Socket/calls.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { CallAudioFrame, CallAudioPacketSource, CallMediaEvent } from '../Types/Call.ts'
import { expect } from './expect.ts'

const scriptedSource = (packets: Uint8Array[]): CallAudioPacketSource => {
	let index = 0
	return {
		next: async () => (index < packets.length ? packets[index++]! : null)
	}
}

const stubCtx = (client: object, closing = false): SocketContext =>
	({
		withClient: async (operation: (client: never) => unknown) => operation(client as never),
		isClosing: () => closing,
		reportUnexpectedError: () => undefined
	}) as unknown as SocketContext

const nullRouter = (): CallMediaRouter =>
	makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })

describe('call audio silence source', () => {
	it('emits the MLOW silence token the core accepts as an encoded payload', async () => {
		expect(MLOW_SILENCE_PACKET).toEqual(new Uint8Array([0x90]))
		const source = makeSilenceCallAudioSource({ packets: 2, intervalMs: 0 })
		expect(await source.next()).toEqual(new Uint8Array([0x90]))
		expect(await source.next()).toEqual(new Uint8Array([0x90]))
		expect(await source.next()).toBe(null)
	})

	it('hands each tick its own view', async () => {
		const source = makeSilenceCallAudioSource({ packets: 2, intervalMs: 0 })
		const first = (await source.next())!
		first[0] = 0x00
		expect(await source.next()).toEqual(new Uint8Array([0x90]))
	})

	it('a zero packet budget is spent immediately', async () => {
		expect(await makeSilenceCallAudioSource({ packets: 0 }).next()).toBe(null)
	})

	it('mutating the exported sample never changes call traffic', async () => {
		MLOW_SILENCE_PACKET[0] = 0x00
		try {
			const source = makeSilenceCallAudioSource({ packets: 1, intervalMs: 0 })
			expect(await source.next()).toEqual(new Uint8Array([0x90]))
		} finally {
			MLOW_SILENCE_PACKET[0] = 0x90
		}
		expect(MLOW_SILENCE_PACKET).toEqual(new Uint8Array([0x90]))
	})

	it('rejects an empty custom packet and a negative interval', () => {
		expect(() => makeSilenceCallAudioSource({ packet: new Uint8Array(0) })).toThrow(/non-empty/)
		expect(() => makeSilenceCallAudioSource({ intervalMs: -1 })).toThrow(/intervalMs/)
	})

	it('rejects a packet count that is not a non-negative integer', () => {
		for (const packets of [Number.NaN, 2.5, -1]) {
			expect(() => makeSilenceCallAudioSource({ packets, intervalMs: 0 })).toThrow(/non-negative integer/)
		}
	})

	it('copies a Buffer packet per tick instead of aliasing it', async () => {
		const packet = Buffer.from([0x90])
		const source = makeSilenceCallAudioSource({ packet, packets: 2, intervalMs: 0 })
		const first = (await source.next())!
		expect(first).not.toBe(packet)
		first[0] = 0x00
		expect(await source.next()).toEqual(new Uint8Array([0x90]))
	})
})

describe('call audio file source', () => {
	it('chunks a file into fixed packets with no codec involved', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-audio-'))
		try {
			const path = join(dir, 'fixture.bin')
			await writeFile(path, new Uint8Array([0, 1, 2, 3, 4, 5, 6]))
			const source = await makeFileCallAudioSource(path, { packetBytes: 3, intervalMs: 0 })
			expect(await source.next()).toEqual(new Uint8Array([0, 1, 2]))
			expect(await source.next()).toEqual(new Uint8Array([3, 4, 5]))
			expect(await source.next()).toEqual(new Uint8Array([6]))
			expect(await source.next()).toBe(null)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('honours a packet cap shorter than the file', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-audio-'))
		try {
			const path = join(dir, 'fixture.bin')
			await writeFile(path, new Uint8Array([9, 9, 9, 9]))
			const source = await makeFileCallAudioSource(path, { packetBytes: 1, intervalMs: 0, packets: 2 })
			expect(await source.next()).toEqual(new Uint8Array([9]))
			expect(await source.next()).toEqual(new Uint8Array([9]))
			expect(await source.next()).toBe(null)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('rejects a non-positive packet size', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-audio-'))
		try {
			const path = join(dir, 'fixture.bin')
			await writeFile(path, new Uint8Array([1]))
			await expect(makeFileCallAudioSource(path, { packetBytes: 0 })).rejects.toThrow(/packetBytes/)
			await expect(makeFileCallAudioSource(path, { packets: Number.NaN })).rejects.toThrow(/non-negative integer/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

describe('call audio file reader', () => {
	const fixture = async (dir: string, bytes: number[]): Promise<string> => {
		const path = join(dir, 'fixture.bin')
		await writeFile(path, new Uint8Array(bytes))
		return path
	}

	it('reads full packets into one reused target', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-reader-'))
		try {
			const reader = await openFilePacketReader(await fixture(dir, [0, 1, 2, 3, 4, 5]), { packetBytes: 2 })
			const target = new Uint8Array(2)
			try {
				expect(await reader.readInto(target)).toBe(2)
				expect(Array.from(target)).toEqual([0, 1])
				expect(await reader.readInto(target)).toBe(2)
				expect(Array.from(target)).toEqual([2, 3])
				expect(await reader.readInto(target)).toBe(2)
				expect(await reader.readInto(target)).toBe(null)
			} finally {
				await reader.close()
			}
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('fails a runt tail instead of truncating, and rejects a small target', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-reader-'))
		try {
			const reader = await openFilePacketReader(await fixture(dir, [0, 1, 2]), { packetBytes: 2 })
			try {
				expect(await reader.readInto(new Uint8Array(2))).toBe(2)
				await expect(reader.readInto(new Uint8Array(2))).rejects.toThrow(/multiple/)
				await expect(reader.readInto(new Uint8Array(1))).rejects.toThrow(/full packet/)
			} finally {
				await reader.close()
			}
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('close is idempotent and reads after close throw', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-reader-'))
		try {
			const reader = await openFilePacketReader(await fixture(dir, [0, 1]), { packetBytes: 2 })
			await reader.close()
			await reader.close()
			await expect(reader.readInto(new Uint8Array(2))).rejects.toThrow(/closed/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('an aborted read closes the reader', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-reader-'))
		try {
			const reader = await openFilePacketReader(await fixture(dir, [0, 1]), { packetBytes: 2 })
			const controller = new AbortController()
			controller.abort()
			await expect(reader.readInto(new Uint8Array(2), controller.signal)).rejects.toThrow()
			await expect(reader.readInto(new Uint8Array(2))).rejects.toThrow(/closed/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('concurrent reads run in order without duplicating packets', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-reader-'))
		try {
			const reader = await openFilePacketReader(await fixture(dir, [0, 1, 2, 3]), { packetBytes: 2 })
			try {
				const first = new Uint8Array(2)
				const second = new Uint8Array(2)
				const [firstRead, secondRead] = await Promise.all([reader.readInto(first), reader.readInto(second)])
				expect(firstRead).toBe(2)
				expect(secondRead).toBe(2)
				const packets = [Array.from(first).join(','), Array.from(second).join(',')].toSorted()
				expect(packets).toEqual(['0,1', '2,3'])
			} finally {
				await reader.close()
			}
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('concurrent closes share one completion', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'baileyrs-call-reader-'))
		try {
			const reader = await openFilePacketReader(await fixture(dir, [0, 1]), { packetBytes: 2 })
			const first = reader.close()
			const second = reader.close()
			expect(second).toBe(first)
			await first
			await expect(reader.readInto(new Uint8Array(2))).rejects.toThrow(/closed/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

describe('call audio pump', () => {
	it('moves every packet and reports the totals', async () => {
		const seen: number[] = []
		const pump = startCallAudioPump(
			data => {
				seen.push(data[0]!)
				return true
			},
			scriptedSource([new Uint8Array([1]), new Uint8Array([2])])
		)
		expect(await pump.done).toEqual({ pushed: 2, shed: 0, stopReason: 'source-ended' })
		expect(seen).toEqual([1, 2])
	})

	it('awaits an async push the same way', async () => {
		const pump = startCallAudioPump(
			async data => data[0] === 1,
			scriptedSource([new Uint8Array([1]), new Uint8Array([2])])
		)
		expect(await pump.done).toEqual({ pushed: 1, shed: 1, stopReason: 'source-ended' })
	})

	it('paces pulls to a clock instead of the source', async () => {
		const pump = startCallAudioPump(
			() => true,
			scriptedSource([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]),
			{
				timing: { mode: 'clock', packetDurationMs: 20 }
			}
		)
		const started = Date.now()
		expect(await pump.done).toEqual({ pushed: 3, shed: 0, stopReason: 'source-ended' })
		expect(Date.now() - started >= 30).toBe(true)
	})

	it('a stop during the clock wait settles at once', async () => {
		const pump = startCallAudioPump(() => true, scriptedSource([new Uint8Array([1])]), {
			timing: { mode: 'clock', packetDurationMs: 60_000 }
		})
		// Let the first pull land, then stop inside the hour-long wait: done
		// must settle in milliseconds, and the parked pull after it must not
		// hang a later stop either.
		await new Promise(resolve => setImmediate(resolve))
		await new Promise(resolve => setImmediate(resolve))
		const started = Date.now()
		pump.stop()
		expect(await pump.done).toEqual({ pushed: 1, shed: 0, stopReason: 'stopped' })
		expect(Date.now() - started < 5_000).toBe(true)
	})

	it('rejects a clock period that is not a positive number', () => {
		for (const packetDurationMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() =>
				startCallAudioPump(() => true, scriptedSource([]), { timing: { mode: 'clock', packetDurationMs } })
			).toThrow(/packetDurationMs/)
		}
	})

	it('rejects a misspelled timing mode instead of running unpaced', () => {
		expect(() =>
			startCallAudioPump(() => true, scriptedSource([]), {
				timing: { mode: 'clcok', packetDurationMs: 20 } as unknown as { mode: 'clock'; packetDurationMs: number }
			})
		).toThrow(/timing\.mode/)
	})

	it('counts shed packets and reports them instead of erroring', async () => {
		const shedTotals: number[] = []
		const pump = startCallAudioPump(
			data => data[0] !== 0x90,
			scriptedSource([new Uint8Array([1]), new Uint8Array([0x90]), new Uint8Array([3])]),
			{
				onShed: total => shedTotals.push(total)
			}
		)
		expect(await pump.done).toEqual({ pushed: 2, shed: 1, stopReason: 'source-ended' })
		expect(shedTotals).toEqual([1])
	})

	it('stop() wakes a source parked in next()', async () => {
		const pump = startCallAudioPump(() => true, { next: () => new Promise<Uint8Array | null>(() => {}) })
		pump.stop()
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'stopped' })
	})

	it('an abort settles a parked pull instead of hanging it', async () => {
		const controller = new AbortController()
		const pump = startCallAudioPump(
			() => true,
			{ next: () => new Promise<Uint8Array | null>(() => {}) },
			{
				signal: controller.signal
			}
		)
		controller.abort()
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'aborted' })
	})

	it('a pre-aborted signal runs nothing and still settles', async () => {
		const controller = new AbortController()
		controller.abort()
		let pulled = false
		const pump = startCallAudioPump(
			() => true,
			{
				next: async () => {
					pulled = true
					return new Uint8Array([1])
				}
			},
			{ signal: controller.signal }
		)
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'aborted' })
		expect(pulled).toBe(false)
	})

	it('stop() ends the run with the totals so far', async () => {
		let first = true
		const pump = startCallAudioPump(
			() => {
				if (first) {
					first = false
					pump.stop()
				}
				return true
			},
			scriptedSource([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])])
		)
		expect(await pump.done).toEqual({ pushed: 1, shed: 0, stopReason: 'stopped' })
	})

	it('an abort stops the run without an error', async () => {
		const controller = new AbortController()
		const pump = startCallAudioPump(() => true, makeSilenceCallAudioSource({ intervalMs: 5 }), {
			signal: controller.signal
		})
		controller.abort()
		const stats = await pump.done
		expect(stats.pushed + stats.shed >= 0).toBe(true)
	})

	it('a throwing push rejects done so an ended call surfaces', async () => {
		const failure = new Error('no live call for this call id')
		let released = false
		const pump = startCallAudioPump(
			() => {
				throw failure
			},
			{
				next: async () => new Uint8Array([1]),
				release: () => {
					released = true
				}
			}
		)
		await expect(pump.done).rejects.toThrow(failure)
		expect(released).toBe(true)
	})

	it('a synchronously throwing release neither escapes stop nor masks the failure', async () => {
		const failure = new Error('no live call for this call id')
		const source = {
			next: async () => new Uint8Array([1]),
			release: () => {
				throw new Error('broken host cleanup')
			}
		}
		const pump = startCallAudioPump(() => {
			throw failure
		}, source)
		await expect(pump.done).rejects.toThrow(failure)
		expect(() => pump.stop()).not.toThrow()
	})

	it('a stalled async push settles on stop without counting', async () => {
		const pump = startCallAudioPump(
			() => new Promise<boolean>(() => {}),
			scriptedSource([new Uint8Array([1]), new Uint8Array([2])])
		)
		// Let the first push park, then stop: done resolves with nothing
		// counted either way.
		await new Promise(resolve => setImmediate(resolve))
		pump.stop()
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'stopped' })
	})

	it('refuses an empty packet from a broken source', async () => {
		const pump = startCallAudioPump(() => true, scriptedSource([new Uint8Array(0)]))
		await expect(pump.done).rejects.toThrow(/non-empty/)
	})

	it('pulls straight from an async generator, no wrapper', async () => {
		const seen: number[] = []
		async function* packets(): AsyncGenerator<Uint8Array> {
			yield new Uint8Array([1])
			yield new Uint8Array([2])
		}
		const pump = startCallAudioPump(data => {
			seen.push(data[0]!)
			return true
		}, packets())
		expect(await pump.done).toEqual({ pushed: 2, shed: 0, stopReason: 'source-ended' })
		expect(seen).toEqual([1, 2])
	})

	it('rejects a source that is neither next() nor iterable', () => {
		expect(() => startCallAudioPump(() => true, {} as never)).toThrow(/async iterable/)
	})

	it('stopping early releases the generator', async () => {
		let cleanedUp = false
		async function* packets(): AsyncGenerator<Uint8Array> {
			try {
				yield new Uint8Array([1])
				yield new Uint8Array([2])
			} finally {
				cleanedUp = true
			}
		}
		let pump!: { done: Promise<{ pushed: number; shed: number }>; stop: () => void }
		pump = startCallAudioPump(data => {
			if (data[0] === 1) pump.stop()
			return true
		}, packets())
		expect(await pump.done).toEqual({ pushed: 1, shed: 0, stopReason: 'stopped' })
		expect(cleanedUp).toBe(true)
	})

	it('natural exhaustion never triggers release', async () => {
		let released = false
		const pump = startCallAudioPump(() => true, {
			next: async () => null,
			release: () => {
				released = true
			}
		})
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'source-ended' })
		expect(released).toBe(false)
	})

	it('a teardown stop settles done past a wedged release', async () => {
		// The release never settles: a call-scoped stop would wait it out
		// forever, but the teardown policy must settle `done` at once while
		// the first stop reason still wins the report.
		const pump = startCallAudioPump(() => true, {
			next: () => new Promise<Uint8Array | null>(() => {}),
			release: () => new Promise<void>(() => {})
		})
		pump.stop('call-ended')
		pump.stop('socket-closed')
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'call-ended' })
	})
})

describe('call media router', () => {
	const frame = (callId: string): CallAudioFrame => ({
		callId,
		data: new Uint8Array([0x90]),
		codec: 'mlow',
		payloadType: 120,
		sequenceNumber: 7,
		timestamp: 960,
		marker: false
	})

	it('routes frames to the right call only', () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const first: CallAudioFrame[] = []
		const second: CallAudioFrame[] = []
		const off = router.addAudioSink('CALL-1', f => first.push(f))
		router.addAudioSink('CALL-2', f => second.push(f))
		router.routeAudioFrame(frame('CALL-1'))
		router.routeAudioFrame(frame('CALL-2'))
		off()
		router.routeAudioFrame(frame('CALL-1'))
		expect(first).toHaveLength(1)
		expect(second).toHaveLength(1)
	})

	it('shares one owned frame across a call sinks, valid after the route', () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const seen: CallAudioFrame[] = []
		router.addAudioSink('CALL-1', f => seen.push(f))
		router.addAudioSink('CALL-1', f => seen.push(f))
		router.routeAudioFrame(frame('CALL-1'))
		expect(seen).toHaveLength(2)
		expect(seen[0]).toBe(seen[1])
		// Retained past the callback: the bytes stay valid, so a sink may
		// queue the reference instead of copying for validity.
		expect(Array.from(seen[0]!.data)).toEqual([0x90])
	})

	it('a throwing sink neither breaks the other sinks nor escapes to the bridge', () => {
		const failures: unknown[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: () => undefined,
			reportError: err => failures.push(err)
		})
		const survivors: CallAudioFrame[] = []
		router.addAudioSink('CALL-1', () => {
			throw new Error('broken host')
		})
		router.addAudioSink('CALL-1', f => survivors.push(f))
		router.routeAudioFrame(frame('CALL-1'))
		expect(survivors).toHaveLength(1)
		expect(failures).toHaveLength(1)
	})

	it('drops malformed frames and events with a report instead of a throw', () => {
		const failures: unknown[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: () => undefined,
			reportError: err => failures.push(err)
		})
		router.routeAudioFrame({ callId: 'CALL-1' } as unknown as CallAudioFrame)
		router.routeAudioFrame({
			callId: 'CALL-1',
			data: new Uint8Array([0x90]),
			codec: 'mlow'
		} as unknown as CallAudioFrame)
		router.routeMediaEvent({ nope: true } as unknown as CallMediaEvent)
		expect(failures).toHaveLength(3)
	})

	it('drops frames with non-finite or out-of-range RTP metadata', () => {
		const failures: unknown[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: () => undefined,
			reportError: err => failures.push(err)
		})
		const received: CallAudioFrame[] = []
		router.addAudioSink('CALL-1', f => received.push(f))
		const bad = (override: Partial<CallAudioFrame>): unknown => ({ ...frame('CALL-1'), ...override })
		for (const candidate of [
			bad({ payloadType: Number.NaN }),
			bad({ payloadType: Number.POSITIVE_INFINITY }),
			bad({ payloadType: 128 }),
			bad({ payloadType: 1.5 }),
			bad({ sequenceNumber: -1 }),
			bad({ sequenceNumber: 65536 }),
			bad({ timestamp: -1 }),
			bad({ timestamp: 4294967296 })
		]) {
			router.routeAudioFrame(candidate as CallAudioFrame)
		}
		expect(received).toHaveLength(0)
		expect(failures).toHaveLength(8)
		router.routeAudioFrame(frame('CALL-1'))
		expect(received).toHaveLength(1)
	})

	it('emits media events and ends the call on ended', () => {
		const emitted: CallMediaEvent[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: event => emitted.push(event),
			reportError: () => undefined
		})
		let stopped = false
		router.trackPump('CALL-1', () => {
			stopped = true
		})
		const received: CallAudioFrame[] = []
		router.addAudioSink('CALL-1', f => received.push(f))
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'relay-allocated' })
		expect(emitted).toEqual([{ callId: 'CALL-1', kind: 'relay-allocated' }])
		expect(stopped).toBe(false)
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'ended' })
		expect(stopped).toBe(true)
		router.routeAudioFrame(frame('CALL-1'))
		expect(received).toHaveLength(0)
	})

	it('a throwing call.media listener never reaches the bridge callback', () => {
		const failures: unknown[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: () => {
				throw new Error('broken consumer')
			},
			reportError: err => failures.push(err)
		})
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'relay-allocated' })
		expect(failures).toHaveLength(1)
	})

	it('drops a version-skewed event kind instead of publishing it', () => {
		const emitted: CallMediaEvent[] = []
		const failures: unknown[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: event => emitted.push(event),
			reportError: err => failures.push(err)
		})
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'exploded' } as unknown as CallMediaEvent)
		expect(emitted).toEqual([])
		expect(failures).toHaveLength(1)
	})

	it('drops variant fields that break their documented shape', () => {
		const emitted: CallMediaEvent[] = []
		const failures: unknown[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: event => emitted.push(event),
			reportError: err => failures.push(err)
		})
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'relay-allocate-failed', code: '500' } as never)
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'audio-codec-switched', from: 7 } as never)
		expect(emitted).toEqual([])
		expect(failures).toHaveLength(2)
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'relay-allocate-failed', code: 500 })
		expect(emitted).toHaveLength(1)
	})

	it('a sink registered mid-dispatch waits for the next frame', () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const makeFrame = (sequenceNumber: number): CallAudioFrame => ({
			callId: 'CALL-1',
			data: new Uint8Array([0x90]),
			codec: 'mlow',
			payloadType: 120,
			sequenceNumber,
			timestamp: 960,
			marker: false
		})
		const second: CallAudioFrame[] = []
		let registered = false
		router.addAudioSink('CALL-1', () => {
			if (!registered) {
				registered = true
				router.addAudioSink('CALL-1', f => second.push(f))
			}
		})
		router.routeAudioFrame(makeFrame(1))
		expect(second).toHaveLength(0)
		router.routeAudioFrame(makeFrame(2))
		expect(second).toHaveLength(1)
	})

	it('stopAll ends every pump and drops every sink', () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		let stops = 0
		router.trackPump('CALL-1', () => stops++)
		router.trackPump('CALL-2', () => stops++)
		router.stopAll()
		expect(stops).toBe(2)
	})

	it('names the reason each stop path reports', () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const reasons: (string | undefined)[] = []
		router.trackPump('CALL-1', reason => reasons.push(reason))
		router.stopCall('CALL-1')
		router.trackPump('CALL-2', reason => reasons.push(reason))
		router.stopAll()
		expect(reasons).toEqual(['call-ended', 'socket-closed'])
	})

	it('drainAll stops every pump and waits for each done', async () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		let stops = 0
		let settled = 0
		const gate = (): Promise<unknown> => new Promise(resolve => setImmediate(() => resolve(settled++)))
		router.trackPump('CALL-1', () => stops++, gate())
		router.trackPump('CALL-2', () => stops++, Promise.reject(new Error('already gone')))
		const received: CallAudioFrame[] = []
		router.addAudioSink('CALL-1', f => received.push(f))
		await router.drainAll()
		expect(stops).toBe(2)
		expect(settled).toBe(1)
		router.routeAudioFrame({
			callId: 'CALL-1',
			data: new Uint8Array([0x90]),
			codec: 'mlow',
			payloadType: 120,
			sequenceNumber: 1,
			timestamp: 960,
			marker: false
		})
		expect(received).toHaveLength(0)
	})

	it('drainAll waits for releases that an earlier stopCall started', async () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		let released = false
		const gate = (): Promise<unknown> =>
			new Promise(resolve =>
				setImmediate(() => {
					released = true
					resolve(undefined)
				})
			)
		router.trackPump('CALL-1', () => undefined, gate())
		router.stopCall('CALL-1')
		await router.drainAll()
		expect(released).toBe(true)
	})

	it('drainAll re-stops earlier pumps with the teardown policy', async () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const reasons: (string | undefined)[] = []
		let release!: () => void
		const done = new Promise<unknown>(resolve => {
			release = () => resolve(undefined)
		})
		let stops = 0
		// Settles only on the second stop: without the teardown re-stop,
		// drainAll would wait this out forever.
		router.trackPump(
			'CALL-1',
			reason => {
				stops++
				reasons.push(reason)
				if (stops === 2) release()
			},
			done
		)
		router.stopCall('CALL-1')
		const watchdog = new Promise<never>((_, reject) => {
			const timer = setTimeout(() => reject(new Error('drainAll hung on a settling pump')), 2_000)
			timer.unref?.()
		})
		await Promise.race([router.drainAll(), watchdog])
		expect(reasons).toEqual(['call-ended', 'socket-closed'])
	})

	it('a real pump wedged in release settles through router teardown', async () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const pump = startCallAudioPump(() => true, {
			next: () => new Promise<Uint8Array | null>(() => {}),
			release: () => new Promise<void>(() => {})
		})
		router.trackPump('CALL-1', pump.stop, pump.done)
		router.stopCall('CALL-1')
		const watchdog = new Promise<never>((_, reject) => {
			const timer = setTimeout(() => reject(new Error('drainAll hung on a wedged pump')), 2_000)
			timer.unref?.()
		})
		await Promise.race([router.drainAll(), watchdog])
		expect(await pump.done).toEqual({ pushed: 0, shed: 0, stopReason: 'call-ended' })
	})

	it('untracking one pump leaves its siblings and sinks alone', () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const received: CallAudioFrame[] = []
		router.addAudioSink('CALL-1', f => received.push(f))
		const makeFrame = (sequenceNumber: number): CallAudioFrame => ({
			callId: 'CALL-1',
			data: new Uint8Array([0x90]),
			codec: 'mlow',
			payloadType: 120,
			sequenceNumber,
			timestamp: 960,
			marker: false
		})
		let siblingStops = 0
		let finishedStops = 0
		const finished = (): void => {
			finishedStops++
		}
		const sibling = (): void => {
			siblingStops++
		}
		router.trackPump('CALL-1', finished)
		router.trackPump('CALL-1', sibling)
		// One pump finishes: its tracking goes, nothing else moves.
		router.untrackPump('CALL-1', finished)
		router.routeAudioFrame(makeFrame(1))
		expect(received).toHaveLength(1)
		// Only the real end of the call stops the sibling and drops the sink.
		router.stopCall('CALL-1')
		expect(siblingStops).toBe(1)
		expect(finishedStops).toBe(0)
		router.routeAudioFrame(makeFrame(2))
		expect(received).toHaveLength(1)
	})
})

describe('call audio socket methods', () => {
	const liveClient = (): CallAudioBridgeClient =>
		({
			acceptCall: async (callId: string) => callId,
			dialCall: async () => 'CALL-NEW',
			callPushAudio: () => true,
			endCall: async () => ({ outcome: 'peer-notified' }),
			setCallMuted: async () => undefined,
			getCallMediaStats: () => ({
				rtpReceived: 10,
				rtpPayloadTypeUnexpected: 0,
				srtpUnprotectFailed: 0,
				sframeDecryptFailed: 0,
				audioFramesDecoded: 8,
				audioFramesDelivered: 8,
				audioFramesConcealed: 0,
				mlowOffPointDropped: 0,
				mlowInactiveOrSid: 2,
				foreignFramesDecoded: 0,
				audioFramesWithoutDecoder: 0,
				outboundFramesWithoutEncoder: 0,
				playoutTrimmedSamples: 0,
				inboundPipeDropped: 1,
				audioSinkDropped: 0,
				videoSinkDropped: 0,
				peerKeyframeRequests: 0,
				relayPacketUnclassified: 0,
				forwardingEnvelopeRejected: 0,
				codecSwitches: 0
			}),
			getActiveCalls: () => [{ callId: 'CALL-1', peerJid: '5511999999999@s.whatsapp.net' }],
			setRelayTransportProvider: () => undefined
		}) as CallAudioBridgeClient

	it('drives the bridge operations with validated arguments', async () => {
		const methods = makeCallAudioMethods(stubCtx(liveClient()), nullRouter())
		expect(await methods.dialCall('5511999999999@s.whatsapp.net', 'mlow')).toBe('CALL-NEW')
		expect(await methods.acceptCall('CALL-1')).toBe('CALL-1')
		expect(await methods.pushCallAudio('CALL-1', new Uint8Array([0x90]))).toBe(true)
		expect(await methods.endCall('CALL-1')).toEqual({ outcome: 'peer-notified' })
		await methods.setCallMuted('CALL-1', true)
		const stats = await methods.getCallMediaStats('CALL-1')
		expect(stats.rtpReceived).toBe(10)
		expect(stats.audioSinkDropped).toBe(0)
		expect(await methods.getActiveCalls()).toEqual([{ callId: 'CALL-1', peerJid: '5511999999999@s.whatsapp.net' }])
		await methods.setRelayTransportProvider({
			createRelayConnection: async () => ({
				send: () => undefined,
				close: () => undefined
			})
		})
	})

	it('rejects bad arguments before reaching the bridge', async () => {
		let crossed = false
		const methods = makeCallAudioMethods(
			stubCtx({
				dialCall: async () => {
					crossed = true
					return 'CALL-NEW'
				}
			}),
			nullRouter()
		)
		await expect(methods.dialCall('')).rejects.toThrow(/peerJid/)
		await expect(methods.dialCall('peer@s.whatsapp.net', 'g729' as 'mlow')).rejects.toThrow(/audioFormat/)
		await expect(methods.acceptCall('')).rejects.toThrow(/callId/)
		expect(crossed).toBe(false)
	})

	it('reports a bridge without the audio domain as 501, not a TypeError', async () => {
		const methods = makeCallAudioMethods(stubCtx({}), nullRouter())
		await expect(methods.dialCall('5511999999999@s.whatsapp.net')).rejects.toThrow(/client-calls-audio/)
	})

	it('refuses pumps and writers once teardown owns the client', async () => {
		const pushClient = {
			callPushAudio: () => true
		}
		const open = makeCallAudioMethods(stubCtx(pushClient), nullRouter())
		const pump = await open.startCallAudioPump('CALL-1', scriptedSource([new Uint8Array([1])]))
		expect(await pump.done).toEqual({ pushed: 1, shed: 0, stopReason: 'source-ended' })

		const closing = makeCallAudioMethods(stubCtx(pushClient, true), nullRouter())
		await expect(closing.startCallAudioPump('CALL-1', scriptedSource([new Uint8Array([1])]))).rejects.toThrow(
			/Connection Closed/
		)
		await expect(closing.openCallAudioWriter('CALL-1')).rejects.toThrow(/Connection Closed/)
	})

	it('asCallAudioClient probes the method being used', () => {
		const partial = { dialCall: async () => 'CALL-1' }
		expect(asCallAudioClient(partial, 'dialCall').dialCall).toBe(partial.dialCall)
		expect(() => asCallAudioClient(partial, 'acceptCall')).toThrow(/acceptCall/)
	})

	it('endMediaCallIfPresent ends the record, or reports there is none', async () => {
		const coded = Object.assign(new Error('no live call'), { kind: 'invalid-argument', field: 'callId' })
		expect(await endMediaCallIfPresent(stubCtx({}), 'CALL-1')).toBe(false)
		expect(
			await endMediaCallIfPresent(stubCtx({ endCall: async () => ({ outcome: 'peer-notified' }) }), 'CALL-1')
		).toBe(true)
		expect(
			await endMediaCallIfPresent(stubCtx({ endCall: async () => ({ outcome: 'local-only', failure: 'x' }) }), 'CALL-1')
		).toBe(false)
		const localOnlyReported: unknown[] = []
		const localOnlyCtx = {
			withClient: async (operation: (client: never) => unknown) =>
				operation({ endCall: async () => ({ outcome: 'local-only', failure: 'x' }) } as never),
			isClosing: () => false,
			reportUnexpectedError: (err: unknown) => localOnlyReported.push(err)
		} as unknown as SocketContext
		expect(await endMediaCallIfPresent(localOnlyCtx, 'CALL-1')).toBe(false)
		expect(localOnlyReported).toEqual([])
		const reported: unknown[] = []
		const reportingCtx = {
			withClient: async (operation: (client: never) => unknown) =>
				operation({ endCall: async () => ({ outcome: 'frobnicated' }) } as never),
			isClosing: () => false,
			reportUnexpectedError: (err: unknown) => reported.push(err)
		} as unknown as SocketContext
		expect(await endMediaCallIfPresent(reportingCtx, 'CALL-1')).toBe(false)
		expect(reported).toHaveLength(1)
		expect(
			await endMediaCallIfPresent(
				stubCtx({
					endCall: async () => {
						throw coded
					}
				}),
				'CALL-1'
			)
		).toBe(false)
		await expect(
			endMediaCallIfPresent(
				stubCtx({
					endCall: async () => {
						throw new Error('gone')
					}
				}),
				'CALL-1'
			)
		).rejects.toThrow(/gone/)
	})

	it('rejects non-numeric stats instead of forwarding them', async () => {
		const methods = makeCallAudioMethods(
			stubCtx({
				getCallMediaStats: () => ({ rtpReceived: 'lots' })
			}),
			nullRouter()
		)
		await expect(methods.getCallMediaStats('CALL-1')).rejects.toThrow(/rtpReceived/)
	})

	it('endCall stops the call pumps even when the bridge reports already-ended', async () => {
		const emitted: CallMediaEvent[] = []
		const router = makeCallMediaRouter({
			emitMediaEvent: event => emitted.push(event),
			reportError: () => undefined
		})
		let stopped = false
		router.trackPump('CALL-1', () => {
			stopped = true
		})
		const methods = makeCallAudioMethods(stubCtx({ endCall: async () => ({ outcome: 'already-ended' }) }), router)
		expect(await methods.endCall('CALL-1')).toEqual({ outcome: 'already-ended' })
		expect(stopped).toBe(true)
	})

	it('endCall forgets the call through the hook on success only', async () => {
		const forgotten: string[] = []
		const withHooks = (client: object): ReturnType<typeof makeCallAudioMethods> =>
			makeCallAudioMethods(stubCtx(client), nullRouter(), { onCallEnded: id => forgotten.push(id) })
		expect(await withHooks({ endCall: async () => ({ outcome: 'peer-notified' }) }).endCall('CALL-1')).toEqual({
			outcome: 'peer-notified'
		})
		expect(forgotten).toEqual(['CALL-1'])
		await expect(
			withHooks({
				endCall: async () => {
					throw new Error('offline')
				}
			}).endCall('CALL-2')
		).rejects.toThrow(/offline/)
		expect(forgotten).toEqual(['CALL-1'])
	})

	it('a writer sends synchronously and dies with the call, not the process', async () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		const seen: Uint8Array[] = []
		const methods = makeCallAudioMethods(
			stubCtx({
				callPushAudio: (callId: string, data: Uint8Array) => {
					if (callId.endsWith('FULL')) return false
					seen.push(data)
					return true
				}
			}),
			router
		)
		const writer = await methods.openCallAudioWriter('CALL-1')
		const packet = new Uint8Array([0x90])
		expect(writer.tryWrite(packet)).toBe(true)
		// No copy on this side: the bridge got the caller's own buffer.
		expect(seen[0]).toBe(packet)
		expect(writer.tryWrite(packet)).toBe(true)
		writer.close()
		writer.close()
		expect(writer.tryWrite(packet)).toBe(false)
		expect(seen).toHaveLength(2)

		const shedding = await methods.openCallAudioWriter('CALL-1FULL')
		expect(shedding.tryWrite(packet)).toBe(false)

		const live = await methods.openCallAudioWriter('CALL-2')
		expect(live.tryWrite(packet)).toBe(true)
		router.routeMediaEvent({ callId: 'CALL-2', kind: 'ended' })
		expect(live.tryWrite(packet)).toBe(false)
		expect(seen).toHaveLength(3)
	})

	it('a finished pump leaves the live call alone', async () => {
		const router = makeCallMediaRouter({ emitMediaEvent: () => undefined, reportError: () => undefined })
		let pushed = 0
		const methods = makeCallAudioMethods(
			stubCtx({
				callPushAudio: () => {
					pushed++
					return true
				}
			}),
			router
		)
		const received: CallAudioFrame[] = []
		methods.onCallAudio('CALL-1', f => received.push(f))
		const first = await methods.startCallAudioPump('CALL-1', scriptedSource([new Uint8Array([1])]))
		const second = await methods.startCallAudioPump('CALL-1', scriptedSource([new Uint8Array([2])]))
		expect(await first.done).toEqual({ pushed: 1, shed: 0, stopReason: 'source-ended' })
		expect(await second.done).toEqual({ pushed: 1, shed: 0, stopReason: 'source-ended' })
		router.routeMediaEvent({ callId: 'CALL-1', kind: 'relay-allocated' })
		router.routeAudioFrame({
			callId: 'CALL-1',
			data: new Uint8Array([0x90]),
			codec: 'mlow',
			payloadType: 120,
			sequenceNumber: 9,
			timestamp: 960,
			marker: false
		})
		expect(pushed).toBe(2)
		expect(received).toHaveLength(1)
	})
})
