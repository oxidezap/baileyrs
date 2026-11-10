import type { USyncQueryProtocol } from '../../Types/USync.ts'
import type { BinaryNode } from '../../Types/index.ts'
import { assertNodeErrorFree } from '../../WABinary/generic-utils.ts'

export type StatusData = { status?: string | null; setAt?: Date }

export class USyncStatusProtocol implements USyncQueryProtocol {
	name = 'status'
	getQueryElement(): BinaryNode {
		return { tag: 'status', attrs: {} }
	}
	getUserElement(): null {
		return null
	}
	parser(node: BinaryNode): StatusData | undefined {
		if (node.tag !== 'status') return
		assertNodeErrorFree(node)
		let status: string | null = node.content?.toString() ?? null
		const setAt = new Date(+(node.attrs.t || 0) * 1000)
		if (!status) status = node.attrs.code && +node.attrs.code === 401 ? '' : null
		else if (status.length === 0) status = null
		return { status, setAt }
	}
}
