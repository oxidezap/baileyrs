import type { Readable } from 'node:stream'

type FileBytes = { toString: (encoding?: string) => string }

/** Optional filesystem/process media capabilities. Node installs these; hosts never do. */
export const nodeMedia: {
	execFile: (command: string, args: string[], callback: (error: unknown) => void) => void
	createReadStream: (path: string | URL) => Readable
	fs: {
		writeFile: (path: string, data: unknown) => Promise<void>
		readFile: (path: string) => Promise<FileBytes>
		unlink: (path: string) => Promise<void>
	}
} = {
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
