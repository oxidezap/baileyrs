import type { USyncQueryProtocol } from '../../Types/USync.ts'
import type { BinaryNode } from '../../Types/index.ts'
import { assertNodeErrorFree } from '../../WABinary/generic-utils.ts'

export type DisappearingModeData = { duration: number; setAt?: Date }

export class USyncDisappearingModeProtocol implements USyncQueryProtocol {
	name = 'disappearing_mode'
	getQueryElement(): BinaryNode {
		return { tag: 'disappearing_mode', attrs: {} }
	}
	getUserElement(): null {
		return null
	}
	parser(node: BinaryNode): DisappearingModeData | undefined {
		if (node.tag === 'disappearing_mode') {
			assertNodeErrorFree(node)
			return { duration: +node.attrs.duration!, setAt: new Date(+(node.attrs.t || 0) * 1000) }
		}
	}
}
