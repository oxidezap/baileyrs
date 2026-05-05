/**
 * Helpers for inspecting raw `BinaryNode` stanza trees, ported 1:1
 * from upstream Baileys' `WABinary/generic-utils.ts`. baileyrs has the
 * same `BinaryNode` shape (`{ tag, attrs, content }`), so the
 * implementations are byte-identical.
 */

import type { BinaryNode } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'

export const getBinaryNodeChildren = (node: BinaryNode | undefined, childTag: string): BinaryNode[] => {
	if (Array.isArray(node?.content)) {
		return node.content.filter(item => (item as BinaryNode).tag === childTag) as BinaryNode[]
	}
	return []
}

export const getBinaryNodeChild = (node: BinaryNode | undefined, childTag: string): BinaryNode | undefined => {
	if (Array.isArray(node?.content)) {
		return node.content.find(item => (item as BinaryNode).tag === childTag) as BinaryNode | undefined
	}
	return undefined
}

/**
 * Throws a `Boom` when the response stanza carries an `<error>` child.
 * Mirrors upstream `assertNodeErrorFree` — used in IQ response paths
 * where the server signals failure via a sibling `<error>` instead of
 * a top-level rejection.
 */
export const assertNodeErrorFree = (node: BinaryNode): void => {
	const errNode = getBinaryNodeChild(node, 'error')
	if (errNode) {
		const code = errNode.attrs?.code
		const statusCode = typeof code === 'string' ? Number.parseInt(code, 10) : undefined
		throw new Boom(errNode.attrs?.text || 'Unknown error', {
			statusCode: Number.isFinite(statusCode) ? statusCode : 500,
			data: code != null ? Number(code) : undefined
		})
	}
}
