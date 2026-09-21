import type { Readable } from 'node:stream'
import * as bridge from '@oxidezap/whatsapp-rust-bridge'

try {
	bridge.initWasmEngine()
} catch {
	/* Socket setup may initialize the engine with its configured logger. */
}

type FileBytes = { toString: (encoding?: string) => string }

/** Optional filesystem/process media capabilities. Node installs these; hosts never do. */
export const nodeMedia: {
	getImageProcessingLibrary: () => Promise<unknown>
	hkdf: (input: Uint8Array, length: number, options: { salt?: Uint8Array; info?: string }) => Uint8Array
	tempDir: () => string
	execFile: (command: string, args: string[], callback: (error: unknown) => void) => void
	createReadStream: (path: string | URL) => Readable
	fs: {
		writeFile: (path: string, data: unknown) => Promise<void>
		readFile: (path: string) => Promise<FileBytes>
		unlink: (path: string) => Promise<void>
	}
} = {
	getImageProcessingLibrary: async () => ({}),
	hkdf: bridge.hkdf,
	tempDir: () => '/tmp',
	execFile: () => {
		throw new Error('ffmpeg is unavailable on this host')
	},
	createReadStream: () => {
		throw new Error('file media is unavailable on this host')
	},
	fs: {
		writeFile: async () => {
			throw new Error('file media is unavailable on this host')
		},
		readFile: async () => {
			throw new Error('file media is unavailable on this host')
		},
		unlink: async () => {
			throw new Error('file media is unavailable on this host')
		}
	}
}

const proc = (globalThis as typeof globalThis & { process?: { getBuiltinModule?: (id: string) => unknown } }).process
if (typeof proc?.getBuiltinModule === 'function') {
	try {
		const moduleApi = proc.getBuiltinModule('module') as { createRequire?: (base: string) => (id: string) => unknown }
		const load = moduleApi.createRequire?.(import.meta.url)
		const optional = (id: string): unknown => {
			try {
				return load?.(id)
			} catch {
				return undefined
			}
		}
		const nodeBridge = optional('@oxidezap/whatsapp-rust-bridge') as
			| { hkdf?: typeof nodeMedia.hkdf; initWasmEngine?: () => void }
			| undefined
		try {
			nodeBridge?.initWasmEngine?.()
		} catch {
			/* The owning socket may initialize the engine later. */
		}
		if (nodeBridge?.hkdf) nodeMedia.hkdf = nodeBridge.hkdf
		nodeMedia.getImageProcessingLibrary = async () => {
			const jimp = optional('jimp')
			const sharp = optional('sharp')
			return sharp ? { sharp } : jimp ? { jimp } : {}
		}
	} catch {
		/* A host has no Node bridge loader; its runtime installs this capability. */
	}
}
