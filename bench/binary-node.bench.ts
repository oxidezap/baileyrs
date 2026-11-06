import { memoryMode, options as benchmarkOptions, opsPerSample, repeat } from '../benchmarks/options.ts'
import { test, describe } from 'vitest'
import {
	binaryNodeToString,
	getBinaryNodeChild,
	getBinaryNodeChildren,
	reduceBinaryNodeToDictionary
} from '../src/WABinary/index.ts'
import { makeGroupNode } from './fixtures.ts'

const node = makeGroupNode(512)
const group = getBinaryNodeChild(node, 'group')!
const props = getBinaryNodeChild(node, 'props')!

describe('binary node helpers (512 participants)', () => {
	test(`getBinaryNodeChildren x${opsPerSample}`, async ({ bench }) => {
		await bench(`getBinaryNodeChildren x${opsPerSample}`, () => {
			repeat(() => {
				getBinaryNodeChildren(group, 'participant')
			})
		}).run(benchmarkOptions)
	})

	test.skipIf(memoryMode)(`reduceBinaryNodeToDictionary x${opsPerSample}`, async ({ bench }) => {
		await bench(`reduceBinaryNodeToDictionary x${opsPerSample}`, () => {
			repeat(() => {
				reduceBinaryNodeToDictionary(props, 'prop')
			})
		}).run(benchmarkOptions)
	})

	test('binaryNodeToString', async ({ bench }) => {
		await bench('binaryNodeToString', () => {
			binaryNodeToString(node)
		}).run(benchmarkOptions)
	})
})
