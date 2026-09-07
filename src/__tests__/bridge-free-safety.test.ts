/**
 * Pins the bridge invariant that `sock.end()` depends on.
 *
 * Since bridge 0.21.1, calling `WasmWhatsAppClient.free()` with ordinary
 * calls still in flight is safe: its `Drop` signals shutdown, aborts the
 * background tasks and closes the transport. Before that, any pending call
 * corrupted the wasm heap and the process died from inside wasm (dlmalloc
 * assertion, out-of-bounds access, js-sys future panic depending on the
 * build).
 *
 * One shape still kills the process: freeing mid-`disconnect()`, which
 * aborts inside `async-lock` (`Panicking while panicking to abort`). That is
 * why `end()` still drains with `disconnect()` before freeing
 * (`src/Socket/index.ts`) — reachable via `void sock.ws.close(); await
 * sock.end()`, whose skipped disconnect keeps running underneath.
 *
 * Each case runs in a child process because a heap-corruption regression
 * would take the whole process with it — and a hang would take the watchdog.
 * Driving the bridge directly (rather than through `makeWASocket`) is the
 * only way to hold a pending call open deterministically: offline, every
 * socket method rejects immediately, so the window never opens.
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

	it('free() with an ordinary call pending survives instead of corrupting the heap', async () => {
		// The shapes that used to kill the process and now must exit cleanly
		// with no wasm fault on stderr. If a future bridge regresses one of
		// these, the fix belongs in the bridge — not in a looser assertion.
		const bodies = ['c.fetchBlocklist().catch(() => {})', 'c.logout().catch(() => {})']
		const WASM_MEMORY_FAULTS = [
			'psize <= size + max_overhead',
			'memory access out of bounds',
			'finish: result should be None',
			'wasm://wasm/'
		]
		for (const body of bodies) {
			const outcome = await runChild(
				`
				${body}
				c.free()
				`,
				folder
			)

			// It got to `free()`…
			expect(outcome.reachedTarget).toBe(true)
			// …exited on its own rather than hanging…
			expect(outcome.timedOut).toBe(false)
			expect(outcome.code).toBe(0)
			// …with no wasm fault on the way out.
			for (const fault of WASM_MEMORY_FAULTS) {
				expect(outcome.stderr.includes(fault)).toBe(false)
			}
		}
	})

	it('free() mid-disconnect still kills the process, so end() keeps draining', async () => {
		// The one shape `free()` never became safe for: the disconnect future
		// parks inside `async-lock`, and freeing under it aborts the process
		// (`Panicking while panicking to abort`). This pins why `release`
		// awaits `disconnect()` before freeing — drop that drain and `void
		// sock.ws.close(); await sock.end()` can land here.
		const outcome = await runChild(
			`
			c.disconnect().catch(() => {})
			c.free()
			`,
			folder
		)

		expect(outcome.reachedTarget).toBe(true)
		expect(outcome.timedOut).toBe(false)
		expect(outcome.code === 0).toBe(false)
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
