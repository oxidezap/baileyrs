import codspeedPlugin from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [codspeedPlugin()],
	test: {
		pool: 'forks',
		setupFiles: ['bench/setup.ts'],
		// `--no-liftoff` compiles each WebAssembly function once, with the
		// optimizing compiler, on its first call. With the default tiering, V8
		// recompiles hot bridge functions later on a background thread, using
		// 0.1-1.3 MB of compiler memory each time. When that landed inside a
		// measured call it was counted in the result, so memory rows swung by
		// several hundred KB on unchanged code. See benchmarks/README.md.
		execArgv: ['--expose-gc', '--no-liftoff', '--wasm-wrapper-tiering-budget=1'],
		maxWorkers: 1,
		fileParallelism: false,
		hookTimeout: 120_000,
		testTimeout: process.env.BENCH_SUITE === 'e2e' ? 1_200_000 : 120_000,
		benchmark: {
			include:
				process.env.BENCH_SUITE === 'e2e'
					? ['benchmarks/e2e/**/*.bench.ts']
					: ['bench/**/*.bench.ts', 'benchmarks/local/**/*.bench.ts']
		}
	}
})
