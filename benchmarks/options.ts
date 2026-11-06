// CodSpeed performs its own JIT optimization in simulation/memory mode.
// Fixed warmup also runs with the native Vitest walltime runner.
export const options = { warmupIterations: 32, warmupTime: 100, iterations: 32, time: 500 }
export const integrationOptions = { warmupIterations: 2, warmupTime: 0, iterations: 3, time: 0 }

/**
 * True when CodSpeed runs the memory instrument.
 *
 * That instrument sees native (malloc/mmap) allocations only, not objects on
 * the V8 heap. Rows that only create JS objects (protobuf decode, adapters,
 * envelopes) report a fixed ~0.6-4 KB of V8 runtime bookkeeping instead: the
 * 64 B and 4 KiB decode rows report the same bytes, and one 128-656 B
 * allocation comes and goes between runs of identical code, which CodSpeed
 * flags as a 10-100% change. Those rows use `test.skipIf(memoryMode)` and keep
 * their simulation row. See benchmarks/README.md.
 */
export const memoryMode = process.env.CODSPEED_RUNNER_MODE === 'memory'

/**
 * Operations per measured call for rows whose single operation is sub-millisecond.
 *
 * CodSpeed simulation measures one call. When that call is a single protobuf
 * decode or store write, one scavenge, page commit or cold cache line inside
 * it can move the result by 40-150% on unchanged code. Repeating the operation
 * amortizes those one-off costs, so the row tracks the steady-state cost of
 * the operation instead of where the last GC happened to land.
 */
export const opsPerSample = 100

/** Run `operation` {@link opsPerSample} times. */
export function repeat(operation: () => void, count = opsPerSample): void {
	for (let i = 0; i < count; i++) operation()
}

/** Run `operation` {@link opsPerSample} times, one after another. */
export async function repeatAsync(operation: () => Promise<void>, count = opsPerSample): Promise<void> {
	for (let i = 0; i < count; i++) await operation()
}
