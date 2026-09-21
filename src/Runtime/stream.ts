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

export const readableFromWeb = (stream: WebStreamLike): unknown => fromWeb(stream)
