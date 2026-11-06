// CodSpeed performs its own JIT optimization in simulation/memory mode.
// Fixed warmup also runs with the native Vitest walltime runner.
export const options = { warmupIterations: 32, warmupTime: 100, iterations: 32, time: 500 }
export const integrationOptions = { warmupIterations: 2, warmupTime: 0, iterations: 3, time: 0 }
