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

const nodeProcess = (globalThis as typeof globalThis & { process?: unknown }).process
if (nodeProcess) {
	try {
		const bridgePackage = ['@oxidezap', 'whatsapp-rust-bridge'].join('/')
		const nodeBridge = await import(bridgePackage)
		try {
			nodeBridge.initWasmEngine()
		} catch {
			/* The owning socket may already have initialized the engine. */
		}
		nodeMedia.hkdf = nodeBridge.hkdf
		nodeMedia.getImageProcessingLibrary = async () => {
			// @ts-ignore Optional peer dependency discovered only in Node.
			const jimpImport = import('jimp').catch(() => undefined)
			// @ts-ignore Optional peer dependency discovered only in Node.
			const sharpImport = import('sharp').catch(() => undefined)
			const [jimp, sharp] = await Promise.all([jimpImport, sharpImport])
			return sharp ? { sharp } : jimp ? { jimp } : {}
		}
	} catch {
		/* A host has no Node bridge loader; its runtime installs this capability. */
	}
}
