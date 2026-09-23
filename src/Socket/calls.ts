/** Node deep-import facade for the portable call adapter and file sources. */
import { Boom } from '../Utils/boom.ts'
import type { CallAudioPacketSource, EncodedPacketReader } from '../Types/Call.ts'
import { unrefTimer } from '../Runtime/bytes.ts'
import {
	depacketizeOpusFromMlow as bridgeDepacketizeOpusFromMlow,
	packetizeOpusForMlow as bridgePacketizeOpusForMlow,
	loadVoip
} from '@oxidezap/whatsapp-rust-bridge/voip'
export * from './calls-core.ts'

let codecReady = false
const ensureCodec = (): void => {
	if (codecReady) return
	// Standalone helpers must work without a socket. Each load is isolated;
	// this codec-only instance owns no client transport or media sessions.
	loadVoip({
		connect: async () => {
			throw new Error('codec-only engine has no relay')
		}
	})
	codecReady = true
}

const assertAudioPacket = (method: string, data: Uint8Array): void => {
	if (!(data instanceof Uint8Array) || data.length === 0) {
		throw new Boom(`${method}: data must be a non-empty Uint8Array`, { statusCode: 400 })
	}
}
/**
 * Rewrite one RFC Opus packet to the MLOW escape the engine carries, for
 * hosts that queue packets outside `pushCallAudio` (custom transports,
 * offline fixtures). Ordinary pushes must NOT use this: the engine rewrites
 * Opus packets in flight on `opus-mlow` calls, so a pre-packetized packet would be
 * rewritten twice and corrupt the TOC.
 */
export const packetizeOpusForMlow = (data: Uint8Array): Uint8Array => {
	assertAudioPacket('packetizeOpusForMlow', data)
	ensureCodec()
	return bridgePacketizeOpusForMlow(data)
}

/**
 * Restore the RFC TOC only for received `opus` frames whose format is
 * `opus-mlow`. Native `opus` frames stay unchanged, while `mlow` frames use
 * the MLOW decoder.
 */
export const depacketizeOpusFromMlow = (data: Uint8Array): Uint8Array => {
	assertAudioPacket('depacketizeOpusFromMlow', data)
	ensureCodec()
	return bridgeDepacketizeOpusFromMlow(data)
}

const paceDelay = (intervalMs: number): Promise<void> =>
	new Promise(resolve => {
		unrefTimer(setTimeout(resolve, intervalMs))
	})

export interface FileCallAudioSourceOptions {
	/** Packet size in bytes. Raw chunking, not transcoding: no ffmpeg involved. */
	packetBytes?: number
	/** Gap between packets. Defaults to 60 ms, the MLOW frame cadence. */
	intervalMs?: number
	/** Maximum packets to read; default reads the whole file. */
	packets?: number
}

/**
 * Chunk a file into fixed-size encoded packets for tests. Reads the file
 * once up front and serves slices of it — no microphone, no codec, no
 * ffmpeg — so the bytes are whatever the fixture carries, and a live peer
 * decodes them as whatever grammar they are in.
 */
export const makeFileCallAudioSource = async (
	path: string,
	options: FileCallAudioSourceOptions = {}
): Promise<CallAudioPacketSource> => {
	const { readFile } = await import('node:fs/promises')
	const packetBytes = options.packetBytes ?? 160
	if (!Number.isInteger(packetBytes) || packetBytes <= 0) {
		throw new Boom('makeFileCallAudioSource: packetBytes must be a positive integer', { statusCode: 400 })
	}
	// Validated before the read: a bad count must not cost a full file read,
	// and a missing file must not mask it with a filesystem error either —
	// the read below runs only for arguments that passed.
	if (options.packets !== undefined && (!Number.isInteger(options.packets) || options.packets < 0)) {
		throw new Boom('makeFileCallAudioSource: packets must be a non-negative integer', { statusCode: 400 })
	}
	const intervalMs = options.intervalMs ?? 60
	if (!Number.isFinite(intervalMs) || intervalMs < 0) {
		throw new Boom('makeFileCallAudioSource: intervalMs must be a finite number >= 0', { statusCode: 400 })
	}
	const bytes = await readFile(path)
	const total = options.packets ?? Number.POSITIVE_INFINITY
	let offset = 0
	let sent = 0
	return {
		next: async () => {
			// A short tail goes out as-is: odd-size fixtures stay usable, and
			// the strict runt-tail reader is openFilePacketReader below.
			if (sent >= total || offset >= bytes.length) return null
			if (intervalMs > 0 && sent > 0) await paceDelay(intervalMs)
			const chunk = bytes.subarray(offset, offset + packetBytes)
			offset += chunk.length
			sent++
			return new Uint8Array(chunk)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Pump: source in, bridge push out, shed counted
// ─────────────────────────────────────────────────────────────────────────────

export interface FilePacketReaderOptions {
	/** Packet size in bytes. Raw framing, not transcoding: no ffmpeg involved. */
	packetBytes?: number
}

/**
 * Open a file as an incremental packet reader for tests. Unlike the fixture
 * helper above, this never holds the whole file: one open handle plus the
 * caller's target buffer. Every item is one complete packet — a trailing
 * short chunk fails instead of feeding a runt — so arbitrary read chunks
 * never reach the pump as audio.
 */
export const openFilePacketReader = async (
	path: string,
	options: FilePacketReaderOptions = {}
): Promise<EncodedPacketReader> => {
	const { open } = await import('node:fs/promises')
	const packetBytes = options.packetBytes ?? 160
	if (!Number.isInteger(packetBytes) || packetBytes <= 0) {
		throw new Boom('openFilePacketReader: packetBytes must be a positive integer', { statusCode: 400 })
	}
	const handle = await open(path, 'r')
	let position = 0
	let closed = false
	// The in-flight close, shared: an abort racing a pending read must
	// observe actual completion, not just the flag. Every close path returns
	// this same promise, so callers never finish cleanup while the OS handle
	// is still closing.
	let closePromise: Promise<void> | undefined
	const closeHandle = (): Promise<void> => {
		closed = true
		return (closePromise ??= handle.close().catch(() => {
			// Teardown races a failed open the same way: the handle is
			// gone either way, and close stays idempotent.
		}))
	}
	let tail: Promise<unknown> = Promise.resolve()
	const readIntoInner = async (target: Uint8Array, signal?: AbortSignal): Promise<number | null> => {
		if (closed) {
			throw new Boom('openFilePacketReader: reader is closed', { statusCode: 400 })
		}
		if (!(target instanceof Uint8Array) || target.length < packetBytes) {
			throw new Boom('openFilePacketReader: target must hold a full packet', { statusCode: 400 })
		}
		const abortSignal: AbortSignal | undefined = signal
		let onAbort: (() => void) | undefined
		try {
			if (abortSignal?.aborted) {
				await closeHandle()
				throw abortSignal.reason
			}
			onAbort = () => {
				void closeHandle()
			}
			abortSignal?.addEventListener('abort', onAbort, { once: true })
			// A filesystem read may legally return short of the request
			// before EOF, so accumulate to a full packet: only EOF after
			// a partial aggregate is a runt tail.
			let got = 0
			while (got < packetBytes) {
				const { bytesRead } = await handle.read(target, got, packetBytes - got, position + got)
				if (bytesRead === 0) break
				got += bytesRead
			}
			if (abortSignal?.aborted) {
				await closeHandle()
				throw abortSignal.reason
			}
			if (got === 0) return null
			if (got < packetBytes) {
				throw new Boom(`openFilePacketReader: file length is not a multiple of the ${packetBytes}-byte packet size`, {
					statusCode: 400
				})
			}
			position += got
			return got
		} catch (err) {
			if (abortSignal?.aborted) throw abortSignal.reason
			throw err
		} finally {
			if (onAbort) abortSignal?.removeEventListener('abort', onAbort)
		}
	}
	return {
		readInto: (target: Uint8Array, signal?: AbortSignal): Promise<number | null> => {
			// One read at a time: concurrent calls share `position`, and
			// without ordering two of them can read the same range, then each
			// advance past it and skip a packet. Each call chains behind the
			// previous one; the chain itself never rejects, so one failed
			// read does not wedge later ones. A signal aborted while queued
			// still throws on entry to the inner read below.
			const run = tail.then(() => readIntoInner(target, signal))
			tail = run.catch(() => {})
			return run
		},
		close: () => closeHandle()
	}
}
