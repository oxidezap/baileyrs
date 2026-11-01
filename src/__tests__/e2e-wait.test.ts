import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { it } from 'node:test'
import { waitForEvent } from './e2e/wait.ts'

it('cancels an event waiter and detaches it before a late event', async () => {
	const ev = new EventEmitter()
	const socket = { ev } as unknown as Parameters<typeof waitForEvent>[0]
	const waiting = waitForEvent(socket, 'call', () => true, 15000)
	assert.equal(ev.listenerCount('call'), 1)
	waiting.cancel()
	await assert.rejects(waiting, { name: 'AbortError' })
	assert.equal(ev.listenerCount('call'), 0)
	ev.emit('call', [])
})
