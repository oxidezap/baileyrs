/**
 * Load an instrumented copy of the bridge bundle that counts JS handles.
 *
 * wasm-bindgen keeps every JS value the Rust side holds in a table. A handle
 * that is never released keeps its object alive for the life of the process:
 * allocation profiles cannot see it (the object is live, not garbage) and it
 * only shows up as RSS that climbs with the number of processed events. That
 * is exactly how the cancelled-sleep leak got in, so the guard has to count
 * handles rather than bytes.
 *
 * A handle leaves the table in one of two ways: the Rust side drops it
 * (the glue's unref hook) or the GC finalizes the JS object holding it. Both
 * are counted, so a value that the host simply dropped is not reported as a
 * leak.
 *
 * The copy lives in a temp directory next to its own `.wasm`, so the original
 * package is never modified.
 */

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface HandleProbe {
	/** Handles created since load. */
	made: number
	/** Handles released, whether by an explicit drop or by finalization. */
	freed: number
	/** Subset of `freed` reclaimed by the GC. */
	finalized: number
	/** Currently outstanding handles. */
	readonly live: number
	/** Creation stacks of the handles still outstanding. Only populated with
	 * `HANDLE_PROBE_TRACE=1`, since tracing retains a stack per live handle. */
	liveStacks(limit?: number): string[]
}

export interface InstrumentedBridge {
	/** The bridge module, loaded from the instrumented copy. */
	bridge: Record<string, unknown>
	probe: HandleProbe
	/** Force GC (requires --expose-gc) and let finalizers run. */
	settle(passes?: number): Promise<void>
	cleanup(): void
}

const GC_SETTLE_MS = 60

/**
 * Instrument the two places the glue tracks closure handles: creation, and the
 * two release paths. Throws when the shapes are missing so a wasm-bindgen
 * upgrade fails loudly here instead of silently reporting zero leaks.
 */
function instrument(source: string): string {
	const created = source.match(/function (\w+)\(\w+,\w+,\w+\)\{let (\w+)=\{a:\w+,b:\w+,cnt:1\}/)
	if (!created) throw new Error('handle probe: closure helper not found in the bridge bundle')
	let out = source.replace(created[0], created[0].replace('{let ', '{globalThis.__handleProbe.made++;let '))

	// The record is only in scope after the helper's declarations, so tracing
	// hooks in at the unref assignment that follows them. That assignment sits
	// inside a `return` sequence, so the hook has to be an expression: keying
	// live handles by the record lets survivors be reported with their stack.
	const unref = out.match(/(\w+)\._wbg_cb_unref=\(\)=>\{if\(--(\w+)\.cnt===0\)/)
	if (!unref) throw new Error('handle probe: unref hook not found in the bridge bundle')
	out = out.replace(
		unref[0],
		`(globalThis.__handleProbe.trace&&globalThis.__handleProbe.alive.set(${unref[2]},new Error().stack)),` +
			`${unref[0]}globalThis.__handleProbe.freed++,globalThis.__handleProbe.alive.delete(${unref[2]}),`
	)

	const finalizer = out.match(/new FinalizationRegistry\(\((\w+)\)=>(\w+)\.__wbindgen_export5\(\1\.a,\1\.b\)\)/)
	if (!finalizer) throw new Error('handle probe: closure FinalizationRegistry not found in the bridge bundle')
	out = out.replace(
		finalizer[0],
		`new FinalizationRegistry((${finalizer[1]})=>(globalThis.__handleProbe.freed++,` +
			`globalThis.__handleProbe.finalized++,` +
			`globalThis.__handleProbe.alive.delete(${finalizer[1]}),` +
			`${finalizer[2]}.__wbindgen_export5(${finalizer[1]}.a,${finalizer[1]}.b)))`
	)

	return (
		`globalThis.__handleProbe={made:0,freed:0,finalized:0,alive:new Map(),` +
		`trace:process.env.HANDLE_PROBE_TRACE==="1"};${out}`
	)
}

export async function loadInstrumentedBridge(): Promise<InstrumentedBridge> {
	// The bridge is ESM-only, so resolution goes through `import.meta.resolve`
	// rather than `createRequire`, which cannot see an import-only `exports` map.
	const entry = fileURLToPath(await import.meta.resolve('@oxidezap/whatsapp-rust-bridge'))
	const dist = dirname(entry)
	const dir = mkdtempSync(join(tmpdir(), 'baileyrs-handle-probe-'))

	copyFileSync(join(dist, 'whatsapp_rust_bridge_bg.wasm'), join(dir, 'whatsapp_rust_bridge_bg.wasm'))
	const copy = join(dir, 'index.js')
	writeFileSync(copy, instrument(readFileSync(entry, 'utf8')))

	const bridge = (await import(pathToFileURL(copy).href)) as Record<string, unknown>
	const state = globalThis.__handleProbe as {
		made: number
		freed: number
		finalized: number
		alive: Map<unknown, string>
	}
	const probe: HandleProbe = {
		get made() {
			return state.made
		},
		get freed() {
			return state.freed
		},
		get finalized() {
			return state.finalized
		},
		get live() {
			return state.made - state.freed
		},
		liveStacks(limit = 5) {
			return [...state.alive.values()].slice(0, limit)
		}
	} as HandleProbe

	return {
		bridge,
		probe,
		async settle(passes = 4) {
			for (let pass = 0; pass < passes; pass++) {
				globalThis.gc?.()
				await new Promise(resolve => setTimeout(resolve, GC_SETTLE_MS))
			}
		},
		cleanup() {
			rmSync(dir, { recursive: true, force: true })
		}
	}
}

declare global {
	// eslint-disable-next-line no-var
	var __handleProbe: {
		made: number
		freed: number
		finalized: number
		alive: Map<unknown, string>
		trace: boolean
	}
}
