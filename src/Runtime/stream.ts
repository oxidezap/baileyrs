/** Runtime-selected conversion for the root Node stream contract. */
export type WebStreamLike = unknown

let fromWeb: (stream: WebStreamLike) => unknown = stream => stream

export const setReadableFromWeb = (converter: (stream: WebStreamLike) => unknown): void => {
	fromWeb = converter
}

export const readableFromWeb = (stream: WebStreamLike): unknown => fromWeb(stream)
