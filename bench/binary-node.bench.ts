import { options as benchmarkOptions } from '../benchmarks/options.ts'
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
	test('getBinaryNodeChildren', async ({ bench }) => {
		await bench('getBinaryNodeChildren', () => {
			getBinaryNodeChildren(group, 'participant')
		}).run(benchmarkOptions)
	})

	test('reduceBinaryNodeToDictionary', async ({ bench }) => {
		await bench('reduceBinaryNodeToDictionary', () => {
			reduceBinaryNodeToDictionary(props, 'prop')
		}).run(benchmarkOptions)
	})

	test('binaryNodeToString', async ({ bench }) => {
		await bench('binaryNodeToString', () => {
			binaryNodeToString(node)
		}).run(benchmarkOptions)
	})
})
