import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { endianness } from 'node:os'

export const requireBinary = (name: 'ffmpeg' | 'ffplay'): void => {
	if (spawnSync(name, ['-version'], { stdio: 'ignore' }).status !== 0) {
		throw new Error(name + ' not found on PATH; install it to run Example/call.ts')
	}
}

/** ffmpeg turns a file or microphone into 16 kHz mono signed PCM on stdout. */
export const spawnPcmEncoder = (args: { audioFile?: string; mic?: string }): ChildProcess | null => {
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
		[...input, '-ac', '1', '-ar', '16000', '-flush_packets', '1', '-f', 's16le', 'pipe:1'],
		{
			stdio: ['ignore', 'pipe', 'inherit']
		}
	)
	ffmpeg.on('error', err => console.error('ffmpeg failed to start:', (err as Error).message))
	return ffmpeg
}

/**
 * ffmpeg emits `s16le` while `Int16Array` reads host order: identical on
 * little-endian hosts, byte-swapped everywhere else. Branch once here so
 * the fast reinterpret path costs nothing on LE and big-endian hosts
 * decode explicitly instead of shipping swapped samples.
 */
const HOST_LITTLE_ENDIAN: boolean = endianness() === 'LE'

/** Decode one s16le window to samples, honoring the host byte order. */
const s16leToSamples = (bytes: Uint8Array, offset: number, samples: number): Int16Array => {
	const byteOffset = bytes.byteOffset + offset
	if (HOST_LITTLE_ENDIAN && byteOffset % Int16Array.BYTES_PER_ELEMENT === 0) {
		return new Int16Array(bytes.buffer, byteOffset, samples)
	}
	const out = new Int16Array(samples)
	if (HOST_LITTLE_ENDIAN) {
		new Uint8Array(out.buffer).set(bytes.subarray(offset, offset + samples * 2))
		return out
	}
	const view = new DataView(bytes.buffer, byteOffset, samples * 2)
	for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true)
	return out
}

/** Encode samples to s16le bytes for the ffplay pipe, honoring host order. */
export const samplesToS16le = (samples: Int16Array): Buffer => {
	if (HOST_LITTLE_ENDIAN) {
		return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
	}
	const out = Buffer.allocUnsafe(samples.length * 2)
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
	for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true)
	return out
}

export const splitPcm16Frames = (
	frameSamples = 960
): { push(bytes: Uint8Array): Int16Array[]; flush(): Int16Array[] } => {
	if (!Number.isInteger(frameSamples) || frameSamples <= 0) throw new Error('frameSamples must be a positive integer')
	const frameBytes = frameSamples * 2
	const scratch = new Uint8Array(frameBytes)
	let pendingLength = 0
	return {
		push(bytes) {
			const frames: Int16Array[] = []
			let offset = 0
			if (pendingLength > 0) {
				const copied = Math.min(frameBytes - pendingLength, bytes.length)
				scratch.set(bytes.subarray(0, copied), pendingLength)
				pendingLength += copied
				offset = copied
				if (pendingLength < frameBytes) return frames
				// The remainder of this chunk (or the next push) reuses scratch.
				frames.push(s16leToSamples(scratch, 0, frameSamples).slice())
				pendingLength = 0
			}

			while (offset + frameBytes <= bytes.length) {
				frames.push(s16leToSamples(bytes, offset, frameSamples))
				offset += frameBytes
			}

			if (offset < bytes.length) {
				const remaining = bytes.length - offset
				scratch.set(bytes.subarray(offset), 0)
				pendingLength = remaining
			}
			return frames
		},
		flush() {
			if (pendingLength !== 0) throw new Error('PCM16 input ended with a partial frame')
			return []
		}
	}
}

/** ffmpeg turns a camera, file/URL or test pattern into baseline H.264 on stdout. */
export const spawnVideoEncoder = (source: string): ChildProcess => {
	const input: string[] =
		source === 'testsrc'
			? ['-re', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=15']
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
			'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=15,format=yuv420p,setparams=range=limited:color_primaries=unknown:color_trc=unknown:colorspace=unknown',
			'-r',
			'15',
			'-fps_mode',
			'cfr',
			'-c:v',
			'libx264',
			'-profile:v',
			'baseline',
			'-level:v',
			'3.1',
			'-pix_fmt',
			'yuv420p',
			'-preset',
			'veryfast',
			'-tune',
			'zerolatency',
			'-g',
			'45',
			'-keyint_min',
			'45',
			'-sc_threshold',
			'0',
			'-b:v',
			'1980k',
			'-maxrate',
			'1980k',
			'-bufsize',
			'495k',
			'-x264-params',
			'repeat-headers=1:sliced-threads=0:threads=1',
			'-bsf:v',
			'h264_metadata=aud=insert',
			'-an',
			'-f',
			'h264',
			'pipe:1'
		],
		{ stdio: ['ignore', 'pipe', 'inherit'] }
	)
	ffmpeg.on('error', err => console.error('ffmpeg (video) failed to start:', (err as Error).message))
	return ffmpeg
}

export const spawnPcmPlayer = (): { write(bytes: Uint8Array): void; stop(): void } => {
	// Checked here, not at startup: signaling-only runs never play audio.
	requireBinary('ffplay')
	const ffplay = spawn(
		'ffplay',
		[
			'-hide_banner',
			'-loglevel',
			'warning',
			'-nodisp',
			'-f',
			's16le',
			'-ch_layout',
			'mono',
			'-sample_rate',
			'16000',
			'pipe:0'
		],
		{ stdio: ['pipe', 'ignore', 'inherit'] }
	)
	ffplay.on('error', err => console.error('ffplay PCM failed to start:', (err as Error).message))
	// A dead ffplay (headless host, lost audio device, malformed input)
	// fails the next write with an async EPIPE on the stdin Writable — not
	// a sync throw the try/catch below could see. Without this listener
	// that 'error' event is unhandled and takes down the example.
	ffplay.stdin?.on('error', err => console.error('ffplay PCM pipe broke:', (err as Error).message))
	// A stalled-but-alive ffplay stops consuming while frames keep
	// arriving: write() then returns false and Node queues unboundedly,
	// so shed while the drain is pending instead of buffering the call.
	let needDrain = false
	ffplay.stdin?.on('drain', () => {
		needDrain = false
	})
	return {
		write: bytes => {
			const stdin = ffplay.stdin
			if (!stdin || stdin.destroyed) return
			if (needDrain) return
			try {
				if (stdin.write(bytes) === false) {
					needDrain = true
					console.log('ffplay PCM stalled: shedding until drain')
				}
			} catch {
				// ignore
			}
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

const MAX_VIDEO_AU_BUFFER = 4 * 1024 * 1024

/** Split a raw Annex-B byte stream into access units on AUD boundaries (NAL type 9). */
export const splitVideoAccessUnits = (): {
	push(bytes: Uint8Array): Uint8Array[]
	flush(): Uint8Array[]
} => {
	let buffered: Uint8Array = new Uint8Array(0)
	let scanPos = 0
	let audStarts: number[] = []
	let seenAud = false

	return {
		push(bytes: Uint8Array): Uint8Array[] {
			if (bytes.length === 0) return []
			const prevLen = buffered.length
			if (prevLen === 0) {
				buffered = bytes
				scanPos = 0
			} else {
				const merged = new Uint8Array(prevLen + bytes.length)
				merged.set(buffered)
				merged.set(bytes, prevLen)
				buffered = merged
				// Four bytes back, not three: a chunk ending exactly after
				// `00 00 00 01` leaves a start code whose header arrives in
				// the next chunk, and a 3-byte overlap re-enters past it —
				// seeing `00 00 01` rejected as preceded-by-zero and losing
				// the AUD boundary. Classifications inside the rescan
				// window are dropped and re-derived so the overlap cannot
				// record the same start twice.
				scanPos = Math.max(0, prevLen - 4)
				audStarts = audStarts.filter(start => start < scanPos)
			}

			if (buffered.length > MAX_VIDEO_AU_BUFFER) {
				buffered = new Uint8Array(0)
				scanPos = 0
				audStarts = []
				seenAud = false
				return []
			}

			for (let i = scanPos; i + 3 <= buffered.length; i++) {
				if (buffered[i] === 0 && buffered[i + 1] === 0) {
					let nalPos = -1
					if (i + 4 <= buffered.length && buffered[i + 2] === 0 && buffered[i + 3] === 1) {
						nalPos = i + 4
					} else if (buffered[i + 2] === 1) {
						if (i === 0 || buffered[i - 1] !== 0) {
							nalPos = i + 3
						}
					}
					if (nalPos >= 0 && nalPos < buffered.length) {
						const nalType = buffered[nalPos]! & 0x1f
						if (nalType === 9) {
							seenAud = true
							audStarts.push(i)
						}
					}
				}
			}

			const units: Uint8Array[] = []
			if (seenAud) {
				if (audStarts.length === 1 && audStarts[0]! > 0) {
					const offset = audStarts[0]!
					buffered = buffered.slice(offset)
					audStarts[0] = 0
				}
				if (audStarts.length >= 2) {
					for (let n = 0; n + 1 < audStarts.length; n++) {
						units.push(buffered.slice(audStarts[n]!, audStarts[n + 1]!))
					}
					const lastStart = audStarts[audStarts.length - 1]!
					buffered = buffered.slice(lastStart)
					audStarts = [0]
					scanPos = 1
				}
				return units
			}

			// Fallback if no AUD is present: split on start codes
			const allStarts: number[] = []
			for (let i = 0; i + 4 <= buffered.length; i++) {
				if (buffered[i] === 0 && buffered[i + 1] === 0 && buffered[i + 2] === 0 && buffered[i + 3] === 1) {
					allStarts.push(i)
				}
			}
			if (allStarts.length < 2) return units
			for (let n = 0; n + 1 < allStarts.length; n++) {
				units.push(buffered.slice(allStarts[n]!, allStarts[n + 1]!))
			}
			buffered = buffered.slice(allStarts[allStarts.length - 1]!)
			scanPos = 0
			return units
		},
		flush(): Uint8Array[] {
			// The trailing access unit has all its bytes — only a successor
			// AUD delimits it, so a finite source must flush it explicitly
			// on encoder exit or the final frame is always dropped. Nothing
			// classifiable buffered means nothing complete to return.
			if (!seenAud || audStarts.length === 0) return []
			const lastStart = audStarts[audStarts.length - 1]!
			if (lastStart >= buffered.length) return []
			const unit = buffered.slice(lastStart)
			buffered = new Uint8Array(0)
			scanPos = 0
			audStarts = []
			seenAud = false
			return [unit]
		}
	}
}

/** Map WhatsApp device orientation (0..=3) to an ffplay video filter string. */
export const orientationFilter = (orientation: number): string | null => {
	switch (orientation & 0x03) {
		case 0:
			return null
		case 1:
			return 'transpose=cclock'
		case 2:
			return 'hflip,vflip'
		case 3:
			return 'transpose=clock'
		default:
			return null
	}
}

/** True when the AU carries an IDR slice or parameter set (SPS/PPS). */
export const auHasKeyframe = (au: Uint8Array): boolean => {
	for (let i = 0; i + 3 <= au.length; i++) {
		if (au[i] === 0 && au[i + 1] === 0) {
			let nalPos = -1
			if (i + 4 <= au.length && au[i + 2] === 0 && au[i + 3] === 1) {
				nalPos = i + 4
			} else if (au[i + 2] === 1) {
				if (i === 0 || au[i - 1] !== 0) {
					nalPos = i + 3
				}
			}
			if (nalPos >= 0 && nalPos < au.length) {
				const nalType = au[nalPos]! & 0x1f
				if (nalType === 5 || nalType === 7 || nalType === 8) {
					return true
				}
			}
		}
	}
	return false
}

/** ffplay renders raw H.264 fed on stdin. One window per call, like audio. */
export const spawnVideoPlayer = (orientation = 0): { write(unit: Uint8Array): void; stop(): void } => {
	requireBinary('ffplay')
	const filter = orientationFilter(orientation)
	const vfArgs = filter ? ['-vf', filter] : []
	const ffplay = spawn(
		'ffplay',
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-window_title',
			'WhatsApp Video Call',
			'-avioflags',
			'direct',
			'-fflags',
			'nobuffer',
			'-flags',
			'low_delay',
			'-probesize',
			'32',
			'-analyzeduration',
			'0',
			'-fpsprobesize',
			'0',
			'-max_delay',
			'0',
			'-framedrop',
			'-use_wallclock_as_timestamps',
			'1',
			'-f',
			'h264',
			'-framerate',
			'15',
			...vfArgs,
			'-i',
			'pipe:0'
		],
		{ stdio: ['pipe', 'ignore', 'inherit'] }
	)
	ffplay.on('error', err => console.error('ffplay (video) failed to start:', (err as Error).message))
	// Same async-EPIPE hazard as the audio player above: a dead viewer
	// surfaces it on the stdin stream, outside any try/catch.
	ffplay.stdin?.on('error', err => console.error('ffplay (video) pipe broke:', (err as Error).message))
	// Same stall hazard: shed while the drain is pending rather than
	// queueing access units without bound.
	let needDrain = false
	ffplay.stdin?.on('drain', () => {
		needDrain = false
	})
	return {
		write: unit => {
			const stdin = ffplay.stdin
			if (!stdin || stdin.destroyed) return
			if (needDrain) return
			try {
				if (stdin.write(unit) === false) {
					needDrain = true
					console.log('ffplay (video) stalled: shedding until drain')
				}
			} catch {
				// ignore
			}
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
