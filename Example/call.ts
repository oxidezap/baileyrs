/**
 * Voice and video calls with real media: dial or answer a call, stream
 * microphone or file audio through ffmpeg, play the peer back through ffplay,
 * and upgrade to H.264 video with a camera or test pattern.
 *
 * This mirrors examples/voip-cli in the whatsapp-rust repo in behavior —
 * dial/accept a real call, encoded packets both ways, mute, stats, hangup,
 * plus the video path (start/accept/resume keyed on `v`) — adapted to what
 * JavaScript can do. Audio follows the negotiated promise, read off the offer
 * with `negotiatedAudioFormat`: an `opus` call is the full ffmpeg path (a
 * file or microphone encoded to 16 kHz mono Opus, a small Ogg demuxer splits
 * the stream back into packets for pushing straight through. The engine
 * rewrites them to the MLOW escape in flight, and received opus packets
 * are depacketized back to RFC Opus before wrapping in Ogg pages for
 * ffplay on stdin. There is no MLOW encoder here, so an
 * `mlow` call pushes MLOW silence while the peer is logged, not played.
 * Video is the same shape over Annex-B access units: ffmpeg encodes a camera,
 * access units: ffmpeg encodes a camera, file or test pattern to baseline
 * H.264, a splitter hands one AU per push to `pushCallVideo`, and peer AUs
 * fan out to a second ffplay window or a raw `.h264` file. The library only
 * transports the opaque packets, exactly like voip-cli's ffmpeg video path,
 * and the relay itself is reached over UDP from Node — no WebRTC, no browser
 * needed.
 *
 * Usage:
 *   node Example/call.ts dial <peer-jid> [--audio-file path | --mic [device]] [--auth dir] [--socket url] [--video [camera|testsrc|file|url]]
 *   node Example/call.ts listen [--accept] [--video ...] [...]
 *
 * During a call: `m` mute/unmute, `s` print media stats, `v` toggle video
 * (start upgrade / accept the peer's request / stop), `k` ask the peer for a
 * keyframe, `d` print video diagnostics, `q` hang up and quit.
 * A dialed call exits after it ends; listen keeps serving the next ring.
 *
 * Requires ffmpeg and ffplay on PATH (checked at startup with a clear error)
 * and nothing else: only node builtins besides the built package in lib/.
 * Microphone capture uses ffmpeg device syntax for the OS (`-f alsa -i
 * <device>` on Linux, `-f avfoundation` / `-f dshow` elsewhere). Without
 * --audio-file or --mic nothing is pushed and the call stays quiet.
 *
 * Against the Bartender mock, point --socket at it the way the e2e suite
 * does; SOCKET_URL is honored too. With no --socket the production default
 * applies — the socket fix for Node's HTTP/2 WebSocket default plus an
 * explicit Origin header is what makes that path connect at all.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import readline from 'node:readline'
import {
	classifyStunPacket,
	depacketizeOpusFromMlow,
	describeStunAllocate,
	fetchLatestWaWebVersion,
	makeSilenceCallAudioSource,
	makeWASocket,
	negotiatedAudioFormat,
	useMultiFileAuthState,
	type CallAudioBuffer,
	type CallAudioFrame,
	type CallAudioWriter,
	type CallMediaStats,
	type CallVideoWriter,
	type WACallEvent
} from '../lib/index.js'

const usage = (): never => {
	console.error(
		[
			'usage:',
			'  node Example/call.ts dial <peer-jid> [--audio-file path | --mic [device]] [--auth dir] [--socket url] [--video [camera|testsrc|file|url]]',
			'  node Example/call.ts listen [--accept] [--audio-file path | --mic [device]] [--auth dir] [--socket url] [--video ...]',
			'',
			'--video without a value means the camera (mirroring voip-cli, where',
			'video implies accept too). --video testsrc sends the ffmpeg pattern,',
			'--video <file-or-url> plays that through the camera pipe.',
			'',
			'--danger-skip-cert-verify is testing-only (Bartender mock with a',
			'self-signed cert). Never use it against production.',
			'',
			'keys during a call: m mute, s stats, v video toggle, k keyframe, d video diagnostics, q hang up'
		].join('\n')
	)
	process.exit(2)
}

/** Fail fast with a named binary when ffmpeg/ffplay are not installed. */
const requireBinary = (name: 'ffmpeg' | 'ffplay'): void => {
	const found = spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0
	if (!found) {
		console.error(`${name} not found on PATH; install it to run Example/call.ts`)
		process.exit(2)
	}
}

// ── Ogg framing: ffmpeg speaks Ogg Opus, the bridge speaks bare packets ──

/** CRC-32 as Ogg defines it: MSB-first, polynomial 0x04C11DB7, init 0, no
 * final xor — not the IEEE/zlib variant, which every page would fail. */
const oggCrcTable = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let r = n << 24
		for (let k = 0; k < 8; k++) r = (r << 1) ^ (r & 0x80000000 ? 0x04c11db7 : 0)
		table[n] = r >>> 0
	}
	return table
})()

const oggCrc32 = (data: Uint8Array): number => {
	let crc = 0
	for (const byte of data) crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ byte) & 0xff]!) >>> 0
	return crc >>> 0
}

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
	let total = 0
	for (const chunk of chunks) total += chunk.length
	const out = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.length
	}
	return out
}

const startsWithBytes = (data: Uint8Array, magic: number[]): boolean => {
	if (data.length < magic.length) return false
	return magic.every((byte, index) => data[index] === byte)
}

/** Split an Ogg Opus byte stream into bare Opus packets, skipping the OpusHead/OpusTags headers. */
export const demuxOggOpus = (): { push(bytes: Uint8Array): Uint8Array[] } => {
	// Annotated, not inferred: `new Uint8Array(0)` infers the ArrayBuffer
	// flavor, which then refuses the ArrayBufferLike chunks `push` delivers.
	let buffered: Uint8Array = new Uint8Array(0)
	let pending: Uint8Array = new Uint8Array(0)
	return {
		push(bytes: Uint8Array): Uint8Array[] {
			buffered = concatBytes([buffered, bytes])
			const packets: Uint8Array[] = []
			for (;;) {
				if (buffered.length < 27) return packets
				if (!startsWithBytes(buffered, [0x4f, 0x67, 0x67, 0x53])) {
					throw new Error('ogg demuxer lost sync: no OggS capture pattern')
				}
				const segmentCount = buffered[26]!
				if (buffered.length < 27 + segmentCount) return packets
				const segments: number[] = []
				let bodyLength = 0
				for (let i = 0; i < segmentCount; i++) {
					const size = buffered[27 + i]!
					segments.push(size)
					bodyLength += size
				}
				if (buffered.length < 27 + segmentCount + bodyLength) return packets
				const body = buffered.subarray(27 + segmentCount, 27 + segmentCount + bodyLength)
				buffered = buffered.slice(27 + segmentCount + bodyLength)
				// A segment shorter than 255 bytes ends a packet; a page of
				// full segments continues on the next page, which is why
				// `pending` survives across pushes.
				let position = 0
				for (const size of segments) {
					pending = concatBytes([pending, body.subarray(position, position + size)])
					position += size
					if (size < 255) {
						if (
							!startsWithBytes(pending, [0x4f, 0x70, 0x75, 0x73, 0x48]) &&
							!startsWithBytes(pending, [0x4f, 0x70, 0x75, 0x73, 0x54])
						) {
							packets.push(pending)
						}
						pending = new Uint8Array(0)
					}
				}
			}
		}
	}
}

/**
 * Calculate the number of audio samples in an Opus packet at 48 kHz (RFC 6716 Section 3.2.5).
 * WhatsApp voice call packets carry 60 ms frames (2880 samples @ 48 kHz). ffmpeg typically emits
 * 20 ms frames (960 samples @ 48 kHz). Accurate granule positions prevent ffplay desync, stutter, and cuts.
 */
export const getOpusSamples48k = (packet: Uint8Array): number => {
	if (packet.length === 0) return 960
	const toc = packet[0]!
	const config = toc >> 3
	const frameCountCode = toc & 3
	let frameDurationSamples: number
	if (config >= 16) {
		// CELT: configurations 16-31
		const match = config & 3
		frameDurationSamples = match === 0 ? 120 : match === 1 ? 240 : match === 2 ? 480 : 960
	} else if (config >= 12) {
		// Hybrid: configurations 12-15
		frameDurationSamples = (config & 1) === 0 ? 480 : 960
	} else {
		// SILK: configurations 0-11
		const match = config & 3
		frameDurationSamples = match === 0 ? 480 : match === 1 ? 960 : match === 2 ? 1920 : 2880
	}
	let frameCount: number
	if (frameCountCode === 0) {
		frameCount = 1
	} else if (frameCountCode === 1 || frameCountCode === 2) {
		frameCount = 2
	} else {
		if (packet.length < 2) return frameDurationSamples
		frameCount = packet[1]! & 0x3f
	}
	return frameCount * frameDurationSamples
}

/** Wrap bare Opus packets in Ogg pages for ffplay's stdin. */
export const muxOggOpus = (): {
	headerPages(): Uint8Array[]
	page(packet: Uint8Array, gapSamples48k?: number): Uint8Array
} => {
	const serial = (Math.random() * 0xffffffff) >>> 0
	let sequence = 0
	// Samples at 48 kHz, incremented by the exact duration of each Opus packet.
	let granule = 0
	const framePage = (packet: Uint8Array, granulepos: number, flags: number): Uint8Array => {
		const segments: number[] = []
		let remaining = packet.length
		while (remaining >= 255) {
			segments.push(255)
			remaining -= 255
		}
		segments.push(remaining)
		const header = new Uint8Array(27 + segments.length)
		header.set([0x4f, 0x67, 0x67, 0x53, 0x00, flags], 0)
		header[26] = segments.length
		const view = new DataView(header.buffer)
		view.setBigUint64(6, BigInt(granulepos), true)
		view.setUint32(14, serial, true)
		view.setUint32(18, sequence++, true)
		segments.forEach((size, index) => {
			header[27 + index] = size
		})
		// Checksum over the page with its own checksum field zeroed (it
		// still is: the header started zeroed), then stamped in place.
		const page = concatBytes([header, packet])
		new DataView(page.buffer, page.byteOffset).setUint32(22, oggCrc32(page), true)
		return page
	}
	return {
		// A decodable stream opens with identification and comment headers,
		// mono 48 kHz with the stock libopus encoder delay as preskip.
		headerPages(): Uint8Array[] {
			const head = new Uint8Array(19)
			head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01], 0)
			new DataView(head.buffer).setUint16(10, 312, true)
			new DataView(head.buffer).setUint32(12, 48000, true)
			const vendor = new TextEncoder().encode('baileyrs')
			const tags = new Uint8Array(8 + 4 + vendor.length + 4)
			tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0)
			new DataView(tags.buffer).setUint32(8, vendor.length, true)
			tags.set(vendor, 12)
			const first = framePage(head, 0, 0x02)
			const second = framePage(tags, 0, 0x00)
			return [first, second]
		},
		page(packet: Uint8Array, gapSamples48k = 0): Uint8Array {
			granule += gapSamples48k + getOpusSamples48k(packet)
			return framePage(packet, granule, 0x00)
		}
	}
}

// ── ffmpeg in, ffplay out ──

interface CallExampleArgs {
	command: 'dial' | 'listen'
	peer?: string
	accept: boolean
	audioFile?: string
	mic?: string
	/** Camera/file/pattern source for outgoing video; undefined means audio-only. */
	video?: string
	authDir: string
	socketUrl: string | undefined
	dangerSkipCertVerify: boolean
}

const parseArgs = (argv: string[]): CallExampleArgs => {
	// A flag takes the next argument only when one is there and it is not
	// itself a flag: `--mic --auth ./auth` means the default microphone,
	// not a device literally named `--auth`.
	const get = (flag: string): string | undefined => {
		const index = argv.indexOf(flag)
		if (index < 0) return undefined
		const value = argv[index + 1]
		if (value === undefined || value.startsWith('--')) usage()
		return value
	}
	const getOptional = (flag: string, fallback: string): string | undefined => {
		const index = argv.indexOf(flag)
		if (index < 0) return undefined
		const value = argv[index + 1]
		return value === undefined || value.startsWith('--') ? fallback : value
	}
	const rawCommand = argv[0]
	// Positive check, not a cast: narrowing `string` by exclusion keeps it
	// `string`, so the command is built only from the two accepted spellings
	// and anything else prints usage, which never returns.
	const command = rawCommand === 'dial' || rawCommand === 'listen' ? rawCommand : usage()
	const peer = command === 'dial' ? argv[1] : undefined
	if (command === 'dial' && (!peer || peer.startsWith('--'))) usage()
	const audioFile = get('--audio-file')
	const mic = getOptional('--mic', 'default')
	if (audioFile && mic !== undefined) {
		console.error('pick one audio input: --audio-file or --mic')
		process.exit(2)
	}
	// --video with no value means the camera, and video implies accept: there
	// is no reason to request video while rejecting every call.
	const video = getOptional('--video', 'camera')
	return {
		command,
		peer,
		accept: (command === 'listen' && argv.includes('--accept')) || video !== undefined,
		audioFile,
		mic,
		video,
		authDir: get('--auth') ?? './baileys_auth_info',
		// No mock fallback: without --socket or SOCKET_URL the socket keeps
		// its production WhatsApp Web default, so an ordinary run places a
		// real call instead of timing out against an absent localhost mock.
		socketUrl: get('--socket') ?? process.env.SOCKET_URL,
		dangerSkipCertVerify: argv.includes('--danger-skip-cert-verify')
	}
}

/** ffmpeg turns a file or microphone into 16 kHz mono Opus on stdout. */
const spawnOpusEncoder = (args: CallExampleArgs): ChildProcess | null => {
	if (!args.audioFile && args.mic === undefined) return null
	// Capture devices are OS-specific; only Linux names one here, the rest
	// pass their own ffmpeg device through --mic.
	const micInput: string[] =
		process.platform === 'darwin'
			? ['-f', 'avfoundation', '-i', args.mic === 'default' ? ':0' : (args.mic ?? ':0')]
			: process.platform === 'win32'
				? ['-f', 'dshow', '-i', `audio=${args.mic ?? 'default'}`]
				: ['-f', 'alsa', '-i', args.mic ?? 'default']
	const input: string[] =
		args.audioFile !== undefined
			? ['-re', '-i', args.audioFile]
			: ['-fflags', 'nobuffer', '-flags', 'low_delay', ...micInput]
	const ffmpeg = spawn(
		'ffmpeg',
		[
			...input,
			'-ac',
			'1',
			'-ar',
			'16000',
			'-c:a',
			'libopus',
			'-b:a',
			'24k',
			'-application',
			'voip',
			'-frame_duration',
			'60',
			'-vbr',
			'on',
			'-page_duration',
			'60000',
			'-flush_packets',
			'1',
			'-f',
			'opus',
			'pipe:1'
		],
		{
			stdio: ['ignore', 'pipe', 'inherit']
		}
	)
	ffmpeg.on('error', err => console.error('ffmpeg failed to start:', (err as Error).message))
	return ffmpeg
}

/** ffmpeg turns a camera, file/URL or test pattern into baseline H.264 on stdout. */
const spawnVideoEncoder = (source: string): ChildProcess => {
	const input: string[] =
		source === 'testsrc'
			? ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=20']
			: source.includes('://') || source.includes('.')
				? ['-re', '-i', source]
				: process.platform === 'darwin'
					? ['-f', 'avfoundation', '-i', source === 'camera' ? '0' : source]
					: process.platform === 'win32'
						? ['-f', 'dshow', '-i', `video=${source === 'camera' ? 'default' : source}`]
						: ['-f', 'v4l2', '-i', source === 'camera' ? '/dev/video0' : source]
	const ffmpeg = spawn(
		'ffmpeg',
		[
			...input,
			'-vf',
			'scale=1280:720',
			'-r',
			'20',
			'-c:v',
			'libx264',
			'-profile:v',
			'baseline',
			'-level',
			'3.1',
			'-b:v',
			'1980k',
			'-x264-params',
			'keyint=60',
			'-f',
			'h264',
			'-aud',
			'1',
			'pipe:1'
		],
		{ stdio: ['ignore', 'pipe', 'inherit'] }
	)
	ffmpeg.on('error', err => console.error('ffmpeg (video) failed to start:', (err as Error).message))
	return ffmpeg
}

const seqDiff = (a: number, b: number): number => {
	const diff = (a - b) & 0xffff
	return diff > 0x7fff ? diff - 0x10000 : diff
}

interface AudioJitterBufferOptions {
	preRoll: number
	maxDelay: number
	onPacket: (frame: CallAudioFrame, gapSamples48k: number) => void
}

/**
 * Playout jitter buffer and RTP sequence reorderer.
 * Smooths out network inter-arrival jitter, re-orders datagrams delivered out-of-order,
 * and advances the timeline when packets are lost so Ogg Opus PLC can interpolate cleanly.
 */
class AudioJitterBuffer {
	private readonly preRoll: number
	private readonly maxDelay: number
	private readonly onPacket: (frame: CallAudioFrame, gapSamples48k: number) => void
	private readonly buffer: CallAudioFrame[] = []
	private expectedSeq: number | null = null
	private primed = false

	constructor(options: AudioJitterBufferOptions) {
		this.preRoll = options.preRoll
		this.maxDelay = options.maxDelay
		this.onPacket = options.onPacket
	}

	push(frame: CallAudioFrame): void {
		const seq = frame.sequenceNumber
		if (this.expectedSeq === null) {
			this.expectedSeq = seq
		}

		const diff = seqDiff(seq, this.expectedSeq)
		if (diff < 0) {
			// Stale packet that arrived after playback window passed
			return
		}

		// Insert sorted by sequence number
		let insertIdx = this.buffer.length
		for (let i = 0; i < this.buffer.length; i++) {
			const d = seqDiff(this.buffer[i]!.sequenceNumber, seq)
			if (d === 0) return // duplicate packet
			if (d > 0) {
				insertIdx = i
				break
			}
		}
		this.buffer.splice(insertIdx, 0, frame)

		if (!this.primed) {
			if (this.buffer.length >= this.preRoll) {
				this.primed = true
				this.drain()
			}
			return
		}

		this.drain()
	}

	private drain(): void {
		while (this.buffer.length > 0) {
			const next = this.buffer[0]!
			const diff = seqDiff(next.sequenceNumber, this.expectedSeq!)

			if (diff === 0) {
				this.buffer.shift()
				this.expectedSeq = (this.expectedSeq! + 1) & 0xffff
				this.onPacket(next, 0)
			} else if (diff > 0) {
				// Packet missing (loss or late arrival). If buffer depth reaches maxDelay,
				// do not stall playout any longer: advance past the lost packets.
				if (this.buffer.length >= this.maxDelay) {
					const lostCount = diff
					const gapSamples = lostCount * 2880
					this.buffer.shift()
					this.expectedSeq = (next.sequenceNumber + 1) & 0xffff
					this.onPacket(next, gapSamples)
				} else {
					break
				}
			} else {
				this.buffer.shift()
			}
		}
	}

	flush(): void {
		while (this.buffer.length > 0) {
			const frame = this.buffer.shift()!
			this.onPacket(frame, 0)
		}
		this.expectedSeq = null
		this.primed = false
	}
}

/** ffplay renders muxed Ogg Opus fed on stdin. Returns a writer for pages. */
const spawnOpusPlayer = (): { write(page: Uint8Array): void; stop(): void } => {
	const ffplay = spawn(
		'ffplay',
		['-hide_banner', '-loglevel', 'error', '-nodisp', '-autoexit', '-sync', 'audio', '-f', 'ogg', '-i', 'pipe:0'],
		{
			stdio: ['pipe', 'ignore', 'inherit']
		}
	)
	ffplay.on('error', err => console.error('ffplay failed to start:', (err as Error).message))
	return {
		write: page => {
			if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.write(page)
		},
		stop: () => {
			try {
				ffplay.stdin?.end()
				ffplay.stdin?.destroy()
			} catch {
				// ignore
			}
			ffplay.kill('SIGKILL')
		}
	}
}

// ── H.264 framing: ffmpeg speaks raw Annex-B, the bridge speaks access units ──

/** Split a raw Annex-B byte stream into access units on AUD boundaries (NAL type 9). */
export const splitVideoAccessUnits = (): { push(bytes: Uint8Array): Uint8Array[] } => {
	// Same ArrayBuffer/ArrayBufferLike annotation as the Ogg demuxer above.
	let buffered: Uint8Array = new Uint8Array(0)
	return {
		push(bytes: Uint8Array): Uint8Array[] {
			const merged = new Uint8Array(buffered.length + bytes.length)
			merged.set(buffered)
			merged.set(bytes, buffered.length)
			buffered = merged
			const units: Uint8Array[] = []
			const starts: number[] = []
			for (let i = 0; i + 4 <= buffered.length; i++) {
				if (buffered[i] === 0 && buffered[i + 1] === 0 && buffered[i + 2] === 0 && buffered[i + 3] === 1) {
					starts.push(i)
				}
			}
			if (starts.length < 2) return units
			for (let n = 0; n + 1 < starts.length; n++) {
				units.push(buffered.slice(starts[n]!, starts[n + 1]!))
			}
			buffered = buffered.slice(starts[starts.length - 1]!)
			return units
		}
	}
}

/** ffplay renders raw H.264 fed on stdin. One window per call, like audio. */
const spawnVideoPlayer = (): { write(unit: Uint8Array): void; stop(): void } => {
	const ffplay = spawn(
		'ffplay',
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-probesize',
			'32',
			'-analyzeduration',
			'0',
			'-fflags',
			'nobuffer+fastseek+flush_packets',
			'-flags',
			'low_delay',
			'-i',
			'pipe:0',
			'-f',
			'h264',
			'-framerate',
			'20'
		],
		{ stdio: ['pipe', 'ignore', 'inherit'] }
	)
	ffplay.on('error', err => console.error('ffplay (video) failed to start:', (err as Error).message))
	return {
		write: unit => {
			if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.write(unit)
		},
		stop: () => {
			try {
				ffplay.stdin?.end()
				ffplay.stdin?.destroy()
			} catch {
				// ignore
			}
			ffplay.kill('SIGKILL')
		}
	}
}

// ── the call ──

const main = async (): Promise<void> => {
	requireBinary('ffmpeg')
	requireBinary('ffplay')
	const args = parseArgs(process.argv.slice(2))

	const { state } = await useMultiFileAuthState(args.authDir)
	// fetch latest version of WA Web, exactly like example.ts: the embedded
	// default goes stale and the server rejects it with "Client outdated".
	const latest = await fetchLatestWaWebVersion()
	const { version } = latest
	console.log(`using WA version ${version.join('.')} (latest: ${latest.isLatest})`)
	interface ConsoleLogger {
		level: string
		child(_obj: Record<string, unknown>): ConsoleLogger
		trace(_obj: unknown, _msg?: string): void
		debug(_obj: unknown, _msg?: string): void
		info(_obj: unknown, _msg?: string): void
		warn(obj: unknown, msg?: string): void
		error(obj: unknown, msg?: string): void
	}
	const logger: ConsoleLogger = {
		level: 'warn',
		child: () => logger,
		trace: () => undefined,
		debug: () => undefined,
		info: () => undefined,
		warn: (obj, msg) => console.warn(msg ?? '', obj ?? ''),
		error: (obj, msg) => console.error(msg ?? '', obj ?? '')
	}
	const sock = makeWASocket({
		version,
		auth: state,
		logger: logger as never,
		...(args.socketUrl !== undefined ? { waWebSocketUrl: args.socketUrl } : {}),
		...(args.dangerSkipCertVerify ? { dangerSkipCertChainVerify: true as const } : {})
	})
	// Listen before the relay provider waits for the client, so an open
	// emitted during that await is still observed.
	const connected = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('connect timeout')), 60_000)
		sock.ev.on('connection.update', update => {
			if (update.qr) console.log('scan this QR with your phone:', update.qr)
			if (update.connection === 'open') {
				clearTimeout(timer)
				resolve()
			}
			if (update.connection === 'close') {
				clearTimeout(timer)
				reject(update.lastDisconnect?.error ?? new Error('connection closed'))
			}
		})
	})
	// UDP pipe to the relay: the core builds every datagram, this only ships
	// bytes. Same shape as the e2e helper, inlined so the example stands alone.
	const dgram = await import('node:dgram')
	// Every open relay socket or DataChannel handle, so a crash-time shutdown
	// can close what the bridge client no longer drives.
	const liveRelays = new Set<{ close(): unknown }>()

	// For production WhatsApp Web calls, relays require WebRTC DataChannel (SCTP-over-DTLS-over-UDP).
	// For local test mock, plain UDP cleartext allocate is accepted.
	let rtcProvider: Parameters<typeof sock.setRelayTransportProvider>[0] | undefined
	if (!args.socketUrl && !args.dangerSkipCertVerify) {
		try {
			const { RTCPeerConnection } = await import('werift')
			const bridge = (await import('@oxidezap/whatsapp-rust-bridge')) as {
				createRtcRelayTransportProvider?: (
					fingerprint?: string,
					options?: { RTCPeerConnection?: unknown }
				) => Parameters<typeof sock.setRelayTransportProvider>[0]
				RELAY_DTLS_FINGERPRINT?: string
			}
			if (typeof bridge.createRtcRelayTransportProvider === 'function') {
				const baseRtc = bridge.createRtcRelayTransportProvider(bridge.RELAY_DTLS_FINGERPRINT, { RTCPeerConnection })
				rtcProvider = {
					async createRelayConnection(params, events) {
						console.log(`relay channel (WebRTC DataChannel DTLS+SCTP tunnel) to ${params.address}:${params.port}`)
						const handle = await baseRtc.createRelayConnection(params, events)
						liveRelays.add(handle)
						return {
							send: (data: Uint8Array) => handle.send(data),
							close: async () => {
								liveRelays.delete(handle)
								await handle.close()
							}
						}
					}
				}
			}
		} catch (err) {
			console.warn('werift WebRTC provider not available, falling back to raw UDP:', (err as Error).message)
		}
	}

	if (rtcProvider) {
		await sock.setRelayTransportProvider(rtcProvider)
	} else {
		await sock.setRelayTransportProvider({
			async createRelayConnection(params, events) {
				// Host and port only, never credentials: this line tells the
				// next transcript which relay the allocate went to, which is
				// what a relay-allocate-timed-out needs after it.
				console.log(`relay channel (cleartext UDP fallback) to ${params.address}:${params.port}`)
				const socket = dgram.createSocket('udp4')
				liveRelays.add(socket)
				const stunOut = new Map<string, number>()
				const stunIn = new Map<string, number>()
				const traceStun = (direction: string, counts: Map<string, number>, message: Uint8Array): void => {
					const name = classifyStunPacket(message)
					if (name === undefined) return
					const total = (counts.get(name) ?? 0) + 1
					counts.set(name, total)
					if (total === 1 || total % 10 === 0) console.log(`relay ${direction} ${name} x${total}`)
					// Shape only, never values: a tokenless or integrity-less
					// allocate is one the relay drops silently, which reads
					// exactly like a network failure without this line. The
					// endpoint check beside it catches the allocate naming a
					// different relay than the channel talks to.
					if (direction === 'out' && name === 'allocate request' && total === 1) {
						const shape = describeStunAllocate(message)
						console.log('allocate shape:', JSON.stringify(shape))
						if (shape && (shape.endpointIp !== params.address || shape.endpointPort !== params.port)) {
							console.log(
								`allocate endpoint mismatch: names ${shape.endpointIp ?? 'n/a'}:${shape.endpointPort ?? 'n/a'} but the channel talks to ${params.address}:${params.port}`
							)
						}
					}
				}
				// Reachability ping on the same socket the Allocate leaves from,
				// so the verdict covers the real NAT mapping, not a fresh one.
				// A STUN binding request the relay answers proves UDP flows both
				// ways; silence here followed by relay-allocate-timed-out means
				// the network drops it, not the engine. The reply is consumed,
				// never forwarded: its transaction id matches nothing the core
				// sent. Skipped for non-IP literals, which answer nothing.
				const pingTxn = Buffer.alloc(12)
				for (let i = 0; i < pingTxn.length; i++) pingTxn[i] = Math.floor(Math.random() * 256)
				let pingSettled = false
				const isPingReply = (message: Buffer): boolean =>
					message.length >= 20 &&
					message.readUInt16BE(0) === 0x0101 &&
					message.readUInt32BE(4) === 0x2112a442 &&
					message.subarray(8, 20).equals(pingTxn)
				const pingTimer = setTimeout(() => {
					if (pingSettled) return
					pingSettled = true
					console.log(
						`no STUN reply from relay ${params.address}:${params.port} within 2s; if allocate times out next, UDP to the relay is blocked on this network`
					)
				}, 2000)
				pingTimer.unref()
				const ping = Buffer.alloc(20)
				ping.writeUInt16BE(0x0001, 0)
				ping.writeUInt16BE(0, 2)
				ping.writeUInt32BE(0x2112a442, 4)
				pingTxn.copy(ping, 8)
				await new Promise<void>((resolve, reject) => {
					socket.once('error', reject)
					socket.bind(0, () => {
						// Off on success: a leftover one-shot would swallow the
						// first operational error as a no-op reject instead of
						// reporting the relay closed.
						socket.off('error', reject)
						resolve()
					})
				})
				let opened = false
				let finished = false
				const finish = (reason?: string): void => {
					if (finished) return
					finished = true
					liveRelays.delete(socket)
					try {
						events.onClose(reason)
					} catch {
						// The bridge is already gone; nothing left to tell.
					}
				}
				socket.on('message', (message: Buffer) => {
					if (!pingSettled && isPingReply(message)) {
						pingSettled = true
						clearTimeout(pingTimer)
						console.log(`relay STUN reachable at ${params.address}:${params.port}`)
						return
					}
					traceStun('in', stunIn, message)
					if (!opened) {
						opened = true
						events.onOpen()
					}
					events.onPacket(new Uint8Array(message))
				})
				socket.on('error', () => finish('udp socket error'))
				socket.on('close', () => finish())
				queueMicrotask(() => {
					if (!opened) {
						opened = true
						events.onOpen()
					}
				})
				socket.send(ping, params.port, params.address, err => {
					if (err) console.error(`relay STUN ping to ${params.address}:${params.port} failed:`, err.message)
				})
				return {
					send: data => {
						traceStun('out', stunOut, data)
						socket.send(data, params.port, params.address, err => {
							if (err) console.error(`relay send to ${params.address}:${params.port} failed:`, err.message)
						})
					},
					close: async () => {
						liveRelays.delete(socket)
						socket.close()
					}
				}
			}
		})
	}

	await connected
	console.log('connected as', sock.user?.id)

	let liveCallId: string | undefined
	let accepting = false
	let stopSink: (() => void) | undefined
	let muted = false
	let shed = 0
	// The negotiated audio promise for the live call (`mlow` when the offer
	// names it, `opus` otherwise). Outbound encoding and inbound playback both
	// follow it: pushing the wrong grammar sheds forever and plays nothing.
	let audioFormat: 'mlow' | 'opus' = 'opus'
	// Inbound counters for the mlow path, which has no playback: reported on
	// `s` and sampled in the log so a quiet peer is visible, not silent.
	let mlowHeard = 0
	let mismatched = 0
	// Playback is per call, not per process: hangup stops the player, and the
	// next ring mints a fresh Ogg stream rather than writing into a dead
	// stdin with stale sequence state.
	let pushAudioFrame: ((frame: CallAudioFrame) => void) | undefined
	let stopPlaying: (() => void) | undefined
	const startPlayback = (): void => {
		const mux = muxOggOpus()
		const player = spawnOpusPlayer()
		for (const page of mux.headerPages()) player.write(page)

		const jitterBuffer = new AudioJitterBuffer({
			preRoll: 5,
			maxDelay: 8,
			onPacket: (frame, gapSamples) => {
				let data = frame.data
				if (data.length > 0 && ((data[0] ?? 0) & 0xc0) === 0xc0) {
					try {
						data = depacketizeOpusFromMlow(data)
					} catch {
						// ignore
					}
				}
				if (data.length <= 1 && data[0] === 0x90) {
					player.write(mux.page(new Uint8Array(0), gapSamples + 2880))
					return
				}
				player.write(mux.page(data, gapSamples))
			}
		})

		pushAudioFrame = frame => jitterBuffer.push(frame)
		stopPlaying = () => {
			jitterBuffer.flush()
			player.stop()
			pushAudioFrame = undefined
		}
	}
	// Peer video goes to its own ffplay window, minted with the call like
	// audio playback — never into the audio Ogg stream.
	let stopVideoSink: (() => void) | undefined
	let stopVideoPlayer: (() => void) | undefined
	const startVideoPlayback = (): void => {
		const player = spawnVideoPlayer()
		stopVideoSink = sock.onCallVideo(liveCallId!, frame => {
			if (frame.callId !== liveCallId) return
			console.log(`video: ${frame.data.length}B keyframe=${frame.keyframe} orientation=${frame.orientation}`)
			player.write(frame.data)
		})
		stopVideoPlayer = () => player.stop()
	}
	const stopVideoPlayback = (): void => {
		stopVideoSink?.()
		stopVideoSink = undefined
		stopVideoPlayer?.()
		stopVideoPlayer = undefined
	}
	let encoder: ChildProcess | null = null
	let audioWriter: CallAudioWriter | null = null
	let videoEncoder: ChildProcess | null = null
	let videoWriter: CallVideoWriter | null = null
	let outboundVideoShed = 0
	// The mlow outbound path: no MLOW encoder exists here, so an mlow call
	// pushes the silence token the core accepts under both promises. A pump,
	// not a bare interval, so backpressure sheds with counts and hangup stops
	// it with the call. Null unless an mlow call is live.
	let silencePump: { stop(): void; done: Promise<unknown> } | null = null

	// The Opus encoder runs only on opus calls while a call is live: a file
	// input exhausts, starting it at launch would spend the audio before
	// anyone answers, and pushing Opus grammar into an mlow call dies in the
	// engine and sheds forever. That mixup is what the mlow path above is for.
	const ensureEncoder = (): void => {
		if (encoder || audioFormat !== 'opus' || (!args.audioFile && args.mic === undefined) || !liveCallId) return
		const callForChild = liveCallId
		void sock
			.openCallAudioWriter(callForChild)
			.then(writer => {
				if (liveCallId === callForChild && encoder === child) {
					audioWriter = writer
				} else {
					writer.close()
				}
			})
			.catch(err => console.error('failed to open sync audio writer:', (err as Error).message))

		const child = spawnOpusEncoder(args)
		encoder = child
		// Per-child demux and call id: a killed child can still flush
		// buffered stdout after its replacement started, and those stale
		// bytes belong to the old stream — parsed with the new demux they
		// would corrupt it, and pushed to the new call id they would land
		// on the wrong call. Both are captured here and checked per chunk.
		const stream = demuxOggOpus()
		// Backoff state: pushing into a full queue is a wasted crossing,
		// so after a run of sheds the producer drops at the source for a
		// beat instead of hammering. Acceptances reset the run.
		let consecutiveSheds = 0
		let quietUntil = 0
		child?.stdout?.on('data', (chunk: Buffer) => {
			if (child !== encoder || callForChild !== liveCallId || !liveCallId) return
			if (Date.now() < quietUntil) return
			for (const packet of stream.push(new Uint8Array(chunk))) {
				if (audioWriter) {
					const accepted = audioWriter.tryWrite(packet)
					if (!accepted) {
						shed++
						consecutiveSheds++
						if (shed % 50 === 1) console.log(`shed ${shed} packets under backpressure`)
						if (consecutiveSheds === 20) {
							quietUntil = Date.now() + 500
							console.log(
								`engine still full after 20 sheds (${shed} total); pausing pushes 500ms and dropping at the source`
							)
						}
					} else {
						consecutiveSheds = 0
					}
				} else {
					void sock
						.pushCallAudio(liveCallId, packet)
						.then(accepted => {
							if (!accepted) {
								shed++
								consecutiveSheds++
								if (shed % 50 === 1) console.log(`shed ${shed} packets under backpressure`)
								if (consecutiveSheds === 20) {
									quietUntil = Date.now() + 500
									console.log(
										`engine still full after 20 sheds (${shed} total); pausing pushes 500ms and dropping at the source`
									)
								}
							} else {
								consecutiveSheds = 0
							}
						})
						.catch(err => console.error('push failed:', (err as Error).message))
				}
			}
		})
		child?.on('exit', code => {
			console.log(`ffmpeg exited (${code}); audio input spent`)
			// Only the current child clears the slot: a hangup followed by
			// a new call installs a replacement first, and the old child's
			// delayed exit must not untrack it.
			if (encoder === child) {
				encoder = null
				audioWriter?.close()
				audioWriter = null
			}
		})
	}

	const stopEncoder = (): void => {
		try {
			audioWriter?.close()
		} catch {
			// ignore
		}
		audioWriter = null
		if (encoder) {
			try {
				encoder.stdout?.destroy()
				encoder.kill('SIGKILL')
			} catch {
				// ignore
			}
			encoder = null
		}
	}

	// Mlow outbound: silence at voice cadence through the library pump, with
	// the grammar declared on the pump so a wiring mistake fails fast in the
	// library instead of shedding silently in the engine.
	const ensureSilencePump = (callId: string): void => {
		if (silencePump || audioFormat !== 'mlow') return
		let mlowShed = 0
		sock
			.startCallAudioPump(callId, makeSilenceCallAudioSource(), {
				audioFormat: 'mlow',
				onShed: total => {
					mlowShed = total
					if (mlowShed % 50 === 1) console.log(`shed ${mlowShed} mlow silence packets under backpressure`)
				}
			})
			.then(pump => {
				if (callId !== liveCallId) {
					pump.stop()
					return
				}
				silencePump = pump
				void pump.done.then(
					stats => console.log(`mlow silence pump ended: ${JSON.stringify(stats)}`),
					err => console.error('mlow silence pump failed:', (err as Error).message)
				)
			})
			.catch(err => console.error('mlow silence pump failed to start:', (err as Error).message))
	}

	const stopSilencePump = (): void => {
		silencePump?.stop()
		silencePump = null
	}

	// Outgoing video, started once per call when --video is set: ffmpeg
	// emits raw Annex-B, the splitter hands one AU per push to the bridge,
	// and the same child-scoping rules as audio apply.
	const ensureVideoEncoder = (): void => {
		if (videoEncoder || args.video === undefined || !liveCallId) return
		const callForChild = liveCallId
		void sock
			.openCallVideoWriter(callForChild)
			.then(writer => {
				if (liveCallId === callForChild && videoEncoder === child) {
					videoWriter = writer
				} else {
					writer.close()
				}
			})
			.catch(err => console.error('failed to open sync video writer:', (err as Error).message))

		const child = spawnVideoEncoder(args.video)
		videoEncoder = child
		const splitter = splitVideoAccessUnits()
		child.stdout?.on('data', (chunk: Buffer) => {
			if (child !== videoEncoder || callForChild !== liveCallId || !liveCallId) return
			for (const unit of splitter.push(new Uint8Array(chunk))) {
				if (videoWriter) {
					const accepted = videoWriter.tryWrite(unit)
					if (!accepted) {
						outboundVideoShed++
						if (outboundVideoShed % 50 === 1)
							console.log(`shed ${outboundVideoShed} video access units under backpressure`)
					}
				} else {
					void sock
						.pushCallVideo(liveCallId, unit)
						.then(accepted => {
							if (!accepted) {
								outboundVideoShed++
								if (outboundVideoShed % 50 === 1)
									console.log(`shed ${outboundVideoShed} video access units under backpressure`)
							}
						})
						.catch(err => console.error('video push failed:', (err as Error).message))
				}
			}
		})
		child.on('exit', code => {
			console.log(`ffmpeg (video) exited (${code})`)
			if (videoEncoder === child) {
				videoEncoder = null
				videoWriter?.close()
				videoWriter = null
			}
		})
	}

	const stopVideoEncoder = (): void => {
		try {
			videoWriter?.close()
		} catch {
			// ignore
		}
		videoWriter = null
		if (videoEncoder) {
			try {
				videoEncoder.stdout?.destroy()
				videoEncoder.kill('SIGKILL')
			} catch {
				// ignore
			}
			videoEncoder = null
		}
	}

	const onFrame = (frame: CallAudioFrame): void => {
		// Play what was negotiated, not what the example encodes: an mlow
		// call delivers mlow grammar, and muxing that as Opus plays noise.
		// Mlow decode has no ffmpeg path here, so it is counted and logged,
		// not played. Per-packet logging would drown the session.
		if (frame.codec !== audioFormat) {
			mismatched++
			if (mismatched % 50 === 1)
				console.error(
					`dropping peer packet outside the negotiated ${audioFormat} promise (codec=${frame.codec}, total=${mismatched})`
				)
			return
		}
		if (frame.codec !== 'opus') {
			mlowHeard++
			if (mlowHeard % 50 === 1)
				console.log(`heard ${mlowHeard} mlow peer packets (no mlow decoder here, counted not played)`)
			return
		}
		try {
			// Native Opus frames are routed through the playout jitter buffer.
			pushAudioFrame?.(frame)
		} catch (err) {
			console.error('dropping an unmuxable peer packet:', (err as Error).message)
		}
	}

	const hangup = async (): Promise<void> => {
		if (!liveCallId) return
		const id = liveCallId
		liveCallId = undefined
		stopSink?.()
		stopSink = undefined
		stopPlaying?.()
		stopPlaying = undefined
		pushAudioFrame = undefined
		// Stopped before the hangup lands: a new ring answered while endCall
		// is in flight must find a clear slot, not the dying capture.
		stopEncoder()
		stopSilencePump()
		stopVideoEncoder()
		stopVideoPlayback()
		try {
			const end = await sock.endCall(id)
			console.log('hangup:', end)
		} catch (err) {
			console.error('hangup failed:', (err as Error).message)
		}
	}

	sock.ev.on('call.media', event => {
		// Every lifecycle event is logged, not just the happy ones: a call
		// whose media never comes up says so here (relay-allocate-failed
		// with a code, media-setup-failed with a detail), and the absence
		// of any relay line at all means the plane never started.
		const detail = {
			code: event.code,
			detail: event.detail,
			from: event.from,
			to: event.to,
			sending: event.sending,
			peerExpects: event.peerExpects,
			state: event.state
		}
		const filled = Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined))
		console.log(`media ${event.kind} on ${event.callId}`, Object.keys(filled).length > 0 ? JSON.stringify(filled) : '')
		// Proven by pcap against a working native call: production relays
		// take the allocate inside the DTLS+SCTP DataChannel tunnel and
		// drop the cleartext allocate this UDP pipe sends, while answering
		// consent pings. A timeout here with ping/pong flowing is that gap,
		// not the network, and only the tunnel (bridge lane) closes it.
		if (event.kind === 'relay-allocate-timed-out') {
			if (rtcProvider) {
				console.log('media never came up: the allocate went unanswered inside the DTLS+SCTP tunnel.')
			} else {
				console.log(
					'media never came up: the allocate went unanswered. Production relays expect it inside the DTLS+SCTP tunnel; this pipe has none.'
				)
			}
		}
		if (event.kind === 'audio-codec-switched') console.log(`codec ${event.from} -> ${event.to}`)
		if (event.kind === 'video-upgrade-requested')
			console.log(`peer asks for video on ${event.callId} (state=${event.state ?? 'n/a'}); press v to accept`)
		if (event.kind === 'video-state-changed' && event.callId === liveCallId)
			console.log(`video state -> ${event.state ?? 'n/a'}`)
		if (event.kind === 'ended' && event.callId === liveCallId) {
			console.log('peer ended the call')
			void hangup().then(() => {
				if (args.command === 'dial') process.exit(0)
			})
		}
	})

	const answer = async (call: WACallEvent): Promise<void> => {
		if (liveCallId !== undefined || accepting) {
			console.log(`rejecting overlapping call from ${call.from} while busy`)
			await sock.rejectCall(call.id, call.chatId).catch(err => console.error('reject failed:', (err as Error).message))
			return
		}
		accepting = true
		try {
			// Accept with the offered profile, not a hardcoded one: the
			// captain's real call negotiated Mlow while this pushed Opus, so
			// every packet died in the engine and the queue shed forever.
			const format = negotiatedAudioFormat(call.audio)
			const id = await sock.acceptCall(call.id, format)
			liveCallId = id
			muted = false
			mlowHeard = 0
			mismatched = 0
			stopSink?.()
			audioFormat = format
			stopSink = sock.onCallAudio(id, onFrame)
			// Outbound follows the promise: opus runs the ffmpeg encoder,
			// mlow runs the silence pump. Never both. The encoder gate
			// refuses mlow calls, and the pump declares mlow up front.
			if (format === 'opus') ensureEncoder()
			else ensureSilencePump(id)
			startPlayback()
			if (args.video !== undefined) {
				// A video offer accepted straight into video, mirroring
				// voip-cli where answering with --video starts the plane.
				await sock.acceptCallVideo(id).catch(err => console.error('accept video failed:', (err as Error).message))
				startVideoPlayback()
				ensureVideoEncoder()
			}
			console.log('answered', id, `with ${format}`)
		} finally {
			accepting = false
		}
	}

	sock.ev.on('call', events => {
		for (const call of events as WACallEvent[]) {
			if (call.status !== 'offer') continue
			console.log(`incoming ${call.isVideo ? 'video' : 'voice'} call from ${call.from}`)
			if (args.command === 'listen' && args.accept) {
				answer(call).catch(err => console.error('accept failed:', (err as Error).message))
			} else {
				console.log('rejecting (run listen --accept to answer)')
				sock.rejectCall(call.id, call.chatId).catch(err => console.error('reject failed:', (err as Error).message))
			}
		}
	})

	if (args.command === 'dial') {
		// Outbound dials promise opus: there is no offer to read, and opus
		// is the only grammar ffmpeg encodes here. The peer negotiates
		// against it and the bridge reports a mismatch instead of noise.
		audioFormat = 'opus'
		const id = await sock.dialCall(args.peer!, 'opus')
		liveCallId = id
		mlowHeard = 0
		mismatched = 0
		stopSink = sock.onCallAudio(id, onFrame)
		ensureEncoder()
		startPlayback()
		if (args.video !== undefined) {
			await sock.retryCallVideoUpgrade(id).catch(err => console.error('video upgrade failed:', (err as Error).message))
			await sock.startCallVideo(id).catch(err => console.error('video start failed:', (err as Error).message))
			startVideoPlayback()
			ensureVideoEncoder()
		}
		console.log('dialed', id, '- waiting for answer (q hangs up)')
	} else {
		console.log(args.accept ? 'listening (answering every ring)' : 'listening (rejecting every ring)')
	}

	readline.emitKeypressEvents(process.stdin)
	if (process.stdin.isTTY) process.stdin.setRawMode(true)
	// Raw mode swallows SIGINT: Ctrl+C arrives here as a keypress, not a
	// signal, so without this branch the process outlives every crash and
	// no keyboard interrupt reaches it. Relay sockets are tracked for the
	// same reason: an open UDP handle keeps the loop alive on its own.
	let shuttingDown = false
	const shutdown = (exitCode: number): void => {
		if (shuttingDown) return
		shuttingDown = true
		if (process.stdin.isTTY) process.stdin.setRawMode(false)
		for (const relay of liveRelays) {
			try {
				relay.close()
			} catch {
				// Already gone; the loop is what matters.
			}
		}
		liveRelays.clear()
		stopEncoder()
		stopSilencePump()
		stopVideoEncoder()
		stopVideoPlayback()
		stopPlaying?.()
		void hangup()
			.catch(() => undefined)
			.then(() => sock.end(undefined).catch(() => undefined))
			.then(() => process.exit(exitCode))
		// Never strand: a wedged hangup must not hold the exit open.
		setTimeout(() => process.exit(exitCode), 3000).unref()
	}
	process.on('SIGINT', () => shutdown(130))
	process.stdin.on('keypress', (_chunk, key: { name?: string; sequence?: string; ctrl?: boolean } | undefined) => {
		// Ctrl+C never becomes SIGINT in raw mode; it arrives as a keypress
		// and takes the same shutdown as the signal.
		if (key?.sequence === '\x03' || (key?.name === 'c' && key?.ctrl)) {
			shutdown(130)
			return
		}
		if (key?.name === 'q') {
			void hangup().then(async () => {
				await sock.end(undefined).catch(err => console.error('socket close failed:', (err as Error).message))
				process.exit(0)
			})
		}
		if (key?.name === 'm' && liveCallId) {
			muted = !muted
			sock.setCallMuted(liveCallId, muted).then(
				() => console.log(muted ? 'muted' : 'unmuted'),
				err => console.error('mute failed:', (err as Error).message)
			)
		}
		if (key?.name === 's' && liveCallId) {
			const id = liveCallId
			void Promise.all([sock.getCallMediaStats(id), sock.getCallAudioBuffer(id)])
				.then(([stats, buffer]: [CallMediaStats, CallAudioBuffer]) =>
					console.log(
						`format=${audioFormat} decoded=${stats.audioFramesDecoded} delivered=${stats.audioFramesDelivered} shed-at-push=${shed} no-encoder=${stats.outboundFramesWithoutEncoder} sink-dropped=${stats.audioSinkDropped} mlow-heard=${mlowHeard} mismatched=${mismatched} out-queue=${buffer.outboundQueued}/${buffer.outboundCapacity} in-queue=${buffer.inboundQueued}/${buffer.inboundCapacity} video-shed=${outboundVideoShed} video-sink-dropped=${stats.videoSinkDropped} keyframe-requests=${stats.peerKeyframeRequests}`
					)
				)
				.catch(err => console.error('stats failed:', (err as Error).message))
		}
		if (key?.name === 'v' && liveCallId) {
			const id = liveCallId
			void sock
				.retryCallVideoUpgrade(id)
				.then(() => sock.startCallVideo(id))
				.then(() => {
					startVideoPlayback()
					ensureVideoEncoder()
					console.log('video started')
				})
				.catch(err => console.error('video start failed:', (err as Error).message))
		}
		if (key?.name === 'k' && liveCallId) {
			const id = liveCallId
			void sock
				.requestCallKeyframe(id, 'immediate')
				.then(() => console.log('keyframe requested'))
				.catch(err => console.error('keyframe request failed:', (err as Error).message))
		}
		if (key?.name === 'd' && liveCallId) {
			sock
				.getCallVideoDiagnostics(liveCallId)
				.then(diagnostics =>
					console.log(
						`self=${diagnostics.selfState} peer=${diagnostics.peerState} upgrade-timeout=${diagnostics.upgradeTimeoutMs}ms`
					)
				)
				.catch(err => console.error('video diagnostics failed:', (err as Error).message))
		}
	})
}

// Guarded so the Ogg helpers stay importable without booting a socket.
import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch(err => {
		console.error('fatal:', err instanceof Error ? err.message : err)
		process.exit(1)
	})
}
