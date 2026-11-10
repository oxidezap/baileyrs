// Background WebAssembly tier-up adds compiler memory and CPU to whichever call
// it lands in. vitest.config.ts disables it; fail instead of measuring with it.
if (!process.execArgv.includes('--no-liftoff')) {
	throw new Error('Run benchmarks through vitest.config.ts so the worker gets --no-liftoff')
}

// Initialize the Node runtime and shared bridge WASM before fixtures or measurement.
await import('../src/index.ts')
