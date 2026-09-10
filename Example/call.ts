/**
 * Voice calls with real audio: dial or answer a call, stream microphone or
 * file audio through ffmpeg, play the peer back through ffplay.
 *
 * This mirrors examples/voip-cli in the whatsapp-rust repo in behavior —
 * dial/accept a real call, encoded packets both ways, mute, stats, hangup —
 * adapted to what JavaScript can do. There is no MLOW encoder here, so audio
 * travels as Opus, the in-profile escape the bridge accepts under the `opus`
 * promise: ffmpeg encodes a file or microphone to 16 kHz mono Opus, a small
 * Ogg demuxer splits the stream back into packets for pushing, and received
 * packets are wrapped in Ogg pages for ffplay on stdin. The library only
 * transports the opaque packets, exactly like voip-cli's ffmpeg video path,
 * and the relay itself is reached over UDP from Node — no WebRTC, no browser
 * needed.
 *
 * Usage:
 *   node Example/call.ts dial <peer-jid> [--audio-file path | --mic [device]] [--auth dir] [--socket url]
 *   node Example/call.ts listen [--accept] [--audio-file path | --mic [device]] [--auth dir] [--socket url]
 *
 * During a call: `m` mute/unmute, `s` print media stats, `q` hang up and quit.
 * A dialed call exits after it ends; listen keeps serving the next ring.
 *
 * Requires ffmpeg and ffplay on PATH (checked at startup with a clear error)
 * and nothing else: only node builtins besides the built package in lib/.
 * Microphone capture uses ffmpeg device syntax for the OS (`-f alsa -i
 * <device>` on Linux, `-f avfoundation` / `-f dshow` elsewhere). Without
 * --audio-file or --mic nothing is pushed and the call stays quiet.
 *
 * Against the Bartender mock, point --socket at it the way the e2e suite
 * does; SOCKET_URL is honored too.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import readline from 'node:readline'
import {
	makeWASocket,
	useMultiFileAuthState,
	type CallAudioFrame,
	type CallMediaStats,
	type WACallEvent
} from '../lib/index.js'

const usage = (): never => {
	console.error(
		[
			'usage:',
			'  node Example/call.ts dial <peer-jid> [--audio-file path | --mic [device]] [--auth dir] [--socket url]',
			'  node Example/call.ts listen [--accept] [--audio-file path | --mic [device]] [--auth dir] [--socket url]',
			'',
			'--danger-skip-cert-verify is testing-only (Bartender mock with a',
			'self-signed cert). Never use it against production.',
			'',
			'keys during a call: m mute, s stats, q hang up'
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
	let buffered = new Uint8Array(0)
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

/** Wrap bare Opus packets in Ogg pages for ffplay's stdin. */
export const muxOggOpus = (): { headerPages(): Uint8Array[]; page(packet: Uint8Array): Uint8Array } => {
	const serial = (Math.random() * 0xffffffff) >>> 0
	let sequence = 0
	// Samples at 48 kHz; ffmpeg emits 20 ms frames, 960 samples each. Only the
	// displayed clock reads this, never the audio, so a wrong guess here
	// skews time, not sound.
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
		page(packet: Uint8Array): Uint8Array {
			granule += 960
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
	authDir: string
	socketUrl: string
	dangerSkipCertVerify: boolean
}

const parseArgs = (argv: string[]): CallExampleArgs => {
	const get = (flag: string): string | undefined => {
		const index = argv.indexOf(flag)
		return index >= 0 ? argv[index + 1] : undefined
	}
	const command = argv[0]
	if (command !== 'dial' && command !== 'listen') usage()
	const peer = command === 'dial' ? argv[1] : undefined
	if (command === 'dial' && !peer) usage()
	const audioFile = get('--audio-file')
	const micIndex = argv.indexOf('--mic')
	const mic = micIndex >= 0 ? (argv[micIndex + 1] ?? 'default') : undefined
	if (audioFile && mic !== undefined) {
		console.error('pick one audio input: --audio-file or --mic')
		process.exit(2)
	}
	return {
		command,
		peer,
		accept: command === 'listen' && argv.includes('--accept'),
		audioFile,
		mic,
		authDir: get('--auth') ?? './call-auth',
		socketUrl: get('--socket') ?? process.env.SOCKET_URL ?? 'wss://127.0.0.1:8080/ws/chat',
		dangerSkipCertVerify: argv.includes('--danger-skip-cert-verify')
	}
}

/** ffmpeg turns a file or microphone into 16 kHz mono Opus on stdout. */
const spawnOpusEncoder = (args: CallExampleArgs): ChildProcess | null => {
	if (!args.audioFile && args.mic === undefined) return null
	const input: string[] =
		args.audioFile !== undefined ? ['-re', '-i', args.audioFile] : ['-f', 'alsa', '-i', args.mic ?? 'default']
	const ffmpeg = spawn('ffmpeg', [...input, '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-f', 'opus', 'pipe:1'], {
		stdio: ['ignore', 'pipe', 'inherit']
	})
	ffmpeg.on('error', err => console.error('ffmpeg failed to start:', (err as Error).message))
	return ffmpeg
}

/** ffplay renders muxed Ogg Opus fed on stdin. Returns a writer for pages. */
const spawnOpusPlayer = (): { write(page: Uint8Array): void; stop(): void } => {
	const ffplay = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-nodisp', '-autoexit', '-i', 'pipe:0'], {
		stdio: ['pipe', 'ignore', 'inherit']
	})
	ffplay.on('error', err => console.error('ffplay failed to start:', (err as Error).message))
	return {
		write: page => {
			if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.write(page)
		},
		stop: () => {
			ffplay.stdin?.end()
		}
	}
}

// ── the call ──

const main = async (): Promise<void> => {
	requireBinary('ffmpeg')
	requireBinary('ffplay')
	const args = parseArgs(process.argv.slice(2))

	const { state } = await useMultiFileAuthState(args.authDir)
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
		auth: state,
		logger: logger as never,
		waWebSocketUrl: args.socketUrl,
		...(args.dangerSkipCertVerify ? { dangerSkipCertChainVerify: true as const } : {})
	})
	// UDP pipe to the relay: the core builds every datagram, this only ships
	// bytes. Same shape as the e2e helper, inlined so the example stands alone.
	const dgram = await import('node:dgram')
	await sock.setRelayTransportProvider({
		async createRelayConnection(params, events) {
			const socket = dgram.createSocket('udp4')
			await new Promise<void>((resolve, reject) => {
				socket.once('error', reject)
				socket.bind(0, () => resolve())
			})
			let opened = false
			socket.on('message', (message: Buffer) => {
				if (!opened) {
					opened = true
					events.onOpen()
				}
				events.onPacket(new Uint8Array(message))
			})
			socket.on('close', () => events.onClose())
			queueMicrotask(() => {
				if (!opened) {
					opened = true
					events.onOpen()
				}
			})
			return {
				send: data => {
					socket.send(data, params.port, params.address)
				},
				close: async () => {
					socket.close()
				}
			}
		}
	})

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
	await connected
	console.log('connected as', sock.user?.id)

	let liveCallId: string | undefined
	let stopSink: (() => void) | undefined
	let muted = false
	let shed = 0
	let demux = demuxOggOpus()
	const mux = muxOggOpus()
	const player = spawnOpusPlayer()
	const playPage = (page: Uint8Array): void => player.write(page)
	for (const page of mux.headerPages()) playPage(page)
	let encoder: ChildProcess | null = null

	// The encoder runs only while a call is live: a file input exhausts, and
	// starting it at launch would spend the audio before anyone answers.
	const ensureEncoder = (): void => {
		if (encoder || (!args.audioFile && args.mic === undefined)) return
		encoder = spawnOpusEncoder(args)
		demux = demuxOggOpus()
		encoder?.stdout?.on('data', (chunk: Buffer) => {
			if (!liveCallId) return
			for (const packet of demux.push(new Uint8Array(chunk))) {
				void sock
					.pushCallAudio(liveCallId, packet)
					.then(accepted => {
						if (!accepted) {
							shed++
							if (shed % 50 === 1) console.log(`shed ${shed} packets under backpressure`)
						}
					})
					.catch(err => console.error('push failed:', (err as Error).message))
			}
		})
		encoder?.on('exit', code => {
			console.log(`ffmpeg exited (${code}); audio input spent`)
			encoder = null
		})
	}

	const stopEncoder = (): void => {
		encoder?.kill()
		encoder = null
	}

	const onFrame = (frame: CallAudioFrame): void => {
		try {
			playPage(mux.page(frame.data))
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
		try {
			const end = await sock.endCall(id)
			console.log('hangup:', end.outcome)
		} catch (err) {
			console.error('hangup failed:', (err as Error).message)
		}
		stopEncoder()
		player.stop()
	}

	sock.ev.on('call.media', event => {
		if (event.kind === 'relay-allocated') console.log('relay up for', event.callId)
		if (event.kind === 'audio-codec-switched') console.log(`codec ${event.from} -> ${event.to}`)
		if (event.kind === 'ended' && event.callId === liveCallId) {
			console.log('peer ended the call')
			void hangup().then(() => {
				if (args.command === 'dial') process.exit(0)
			})
		}
	})

	const answer = async (call: WACallEvent): Promise<void> => {
		const id = await sock.acceptCall(call.id, 'opus')
		liveCallId = id
		stopSink?.()
		stopSink = sock.onCallAudio(id, onFrame)
		ensureEncoder()
		console.log('answered', id)
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
		const id = await sock.dialCall(args.peer!, 'opus')
		liveCallId = id
		stopSink = sock.onCallAudio(id, onFrame)
		ensureEncoder()
		console.log('dialed', id, '- waiting for answer (q hangs up)')
	} else {
		console.log(args.accept ? 'listening (answering every ring)' : 'listening (rejecting every ring)')
	}

	readline.emitKeypressEvents(process.stdin)
	if (process.stdin.isTTY) process.stdin.setRawMode(true)
	process.stdin.on('keypress', (_chunk, key: { name?: string } | undefined) => {
		if (key?.name === 'q') {
			void hangup().then(() => process.exit(0))
		}
		if (key?.name === 'm' && liveCallId) {
			muted = !muted
			sock.setCallMuted(liveCallId, muted).then(
				() => console.log(muted ? 'muted' : 'unmuted'),
				err => console.error('mute failed:', (err as Error).message)
			)
		}
		if (key?.name === 's' && liveCallId) {
			sock
				.getCallMediaStats(liveCallId)
				.then((stats: CallMediaStats) =>
					console.log(
						`decoded=${stats.audioFramesDecoded} delivered=${stats.audioFramesDelivered} shed-at-push=${shed} sink-dropped=${stats.audioSinkDropped}`
					)
				)
				.catch(err => console.error('stats failed:', (err as Error).message))
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
