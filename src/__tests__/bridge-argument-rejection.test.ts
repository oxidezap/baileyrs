/**
 * A bad argument has to come back as a rejection.
 *
 * Bridge 0.6.5 deserialized typed parameters inside the async shim, so a value
 * of the wrong shape threw from a place no `await` could catch: the promise
 * stayed pending for good and the throw surfaced as an uncaught exception,
 * which in Node ends the process. 0.7.0 deserializes them explicitly and
 * rejects with `invalid-argument` naming the parameter, and it does the same
 * for a stream parameter that cannot do what a stream does.
 *
 * What this pins is the bridge boundary itself, driven directly. How much of
 * the socket surface each probe stands for varies, so to be exact about it:
 *
 *  - `muteChat` is a bare pass-through on the socket, so that probe is the
 *    public path, argument and all.
 *  - `encryptMediaStream` reaches consumers raw, handed over by
 *    `MediaGenerationOptions.processMedia`.
 *  - `readMessages` is filtered by `receiptMessageKeys` first, which drops
 *    anything without a `remoteJid` and an `id`, so through the socket this
 *    value resolves to a no-op instead of reaching the bridge.
 *  - `sendPresence` sits behind `sendPresenceUpdate`, which turns an off-union
 *    status into a missing-target-jid Boom before the bridge sees it.
 *
 * The last two are still worth probing here: the boundary is one contract, and
 * a normalizer that happens to absorb one bad value today is not a reason to
 * leave the boundary under it untested.
 *
 * The probes run in a child process because the old failure mode is fatal: only
 * a separate process can tell "the call rejected" from "the call took the test
 * runner down with it", which is the whole distinction under test.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { expect } from './expect.ts'

const SRC = import.meta.dirname

interface ProbeOutcome {
	label: string
	/** `pending` means the call never settled, the 0.6.5 failure. */
	settled: 'rejected' | 'resolved' | 'pending'
	kind?: string
	field?: string
}

interface ProbeSpec {
	label: string
	/** Body of the call, evaluated in the child against the client `c`. */
	call: string
	field: string
	why: string
}

const PROBES: ProbeSpec[] = [
	{
		label: 'readMessages with a string where the key list goes',
		call: `c.readMessages('not-an-array')`,
		field: 'keys',
		why: 'a typed list parameter'
	},
	{
		label: 'sendPresence with a status outside the union',
		call: `c.sendPresence('nope')`,
		field: 'status',
		why: 'a typed enum parameter'
	},
	{
		label: 'muteChat with a non-finite timestamp',
		call: `c.muteChat('123@s.whatsapp.net', Infinity)`,
		field: 'muteUntil',
		// `as i64` saturates, so Infinity used to arrive as i64::MAX and pass
		// every check downstream of the cast.
		why: 'a millisecond instant the core takes as i64'
	},
	{
		label: 'encryptMediaStream with plain objects for the streams',
		call: `c.encryptMediaStream({}, {}, 'image')`,
		field: 'input',
		why: 'an imported class parameter wasm-bindgen casts unchecked'
	}
]

/** Build a client against a dead loopback port and run every probe in it. */
const runProbes = (folder: string) => {
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

		// Awaits the write callback rather than using console.log: stdout is a
		// pipe here, so process.exit() below would drop whatever is still
		// buffered and the parent would read a truncated run as a regression.
		const report = outcome =>
			new Promise(done => process.stdout.write('PROBE ' + JSON.stringify(outcome) + '\\n', done))
		const probe = async (label, run) => {
			// A call that never settles is the failure being tested for, so it
			// has to be reported rather than waited on.
			let timer
			const pending = new Promise(resolve => {
				timer = setTimeout(() => resolve({ label, settled: 'pending' }), 8000)
			})
			const outcome = await Promise.race([
				run().then(
					() => ({ label, settled: 'resolved' }),
					e => ({ label, settled: 'rejected', kind: e?.kind, field: e?.field })
				),
				pending
			])
			clearTimeout(timer)
			await report(outcome)
			// The call is still in flight, so continuing would reach free()
			// with a pending call: the heap corruption bridge-free-safety
			// documents, whose crash would then be reported instead of this.
			if (outcome.settled === 'pending') process.exit(9)
		}

		${PROBES.map(({ label, call }) => `await probe(${JSON.stringify(label)}, () => ${call})`).join('\n\t\t')}

		await c.disconnect()
		c.free()
		process.exit(0)
	`
	return new Promise<{ code: number | null; outcomes: ProbeOutcome[]; stderr: string }>(resolve => {
		const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
			stdio: ['ignore', 'pipe', 'pipe']
		})
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', chunk => (stdout += String(chunk)))
		child.stderr.on('data', chunk => (stderr += String(chunk)))

		const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
		// Unlistened, a failed spawn throws in the test runner and leaves this
		// promise pending until the suite times out.
		child.on('error', error => {
			clearTimeout(timer)
			resolve({ code: null, outcomes: [], stderr: `${stderr}\nspawn failed: ${String(error)}` })
		})
		// `close`, not `exit`: the parent has to have drained the pipes before
		// the reports can be parsed.
		child.on('close', code => {
			clearTimeout(timer)
			const outcomes = stdout
				.split('\n')
				.filter(line => line.startsWith('PROBE '))
				.map(line => JSON.parse(line.slice('PROBE '.length)) as ProbeOutcome)
			resolve({ code, outcomes, stderr })
		})
	})
}

describe('bridge: a bad argument rejects instead of escaping the caller', { timeout: 120_000 }, () => {
	let folder: string
	let run: Awaited<ReturnType<typeof runProbes>>

	before(async () => {
		folder = await mkdtemp(join(tmpdir(), 'baileyrs-argreject-'))
		run = await runProbes(folder)
	})

	after(async () => {
		await rm(folder, { recursive: true, force: true })
	})

	it('every probe settles, and the process survives all of them', () => {
		// On 0.6.5 the first probe alone ended the child, so nothing after it
		// was ever reported. The child's stderr is the only account of why.
		assert.deepStrictEqual(
			run.outcomes.map(outcome => outcome.label),
			PROBES.map(probe => probe.label),
			`child exited with ${run.code}; stderr:\n${run.stderr}`
		)
		expect(run.code).toBe(0)
	})

	for (const [index, { label, field, why }] of PROBES.entries()) {
		it(`${label} (${why}) rejects naming '${field}'`, () => {
			const outcome = run.outcomes[index]

			expect(outcome?.settled).toBe('rejected')
			// Naming the parameter is the point: `internal` would leave a
			// consumer unable to tell its own bad argument from a bridge fault.
			expect(outcome?.kind).toBe('invalid-argument')
			expect(outcome?.field).toBe(field)
		})
	}
})
