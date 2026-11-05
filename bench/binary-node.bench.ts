import { bench, describe } from 'vitest'
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
	bench('getBinaryNodeChildren', () => {
		getBinaryNodeChildren(group, 'participant')
	})

	bench('reduceBinaryNodeToDictionary', () => {
		reduceBinaryNodeToDictionary(props, 'prop')
	})

	bench('binaryNodeToString', () => {
		binaryNodeToString(node)
	})
})
