import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { waitForMockStartup } from './e2e/mock-startup.ts'

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

test('mock startup observes history failure while connection is pending', async () => {
	const connection = deferred<string>()
	const history = deferred<void>()
	const startup = waitForMockStartup(connection.promise, history.promise)
	const failure = new Error('history timeout')
	const rejected = assert.rejects(startup, error => error === failure)
	history.reject(failure)
	await rejected
	connection.reject(new Error('connection closed later'))
	await setImmediate()
})

test('mock startup observes history rejection after connection has failed', async () => {
	const connection = deferred<string>()
	const history = deferred<void>()
	const startup = waitForMockStartup(connection.promise, history.promise)
	const failure = new Error('connection closed')
	const rejected = assert.rejects(startup, error => error === failure)
	connection.reject(failure)
	await rejected
	history.reject(new Error('history timeout later'))
	await setImmediate()
})

test('mock startup waits for both branches and preserves the connection result', async () => {
	const history = deferred<void>()
	let completed = false
	const startup = waitForMockStartup(Promise.resolve('test-client'), history.promise)
	void startup.then(() => {
		completed = true
	})
	await setImmediate()
	assert.equal(completed, false)
	history.resolve(undefined)
	assert.equal(await startup, 'test-client')
})
