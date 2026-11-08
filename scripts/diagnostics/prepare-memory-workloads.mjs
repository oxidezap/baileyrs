import { readFileSync, writeFileSync } from 'node:fs'
const original = readFileSync('benchmarks/e2e/lifecycle.bench.ts', 'utf8')
for (const name of [
	'npm-plain-before',
	'npm-observed',
	'rebuilt-observed',
	'profiled-observed',
	'profiled-plain',
	'rebuilt-plain',
	'npm-plain-after'
]) {
	let source = ('import "../../scripts/diagnostics/memory-lifetimes.mjs"\n' + original).replace(
		"'bartender/lifecycle'",
		`'diagnostic/lifetimes/${name}'`
	)
	source = source.replace(
		'await settle()',
		'await settle()\n\t\t\t\t\t\t;(globalThis as any).__memoryLifetimes?.begin()'
	)
	source = source.replace(
		'afterEach: cleanup',
		'afterEach: async () => { (globalThis as any).__memoryLifetimes?.end(); await cleanup(); (globalThis as any).__memoryLifetimes?.cleaned() }'
	)
	writeFileSync(`benchmarks/e2e/diagnostic-${name}.bench.ts`, source)
}
