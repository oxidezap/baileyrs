/** Runtime-selected conversion for the root Node stream contract. */
export type WebStreamLike = unknown

let fromWeb: (stream: WebStreamLike) => unknown = stream => stream
let readableCheck: (value: unknown) => boolean = () => false
let createReadableImpl: () => unknown = () => ({})

export const setReadableRuntime = (runtime: {
	fromWeb: (stream: WebStreamLike) => unknown
	isReadable: (value: unknown) => boolean
	createReadable: () => unknown
}): void => {
	fromWeb = runtime.fromWeb
	readableCheck = runtime.isReadable
	createReadableImpl = runtime.createReadable
}

export const isReadable = (value: unknown): boolean => readableCheck(value)
export const createReadable = (): unknown => createReadableImpl()

// Deep Node imports of `Utils/messages-media` do not pass through the package
// root. Discover the builtin without a static Node import so this module stays
// in the host graph, while preserving the historical Node stream contract.
const builtinLoader = (
	globalThis as typeof globalThis & {
		process?: { getBuiltinModule?: (name: string) => unknown }
	}
).process?.getBuiltinModule
const nodeStream = builtinLoader?.('node:stream') as
	| {
			Readable?: {
				new (options?: { read?: () => void }): unknown
				fromWeb(stream: unknown): unknown
			}
	  }
	| undefined
const NodeReadable = nodeStream?.Readable
if (NodeReadable) {
	setReadableRuntime({
		fromWeb: stream => NodeReadable.fromWeb(stream),
		isReadable: value => value instanceof NodeReadable,
		createReadable: () => new NodeReadable({ read: () => {} })
	})
}

export const readableFromWeb = (stream: WebStreamLike): unknown => fromWeb(stream)
