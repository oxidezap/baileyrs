import type { CallSessionOptions, CallVideoFrame } from '../lib/index.js'
import { processInput, processSink, restartableProcessInput } from './call-process.ts'
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
			if (pendingLength % 2 !== 0) throw new Error('PCM16 input ended with a partial sample')
			if (pendingLength === 0) return []
			scratch.fill(0, pendingLength)
			const frame = s16leToSamples(scratch, 0, frameSamples).slice()
			pendingLength = 0
			return [frame]
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
	let seenSlice = false

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
				seenSlice = false
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
						if (nalType === 1 || nalType === 5) seenSlice = true
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

			return units
		},
		flush(): Uint8Array[] {
			// The trailing access unit has all its bytes — only a successor
			// AUD delimits it, so a finite source must flush it explicitly
			// on encoder exit or the final frame is always dropped. Nothing
			// classifiable buffered means nothing complete to return.
			if (!seenAud && seenSlice) throw new Error('H.264 input requires AUD boundaries; use h264_metadata=aud=insert')
			if (!seenAud || audStarts.length === 0) return []
			const lastStart = audStarts[audStarts.length - 1]!
			if (lastStart >= buffered.length) return []
			const unit = buffered.slice(lastStart)
			buffered = new Uint8Array(0)
			scanPos = 0
			audStarts = []
			seenAud = false
			seenSlice = false
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

const spawnPlayback = (video: boolean, orientation = 0): ChildProcess => {
	requireBinary('ffplay')
	const filter = orientationFilter(orientation)
	const input = video
		? [
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
				...(filter ? ['-vf', filter] : []),
				'-i',
				'pipe:0'
			]
		: ['-nodisp', '-f', 's16le', '-ch_layout', 'mono', '-sample_rate', '16000', 'pipe:0']
	return spawn('ffplay', ['-hide_banner', '-loglevel', 'error', ...input], { stdio: ['pipe', 'ignore', 'inherit'] })
}

export const makeFfmpegCallMedia =
	(options: { audioFile?: string; mic?: string; video?: string }): NonNullable<CallSessionOptions['media']> =>
	(call, signal) => {
		signal.throwIfAborted()
		let encoder: ReturnType<typeof processInput<Int16Array>> | undefined
		let playback: ReturnType<typeof processSink> | undefined
		try {
			if (options.audioFile || options.mic !== undefined) {
				requireBinary('ffmpeg')
				const child = spawnPcmEncoder(options)
				if (child) encoder = processInput(child, signal, splitPcm16Frames())
			}
			const output = new WritableStream<Int16Array>({
				start(controller) {
					playback = processSink(spawnPlayback(false), signal, error => controller.error(error))
				},
				write(samples) {
					return playback!.write(samplesToS16le(samples))
				},
				abort() {
					return playback!.stop()
				}
			})
			return {
				audio: {
					input: encoder?.input,
					output,
					dispose: async () => {
						await Promise.all([encoder?.dispose(), playback?.stop()])
					}
				},
				video: (session, videoSignal) => {
					videoSignal.throwIfAborted()
					let capture: ReturnType<typeof restartableProcessInput<Uint8Array>> | undefined
					let player: ReturnType<typeof processSink> | undefined
					let orientation: number | undefined
					let pendingOrientation: number | undefined
					let seenKeyframe = false
					let frames = 0
					try {
						if (options.video !== undefined) {
							requireBinary('ffmpeg')
							capture = restartableProcessInput(
								() => processInput(spawnVideoEncoder(options.video!), videoSignal, splitVideoAccessUnits()),
								videoSignal
							)
						}
						let outputController: WritableStreamDefaultController
						const videoOutput = new WritableStream<CallVideoFrame>({
							start(controller) {
								outputController = controller
							},
							async write(frame) {
								frames++
								if (orientation !== undefined && orientation !== frame.orientation)
									pendingOrientation = frame.orientation
								if (frame.keyframe) {
									seenKeyframe = true
									if (pendingOrientation !== undefined) {
										await player?.stop()
										player = undefined
										orientation = pendingOrientation
										pendingOrientation = undefined
									}
								} else if (!seenKeyframe) {
									if (frames % 15 === 1) await session.video.requestKeyframe('immediate')
									return
								}
								if (!player) {
									orientation = frame.orientation
									player = processSink(spawnPlayback(true, orientation), videoSignal, error =>
										outputController.error(error)
									)
								}
								await player.write(frame.data)
							},
							abort() {
								return player?.stop()
							}
						})
						void call.video.requestKeyframe().catch(() => undefined)
						return {
							input: capture?.input,
							requestKeyframe: capture?.requestKeyframe,
							output: videoOutput,
							dispose: async () => {
								await Promise.all([capture?.dispose(), player?.stop()])
							}
						}
					} catch (error) {
						void capture?.dispose()
						void player?.stop()
						throw error
					}
				}
			}
		} catch (error) {
			void encoder?.dispose()
			void playback?.stop()
			throw error
		}
	}
