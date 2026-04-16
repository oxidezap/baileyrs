/** Binary XML node — the low-level protocol unit exchanged with WhatsApp servers. */
export type BinaryNode = {
	tag: string
	attrs: { [key: string]: string }
	content?: BinaryNode[] | string | Uint8Array
}

export type BinaryNodeAttributes = BinaryNode['attrs']
export type BinaryNodeData = BinaryNode['content']

export type JidWithDevice = {
	user: string
	device?: number
}
