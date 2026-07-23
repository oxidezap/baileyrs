import type { BinaryNode } from './BinaryNode.ts'
import type { USyncUser } from '../WAUSync/USyncUser.ts'

export interface USyncQueryProtocol {
	name: string
	getQueryElement: () => BinaryNode
	getUserElement: (user: USyncUser) => BinaryNode | null
	parser: (data: BinaryNode) => unknown
}
