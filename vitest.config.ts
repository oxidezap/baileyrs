import codspeedPlugin from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [codspeedPlugin()],
	test: {
		pool: 'forks',
		setupFiles: ['bench/setup.ts'],
		execArgv: ['--expose-gc'],
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
