import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startResults } from './results.mjs'

const root = resolve(import.meta.dirname, '../..')
process.chdir(root)
const compiler = process.env.SCRIPTC ?? 'scriptc'
const results = startResults(resolve(process.env.SCRIPTC_RESULTS ?? '.scriptc/results'))
const out = results.directory
console.log(`results: ${out}`)
const summary = []
function command(name, file, args) {
	const run = spawnSync(file, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
	writeFileSync(resolve(out, `${name}.stdout`), run.stdout ?? '')
	writeFileSync(resolve(out, `${name}.stderr`), run.stderr ?? '')
	assert.ifError(run.error)
	assert.equal(run.signal, null, `${name} terminated by ${run.signal}`)
	summary.push({ name, exit: run.status })
	writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2))
	console.log(`${name}: exit ${run.status}`)
	return run
}
function coverage(name, entry, extra = []) {
	const run = command(name, compiler, ['coverage', entry, '--print', 'diagnostics', ...extra])
	const report = JSON.parse(run.stdout)
	assert.equal(report.compilerVersion, '0.4.0')
	return report
}
function native(name, entry, extra = []) {
	// Official external-link recipe. GCC fallback is local Linux x64 only; CI uses clang.
	const object = command(`${name}-object`, compiler, [
		'build',
		entry,
		'--print',
		'native-link-info',
		'-o',
		resolve(out, `${name}.o`),
		...extra
	])
	assert.equal(object.status, 0, object.stderr.slice(-3000))
	const recipe = JSON.parse(object.stdout)
	assert.equal(recipe.compiler_version, '0.4.0')
	assert.equal(recipe.target.name, 'linux-x64-gnu')
	const gcc = process.env.SCRIPTC_POC_GCC === '1'
	const flags = [...recipe.link.driver_flags]
	if (gcc) {
		assert.equal(flags[0], '-target')
		assert.equal(flags[1], 'x86_64-unknown-linux-gnu')
		flags.splice(0, 2)
	}
	const binary = resolve(out, name)
	const linked = command(`${name}-link`, gcc ? 'gcc' : 'clang', [
		...flags,
		...recipe.link.input_order,
		...recipe.link.system_libraries.map(lib => `-l${lib}`),
		'-o',
		binary
	])
	assert.equal(linked.status, 0, linked.stderr.slice(-3000))
	return command(`${name}-run`, binary, [])
}
function runExperiment() {
	assert.equal(command('compiler-version', compiler, ['--version']).stdout.trim(), '0.4.0')
	assert.equal(
		command('node-offline', process.execPath, [
			'--test',
			'experiments/scriptc/offline-check.mjs',
			'experiments/scriptc/harness-check.mjs'
		]).status,
		0
	)
	const scalar = native('scalar', 'experiments/scriptc/fixtures/scalar-wasm.ts')
	assert.equal(scalar.status, 0, scalar.stderr)
	assert.match(scalar.stdout, /SCALAR_WASM_OK/)
	const wasm = coverage('wasm-coverage', 'experiments/scriptc/fixtures/wasm.ts')
	assert.equal(wasm.wasmModules.length, 1)
	assert.equal(wasm.wasmModules[0].sha256, '7f563e4853e056a3063d3d82d7e3ee94004efa6ad267185040eca32fef1897b4')
	assert.deepEqual(wasm.wasmModules[0].unsupported, ['simd'])
	const wasmRun = native('wasm', 'experiments/scriptc/fixtures/wasm.ts')
	assert.notEqual(wasmRun.status, 0)
	assert.match(wasmRun.stdout, /bridge WASM validates: false/)
	assert.match(wasmRun.stderr, /CompileError: WebAssembly.Module\(\): this module was not translated/)
	const simdCoverage = coverage('minimal-simd-coverage', 'experiments/scriptc/fixtures/simd-wasm.ts')
	assert.equal(simdCoverage.wasmModules[0].size, 29)
	assert.deepEqual(simdCoverage.wasmModules[0].unsupported, ['simd'])
	const simd = native('minimal-simd', 'experiments/scriptc/fixtures/simd-wasm.ts')
	assert.notEqual(simd.status, 0)
	assert.equal(simd.stdout.trim(), 'false')
	assert.match(simd.stderr, /CompileError.*module was not translated/)
	const bridgeArgs = ['--npm-static=@oxidezap/whatsapp-rust-bridge...']
	const bridge = native('bridge', 'experiments/scriptc/fixtures/bridge.ts', bridgeArgs)
	assert.notEqual(bridge.status, 0)
	assert.match(bridge.stderr, /new FinalizationRegistry.*SC2020/)
	const finalization = command('finalization-build', compiler, [
		'build',
		'experiments/scriptc/fixtures/finalization.ts',
		'--print',
		'diagnostics'
	])
	assert.notEqual(finalization.status, 0)
	assert.match(finalization.stdout, /FinalizationRegistry/)
	assert.match(finalization.stdout, /SC2020/)
	const cleanup = command('cleanup-build', compiler, [
		'build',
		'experiments/scriptc/fixtures/rm.ts',
		'--print',
		'diagnostics'
	])
	assert.notEqual(cleanup.status, 0)
	assert.match(cleanup.stdout, /rm with 2 arguments/)
	const defaultBuild = command('example-default-build', compiler, [
		'build',
		'Example/example.ts',
		'--print',
		'diagnostics',
		'-o',
		resolve(out, 'example-default')
	])
	assert.notEqual(defaultBuild.status, 0)
	assert.match(defaultBuild.stdout, /SC2013/)
	const report = coverage('example-coverage', 'Example/example.ts', bridgeArgs)
	assert.equal(report.success, false)
	assert.ok(report.groups.some(group => group.scope === 'reached' && group.message.includes('rm with 2 arguments')))
	assert.ok(report.wasmModules.some(module => module.unsupported.includes('simd')))
	const full = command('example-build', compiler, [
		'build',
		'Example/example.ts',
		...bridgeArgs,
		'--print',
		'diagnostics',
		'-o',
		resolve(out, 'example')
	])
	assert.notEqual(full.status, 0)
	const diagnostics = JSON.parse(full.stdout)
	assert.equal(diagnostics.success, false)
	// Fail on unknown compiler regressions rather than accepting every failed build.
	const allowed = new Set(['SC1012', 'SC1090', 'SC1031', 'SC2004', 'SC2020'])
	for (const diagnostic of diagnostics.diagnostics)
		assert.ok(allowed.has(diagnostic.code), `unexpected diagnostic: ${diagnostic.code}`)
	writeFileSync(
		resolve(out, 'verdict.txt'),
		'BLOCKED: full example does not compile. Bridge native initialization and SIMD WASM loading fail independently. Node offline integration and scalar WASM control passed.\n'
	)
	console.log(readFileSync(resolve(out, 'verdict.txt'), 'utf8'))
}
try {
	runExperiment()
	results.finish('completed')
} catch (error) {
	results.finish('failed', error)
	throw error
}
