/**
 * Helpers for inspecting raw `BinaryNode` stanza trees, ported 1:1
 * from upstream Baileys' `WABinary/generic-utils.ts`. baileyrs has the
 * same `BinaryNode` shape (`{ tag, attrs, content }`), so the
 * implementations are byte-identical.
 */

import { hexEncode } from '../Runtime/bytes.ts'
import type { BinaryNode } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { proto } from '../WAProto/runtime.ts'

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

export const getAllBinaryNodeChildren = ({ content }: BinaryNode): BinaryNode[] =>
	Array.isArray(content) ? content : []

export const getBinaryNodeChildBuffer = (node: BinaryNode | undefined, childTag: string): Uint8Array | undefined => {
	const child = getBinaryNodeChild(node, childTag)?.content
	// Buffer subclasses Uint8Array, so one check covers both; anything else
	// (string content, nested nodes) is genuinely not bytes.
	if (child instanceof Uint8Array) return child
}

export const getBinaryNodeChildString = (node: BinaryNode | undefined, childTag: string): string | undefined => {
	const child = getBinaryNodeChild(node, childTag)?.content
	if (child instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(child)
	if (typeof child === 'string') return child
}

const bufferToUInt = (value: Uint8Array, length: number): number => {
	let result = 0
	for (let index = 0; index < length; index++) result = 256 * result + value[index]!
	return result
}

export const getBinaryNodeChildUInt = (node: BinaryNode, childTag: string, length: number): number | undefined => {
	const buffer = getBinaryNodeChildBuffer(node, childTag)
	if (buffer) return bufferToUInt(buffer, length)
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
		// Single parse for both `statusCode` and `data` — the previous
		// implementation parsed twice (parseInt + Number) which could
		// disagree on edge cases (e.g. `Number('')` is 0 but
		// `parseInt('', 10)` is NaN). When the server sent a non-numeric
		// code, fall back to 500 for statusCode but preserve the original
		// string in `data` so callers can still inspect the wire value.
		const parsed = typeof code === 'string' ? Number.parseInt(code, 10) : undefined
		const statusCode = Number.isFinite(parsed) ? (parsed as number) : 500
		throw new Boom(errNode.attrs?.text || 'Unknown error', {
			statusCode,
			data: Number.isFinite(parsed) ? parsed : code
		})
	}
}

export const reduceBinaryNodeToDictionary = (node: BinaryNode, tag: string): Record<string, string> => {
	const dictionary: Record<string, string> = {}
	const content = node?.content
	if (!Array.isArray(content)) return dictionary
	// One pass, without the intermediate child list.
	for (let index = 0; index < content.length; index++) {
		const item = content[index] as BinaryNode
		if (item === undefined && !(index in content)) continue
		if (item.tag !== tag) continue
		const { attrs } = item
		if (typeof attrs.name === 'string') dictionary[attrs.name] = attrs.value || attrs.config_value!
		else dictionary[attrs.config_code!] = attrs.value || attrs.config_value!
	}
	return dictionary
}

export const getBinaryNodeMessages = ({ content }: BinaryNode): proto.WebMessageInfo[] => {
	const messages: proto.WebMessageInfo[] = []
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item.tag === 'message') {
				messages.push(proto.WebMessageInfo.decode(item.content as Uint8Array).toJSON() as proto.WebMessageInfo)
			}
		}
	}
	return messages
}

const tabs = (count: number) => '\t'.repeat(count)

export function binaryNodeToString(node: BinaryNode | BinaryNode['content'], i = 0): string {
	if (!node) return node!
	if (typeof node === 'string') return tabs(i) + node
	if (node instanceof Uint8Array) return tabs(i) + hexEncode(node)
	if (Array.isArray(node)) {
		// Same text as `node.map(...).join('\n')`, a hole included (it renders
		// empty), built in one pass without the intermediate array.
		const indent = tabs(i + 1)
		let out = ''
		for (let index = 0; index < node.length; index++) {
			if (index > 0) out += '\n'
			if (index in node) out += indent + binaryNodeToString(node[index], i + 1)
		}
		return out
	}

	const children = binaryNodeToString(node.content, i + 1)
	// Same text as filtering `Object.entries(attrs)` and joining, without the
	// entry tuples and the two arrays: this formats every stanza a debug log
	// prints, and large group stanzas carry an attrs object per participant.
	const attrs = node.attrs || {}
	let tag = `<${node.tag} `
	let separator = ''
	for (const key of Object.keys(attrs)) {
		const value = attrs[key]
		if (value === undefined) continue
		tag += `${separator}${key}='${value}'`
		separator = ' '
	}
	const content = children ? `>\n${children}\n${tabs(i)}</${node.tag}>` : '/>'
	return tag + content
}
