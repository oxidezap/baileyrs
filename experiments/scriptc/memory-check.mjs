import assert from 'node:assert/strict'
import { test } from 'node:test'
import { v8MemoryLines } from '../../Example/memory-v8.ts'

test('portable memory diagnostics state V8 unavailability without loading it or inventing figures', () => {
	let loads = 0
	const lines = v8MemoryLines(undefined, () => {
		loads++
		throw new Error('must not load')
	})
	assert.equal(loads, 0)
	assert.match(lines.join('\n'), /Unavailable.*does not expose V8/)
	assert.doesNotMatch(lines.join('\n'), /Native contexts|Malloced|Global handles/)
})
test('Node keeps its real V8 heap diagnostics', () => {
	const lines = v8MemoryLines(process.versions.v8, process.getBuiltinModule)
	assert.match(lines.join('\n'), /V8 Heap Spaces/)
	assert.match(lines.join('\n'), /Native contexts:/)
	assert.doesNotMatch(lines.join('\n'), /Unavailable/)
})
test('an incomplete V8 provider is an explicit error, not zero statistics', () => {
	assert.throws(() => v8MemoryLines('test', () => ({})), /required methods are missing/)
	assert.throws(
		() => v8MemoryLines('test', () => ({ getHeapStatistics: () => ({}), getHeapSpaceStatistics: () => [] })),
		/invalid V8 memory field/
	)
})
