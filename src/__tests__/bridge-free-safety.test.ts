/**
 * Pins the bridge invariant that `sock.end()` depends on.
 *
 * Calling `WasmWhatsAppClient.free()` while any bridge call is still in flight
 * corrupts the wasm heap: dlmalloc trips
 * `assertion failed: psize <= size + max_overhead` and the process dies on
 * `RuntimeError: unreachable`, thrown from a microtask no `try/catch` around
 * `free()` can reach — `free()` itself returns normally. It is not specific to
 * one method; `logout()`, `disconnect()` and a plain `fetchBlocklist()` all
 * reproduce it.
 *
 * `await client.disconnect()` first drains those calls in order and makes the
 * `free()` safe. That is why `end()` awaits it before freeing
 * (`src/Socket/index.ts`).
 *
 * Why here and not through `makeWASocket`: offline, every socket method
 * rejects immediately, so the window never opens — the whole point is a call
 * that stays pending inside wasm, which needs either a live server or a
 * `free()` with no awaits in between. Driving the bridge directly is the only
 * way to hold that state open deterministically. Each case runs in a child
 * process because heap corruption takes the whole process with it.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { expect } from './expect.ts'

const SRC = import.meta.dirname

interface ChildOutcome {
	/** Exit code, or null when the watchdog killed it. */
	code: number | null
	timedOut: boolean
	/** Whether the child got as far as the call under test. */
	reachedTarget: boolean
	stderr: string
}

/** Build a client against a dead loopback port, then run `body`. */
const runChild = (body: string, folder: string) => {
	const script = `
		import { createWhatsAppClient, initWasmEngine } from '@oxidezap/whatsapp-rust-bridge'
		import { makeNativeCryptoProvider } from ${JSON.stringify(join(SRC, '../Utils/native-crypto-provider.ts'))}
		import { useMultiFileAuthState } from ${JSON.stringify(join(SRC, '../Utils/use-multi-file-auth-state.ts'))}
		import { makeHttpClient, makeTransport } from ${JSON.stringify(join(SRC, '../Socket/transport.ts'))}
		import { DEFAULT_CONNECTION_CONFIG } from ${JSON.stringify(join(SRC, '../Defaults/index.ts'))}
		import P from 'pino'

		const logger = P({ level: 'silent' })
		initWasmEngine(logger, makeNativeCryptoProvider())
		const { state } = await useMultiFileAuthState(${JSON.stringify(folder)})
		const cfg = { ...DEFAULT_CONNECTION_CONFIG, logger, waWebSocketUrl: 'ws://127.0.0.1:1' }
		const c = await createWhatsAppClient(
			makeTransport(cfg), makeHttpClient(cfg), undefined, state.store, null, undefined, null
		)
		// Printed once the client exists and just before the risky call, so the
		// parent can tell "crashed at free()" from "never got there" — a bad
		// import, an auth-store failure or a hung child would otherwise look
		// exactly like the crash this suite documents.
		console.log('READY')
		${body}
		await new Promise(r => setTimeout(r, 1500))
		process.exit(0)
	`
	return new Promise<ChildOutcome>(resolve => {
		const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
			stdio: ['ignore', 'pipe', 'pipe']
		})
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', chunk => (stdout += String(chunk)))
		child.stderr.on('data', chunk => (stderr += String(chunk)))

		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			resolve({ code: null, timedOut: true, reachedTarget: stdout.includes('READY'), stderr })
		}, 25_000)
		// `close`, not `exit`: `exit` fires when the process ends, before the
		// parent has necessarily drained its pipes. The panic text asserted
		// below is the last thing a crashing child writes, so it is exactly the
		// chunk most likely to still be in flight.
		child.on('close', code => {
			clearTimeout(timer)
			resolve({ code, timedOut: false, reachedTarget: stdout.includes('READY'), stderr })
		})
	})
}

describe('bridge: free() safety with a call in flight', { timeout: 90_000 }, () => {
	let folder: string

	before(async () => {
		folder = await mkdtemp(join(tmpdir(), 'baileyrs-freesafety-'))
	})

	after(async () => {
		await rm(folder, { recursive: true, force: true })
	})

	it('free() with a pending call corrupts the heap and kills the process', async () => {
		// Documents the hazard rather than endorsing it. If a future bridge
		// makes `free()` safe on its own, this test starts failing — which is
		// the signal to drop the `disconnect()` from `end()`, not to relax the
		// assertion.
		const outcome = await runChild(
			`
			c.fetchBlocklist().catch(() => {})
			c.free()
			`,
			folder
		)

		// It got to `free()`…
		expect(outcome.reachedTarget).toBe(true)
		// …died rather than hanging…
		expect(outcome.timedOut).toBe(false)
		expect(outcome.code === 0).toBe(false)
		// …and died the documented way. Any other crash means the hazard moved
		// and this suite is no longer describing it.
		expect(outcome.stderr).toContain('psize <= size + max_overhead')
	})

	it('await disconnect() before free() survives the same pending call', async () => {
		// The shape `end()` uses.
		const outcome = await runChild(
			`
			c.fetchBlocklist().catch(() => {})
			await c.disconnect()
			c.free()
			`,
			folder
		)
		expect(outcome.reachedTarget).toBe(true)
		expect(outcome.code).toBe(0)
	})

	it('await disconnect() before free() survives an in-flight logout()', async () => {
		// The production path: `Client::logout()` dispatches `LoggedOut` before
		// awaiting its own `disconnect()`, so the terminal-close handler can
		// re-enter `end()` while `logout()` is still running.
		const outcome = await runChild(
			`
			c.logout().catch(() => {})
			await c.disconnect()
			c.free()
			`,
			folder
		)
		expect(outcome.reachedTarget).toBe(true)
		expect(outcome.code).toBe(0)
	})
})
