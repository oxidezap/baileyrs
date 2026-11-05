import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withDeadline } from './deadline.ts'

test('deadline cancels a send that never completes before receive starts', { timeout: 1000 }, async () => {
	let receiveStarted = false
	let closed = false
	let rejectSend: ((error: Error) => void) | undefined
	const send = new Promise<void>((_, reject) => {
		rejectSend = reject
	})
	await assert.rejects(
		withDeadline(
			async () => {
				await send
				receiveStarted = true
			},
			10,
			async () => {
				closed = true
				rejectSend!(new Error('socket closed'))
			}
		),
		/send-and-receive deadline exceeded/
	)
	assert.equal(closed, true)
	assert.equal(receiveStarted, false)
})

test('completed and failed operations clear their deadline without cancellation', async () => {
	let cancelled = false
	const cancel = async () => {
		cancelled = true
	}
	assert.equal(await withDeadline(async () => 42, 1000, cancel), 42)
	await assert.rejects(
		withDeadline(
			async () => {
				throw new Error('send failed')
			},
			1000,
			cancel
		),
		/send failed/
	)
	assert.equal(cancelled, false)
})

test('deadline preserves a shutdown failure', { timeout: 1000 }, async () => {
	await assert.rejects(
		withDeadline(
			() => new Promise<void>(() => {}),
			10,
			async () => {
				throw new Error('flush failed')
			}
		),
		error => error instanceof AggregateError && error.errors.some(item => item.message === 'flush failed')
	)
})
