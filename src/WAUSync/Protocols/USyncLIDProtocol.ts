import type { USyncQueryProtocol } from '../../Types/USync.ts'
import type { BinaryNode } from '../../Types/index.ts'
import type { USyncUser } from '../USyncUser.ts'

export class USyncLIDProtocol implements USyncQueryProtocol {
	name = 'lid'
	getQueryElement(): BinaryNode {
		return { tag: 'lid', attrs: {} }
	}
	getUserElement(user: USyncUser): BinaryNode | null {
		return user.lid ? { tag: 'lid', attrs: { jid: user.lid } } : null
	}
	parser(node: BinaryNode): string | null {
		return node.tag === 'lid' ? node.attrs.val! : null
	}
}
