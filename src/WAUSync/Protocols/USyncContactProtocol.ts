import type { USyncQueryProtocol } from '../../Types/USync.ts'
import type { BinaryNode } from '../../Types/index.ts'
import { assertNodeErrorFree } from '../../WABinary/generic-utils.ts'
import type { USyncUser } from '../USyncUser.ts'

export class USyncContactProtocol implements USyncQueryProtocol {
	name = 'contact'

	getQueryElement(): BinaryNode {
		return { tag: 'contact', attrs: {} }
	}

	getUserElement(user: USyncUser): BinaryNode {
		if (user.phone) return { tag: 'contact', attrs: {}, content: user.phone }
		if (user.username) {
			return {
				tag: 'contact',
				attrs: {
					username: user.username,
					...(user.usernameKey ? { pin: user.usernameKey } : {}),
					...(user.lid ? { lid: user.lid } : {})
				}
			}
		}
		if (user.type) return { tag: 'contact', attrs: { type: user.type } }
		return { tag: 'contact', attrs: {} }
	}

	parser(node: BinaryNode): boolean {
		if (node.tag !== 'contact') return false
		assertNodeErrorFree(node)
		return node.attrs.type === 'in'
	}
}
