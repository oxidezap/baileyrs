import type { Buffer as NodeBuffer } from 'node:buffer'
import { base64Decode, base64Encode, concatBytes, utf8Decode, utf8Encode } from './bytes.ts'

type BufferConstructor = typeof NodeBuffer

const portableBuffer = {
	from(input: string | ArrayBuffer | ArrayLike<number>, encoding?: string): Uint8Array {
		if (typeof input === 'string') return encoding === 'base64' ? base64Decode(input) : utf8Encode(input)
		return new Uint8Array(input instanceof ArrayBuffer ? input : Array.from(input))
	},
	concat(chunks: readonly Uint8Array[]): Uint8Array {
		return concatBytes(chunks)
	},
	isBuffer(value: unknown): value is Uint8Array {
		return value instanceof Uint8Array
	}
} as unknown as BufferConstructor

/** Node installs its real Buffer; hosts use the Uint8Array-compatible fallback. */
export let BufferRuntime: BufferConstructor =
	(globalThis as typeof globalThis & { Buffer?: BufferConstructor }).Buffer ?? portableBuffer

export const setBufferRuntime = (buffer: BufferConstructor): void => {
	BufferRuntime = buffer
}

export const bufferToBase64 = (value: Uint8Array): string => base64Encode(value)
export const bufferToUtf8 = (value: Uint8Array): string => utf8Decode(value)
