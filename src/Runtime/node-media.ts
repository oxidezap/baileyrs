import type { Readable } from 'node:stream'

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
	hkdf: () => {
		throw new Error('HKDF bridge capability is unavailable')
	},
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
const getBuiltinModule = proc?.getBuiltinModule
if (typeof getBuiltinModule === 'function') {
	try {
		const moduleApi = getBuiltinModule('module') as { createRequire?: (base: string) => (id: string) => unknown }
		const load = moduleApi.createRequire?.(import.meta.url)
		const nodeBridge = load?.('@oxidezap/whatsapp-rust-bridge') as { hkdf?: typeof nodeMedia.hkdf } | undefined
		if (nodeBridge?.hkdf) nodeMedia.hkdf = nodeBridge.hkdf
	} catch {
		/* A host has no Node bridge loader; its runtime installs this capability. */
	}
}
