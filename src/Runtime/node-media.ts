import type { Readable } from 'node:stream'

type FileBytes = { toString: (encoding?: string) => string }

/** Optional filesystem/process media capabilities. Node installs these; hosts never do. */
export const nodeMedia: {
	getImageProcessingLibrary: () => Promise<unknown>
	decodeAudio: (input: Uint8Array) => Promise<{ getChannelData(channel: number): Float32Array }>
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
	decodeAudio: async () => {
		throw new Error('audio decoding is unavailable on this host')
	},
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
		nodeMedia.hkdf = (input, length, options) => {
			try {
				return nodeBridge.hkdf(input, length, options)
			} catch {
				nodeBridge.initWasmEngine()
				return nodeBridge.hkdf(input, length, options)
			}
		}
		nodeMedia.getImageProcessingLibrary = async () => {
			const jimpPackage = ['ji', 'mp'].join('')
			const sharpPackage = ['sha', 'rp'].join('')
			const [jimp, sharp] = await Promise.all([
				import(jimpPackage).catch(() => undefined),
				import(sharpPackage).catch(() => undefined)
			])
			return sharp ? { sharp } : jimp ? { jimp } : {}
		}
		nodeMedia.decodeAudio = async input => {
			const audioPackage = ['audio', 'decode'].join('-')
			const loaded = (await import(audioPackage)) as {
				default: (bytes: Uint8Array) => Promise<{ getChannelData(channel: number): Float32Array }>
			}
			return loaded.default(input)
		}
	} catch {
		/* A host has no Node bridge loader; its runtime installs this capability. */
	}
}
