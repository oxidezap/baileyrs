/**
 * PCM voice and H.264 video calls using ffmpeg/ffplay.
 * node Example/call.ts dial <peer-jid> --mic
 * node Example/call.ts listen --accept --mic
 * Add --video [camera|testsrc|file|url] for video.
 * Keys: m mute, s stats, v video, k keyframe, d video diagnostics, q quit.
 */
import { writeFileSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import process from 'node:process'
import readline from 'node:readline'
import qrcode from 'qrcode-terminal'
import {
	fetchLatestWaWebVersion,
	makeWASocket,
	useMultiFileAuthState,
	type CallPcmFrame,
	type CallPcmWriter,
	type CallVideoWriter,
	type WACallEvent
} from '../lib/index.js'
import {
	requireBinary,
	spawnPcmEncoder,
	spawnPcmPlayer,
	spawnVideoEncoder,
	spawnVideoPlayer,
	samplesToS16le,
	splitPcm16Frames,
	splitVideoAccessUnits,
	auHasKeyframe
} from './call-media.ts'

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
			'--mock-udp selects cleartext relay transport for a loopback mock only.',
			'--danger-skip-cert-verify is testing-only (Bartender mock with a',
			'self-signed cert). Never use it against production.',
			'',
			'keys during a call: m mute, s stats, v video toggle, k keyframe, d video diagnostics, q hang up'
		].join('\n')
	)
	process.exit(2)
}

interface CallExampleArgs {
	command: 'dial' | 'listen'
	peer?: string
	accept: boolean
	audioFile?: string
	mic?: string

	video?: string
	authDir: string
	socketUrl: string | undefined
	dangerSkipCertVerify: boolean
	mockUdp: boolean
}

export const parseArgs = (argv: string[]): CallExampleArgs => {
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

	const command = rawCommand === 'dial' || rawCommand === 'listen' ? rawCommand : usage()
	const peer = command === 'dial' ? argv[1] : undefined
	if (command === 'dial' && (!peer || peer.startsWith('--'))) usage()
	const audioFile = get('--audio-file')
	const mic = getOptional('--mic', 'default')
	if (audioFile && mic !== undefined) {
		console.error('pick one audio input: --audio-file or --mic')
		process.exit(2)
	}

	const video = getOptional('--video', 'camera')
	if (argv.includes('--mock-udp')) {
		const url = get('--socket') ?? process.env.SOCKET_URL
		if (!url || !['127.0.0.1', '[::1]', 'localhost'].includes(new URL(url).hostname)) {
			throw new Error('--mock-udp requires a loopback --socket or SOCKET_URL')
		}
	}
	return {
		mockUdp: argv.includes('--mock-udp'),
		command,
		peer,
		accept: (command === 'listen' && argv.includes('--accept')) || video !== undefined,
		audioFile,
		mic,
		video,
		authDir: get('--auth') ?? './baileys_auth_info',

		socketUrl: get('--socket') ?? process.env.SOCKET_URL,
		dangerSkipCertVerify: argv.includes('--danger-skip-cert-verify')
	}
}

export const showPairingQr = (qr: string): boolean => {
	let rendered: string | undefined
	qrcode.generate(qr, { small: true }, code => {
		rendered = code
	})
	if (!rendered) {
		console.error('pairing needed: could not render the QR')
		return false
	}
	const text = `scan this QR with your phone:\n${rendered}\n`
	// `CON` is Windows-only: on headless POSIX it is an ordinary relative
	// filename, and writing there would persist the credential to disk.
	const devices = process.platform === 'win32' ? ['CON'] : ['/dev/tty']
	for (const device of devices) {
		try {
			writeFileSync(device, text)
			return true
		} catch {
			// No controlling terminal: fall through to the instructions.
		}
	}
	console.error('pairing needed: re-run attached to a terminal to scan the QR')
	return false
}

export const isTerminalCallUpdate = (call: Pick<WACallEvent, 'status'>): boolean =>
	call.status === 'timeout' || call.status === 'reject' || call.status === 'terminate'

/** Remember signaling-only endings even when no media handle ever existed. */
export const makeCallTerminalTracker = () => {
	const deadCallIds = new Set<string>()
	const markDead = (callId: string): void => {
		deadCallIds.add(callId)
		// A listener can run indefinitely; do not retain every call it saw.
		if (deadCallIds.size > 64) {
			const oldest = deadCallIds.values().next()
			if (!oldest.done) deadCallIds.delete(oldest.value)
		}
	}
	return {
		markDead,
		isDead: (callId: string): boolean => deadCallIds.has(callId),
		recordUpdate: (call: Pick<WACallEvent, 'id' | 'status'>): boolean => {
			if (!isTerminalCallUpdate(call)) return false
			markDead(call.id)
			return true
		}
	}
}

const main = async (): Promise<void> => {
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
	// Installed before the first post-socket await: relay setup, the
	// connection wait and its 60-second timeout can all reject before the
	// full shutdown below exists, and those paths must still end the
	// socket (durability barriers) instead of exiting bare. Upgraded to
	// the full shutdown once it is defined.
	shutdownExampleOnFatal = () => {
		void sock
			.end(undefined)
			.catch(() => undefined)
			.then(() => process.exit(1))
	}
	// Listen before the relay provider waits for the client, so an open
	// emitted during that await is still observed.
	const connected = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('connect timeout')), 60_000)
		sock.ev.on('connection.update', update => {
			// The QR is a live pairing credential: stdout and stderr both
			// land in shell transcripts, service logs and CI collectors, so
			// neither may carry it. The controlling terminal is local to
			// the operator's session — redirection never captures it — so
			// the secret goes there, and only there.
			if (update.qr) showPairingQr(update.qr)
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
	// Cleartext UDP is confined to the local mock and never selected by TLS options.
	if (args.mockUdp) {
		const { makeUdpRelayProvider } = await import('../src/__tests__/e2e/udp-relay-provider.ts')
		await sock.setRelayTransportProvider(makeUdpRelayProvider())
	}

	await connected
	console.log('connected as', sock.user?.id)

	let liveCallId: string | undefined
	let accepting = false
	// Both signaling-only terminal updates and media endings can race an
	// accept/dial await. The continuation consults the same bounded tracker.
	const terminalCalls = makeCallTerminalTracker()
	let stopPcmSink: (() => void) | undefined
	let muted = false
	let shed = 0
	// The application's outbound audio source promise.

	let inboundPcmFrames = 0
	let outboundGenerated = 0
	let outboundAccepted = 0
	let outboundPushErrors = 0
	let pcmPlayer: { write(data: Uint8Array): void; stop(): void } | undefined
	const startPcmPlayback = (): void => {
		pcmPlayer = spawnPcmPlayer()
		stopPcmSink?.()
		stopPcmSink = sock.onCallPcm(liveCallId!, (frame: CallPcmFrame) => {
			if (frame.callId !== liveCallId) return
			inboundPcmFrames++
			if (inboundPcmFrames === 1) console.log('inbound audio pcm16/16000/mono')
			pcmPlayer?.write(samplesToS16le(frame.data))
		})
	}
	// Peer video goes to its own ffplay window, minted with the call like
	// audio playback — never into the audio Ogg stream.
	let stopVideoSink: (() => void) | undefined
	let stopVideoPlayer: (() => void) | undefined
	let hasSeenInboundKeyframe = false
	let videoActive = false
	let pendingPeerVideoUpgrade = false
	let player: { write(unit: Uint8Array): void; stop(): void } | null = null
	let playerOrientation: number | null = null
	let pendingOrientation: number | null = null
	let inboundFrameCount = 0

	const startVideoPlayback = (): void => {
		if (stopVideoSink) return
		hasSeenInboundKeyframe = false
		player = null
		playerOrientation = null
		pendingOrientation = null
		inboundFrameCount = 0
		const currentCallId = liveCallId
		stopVideoSink = sock.onCallVideo(liveCallId!, frame => {
			if (frame.callId !== liveCallId) return
			inboundFrameCount++
			const orientation = frame.orientation & 0x03
			if (playerOrientation !== null && orientation !== playerOrientation) {
				console.log(`🎥 peer camera orientation changed to ${orientation * 90}° — correcting preview`)
				pendingOrientation = orientation
			}
			if (frame.keyframe) {
				hasSeenInboundKeyframe = true
				if (pendingOrientation !== null) {
					player?.stop()
					player = spawnVideoPlayer(pendingOrientation)
					playerOrientation = pendingOrientation
					pendingOrientation = null
				}
			} else if (!hasSeenInboundKeyframe) {
				if (currentCallId && inboundFrameCount % 15 === 1) {
					void sock.requestCallKeyframe(currentCallId, 'immediate').catch(() => {})
				}
				return
			}
			if (!player) {
				player = spawnVideoPlayer(orientation)
				playerOrientation = orientation
				pendingOrientation = null
			}
			if (inboundFrameCount % 30 === 1 || frame.keyframe) {
				console.log(`video: ${frame.data.length}B keyframe=${frame.keyframe} orientation=${frame.orientation}`)
			}
			player.write(frame.data)
		})
		stopVideoPlayer = () => {
			player?.stop()
			player = null
		}
		if (currentCallId) {
			void sock.requestCallKeyframe(currentCallId, 'immediate').catch(() => {})
		}
	}
	const stopVideoPlayback = (): void => {
		hasSeenInboundKeyframe = false
		stopVideoSink?.()
		stopVideoSink = undefined
		stopVideoPlayer?.()
		stopVideoPlayer = undefined
	}
	let encoder: ChildProcess | null = null
	let audioWriter: CallPcmWriter | null = null
	let videoEncoder: ChildProcess | null = null
	let videoWriter: CallVideoWriter | null = null
	let outboundVideoShed = 0
	// The PCM encoder starts only after a call is live. Starting it before an
	// answer would consume file input before the media handle exists.
	const ensureEncoder = (): void => {
		if (encoder || (!args.audioFile && args.mic === undefined) || !liveCallId) return
		// Checked here, not at startup: a sourceless dial and a
		// signaling-only listen never spawn ffmpeg, so they must not
		// require it either.
		requireBinary('ffmpeg')
		const callForChild = liveCallId
		void sock
			.openCallPcmWriter(callForChild)
			.then(writer => {
				if (liveCallId === callForChild && encoder === child) {
					audioWriter = writer
				} else {
					writer.close()
				}
			})
			.catch(err => console.error('failed to open sync audio writer:', (err as Error).message))

		const child = spawnPcmEncoder(args)
		encoder = child
		const stream = splitPcm16Frames()
		child?.stdout?.on('data', (chunk: Buffer) => {
			if (child !== encoder || callForChild !== liveCallId || !liveCallId) return
			for (const packet of stream.push(new Uint8Array(chunk))) {
				outboundGenerated++
				if (audioWriter) {
					try {
						const accepted = audioWriter.tryWrite(packet)
						if (!accepted) {
							shed++
							if (shed % 50 === 1) console.log(`shed ${shed} packets under backpressure`)
						} else {
							outboundAccepted++
						}
					} catch (err) {
						outboundPushErrors++
						console.error('audio push error:', (err as Error).message)
					}
				} else {
					void sock
						.pushCallPcm(liveCallId, packet)
						.then(accepted => {
							if (!accepted) {
								shed++
								if (shed % 50 === 1) console.log(`shed ${shed} packets under backpressure`)
							} else {
								outboundAccepted++
							}
						})
						.catch(err => {
							outboundPushErrors++
							console.error('push failed:', (err as Error).message)
						})
				}
			}
		})
		child?.on('close', code => {
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

	// Outgoing video, started once per call when --video is set or when
	// upgraded via 'v': ffmpeg emits raw Annex-B, the splitter hands one
	// AU per push to the bridge, and the same child-scoping rules as audio apply.
	const ensureVideoEncoder = (): void => {
		if (videoEncoder || !liveCallId) return
		requireBinary('ffmpeg')
		const source = args.video ?? 'camera'
		args.video = source
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

		const child = spawnVideoEncoder(source)
		videoEncoder = child
		const splitter = splitVideoAccessUnits()
		let outboundAuCount = 0
		let seenFirstKeyframe = false
		const pushVideoUnit = (unit: Uint8Array): void => {
			const isKeyframe = auHasKeyframe(unit)
			if (!seenFirstKeyframe) {
				if (!isKeyframe) return
				seenFirstKeyframe = true
			}
			outboundAuCount++
			if (outboundAuCount % 30 === 1 || isKeyframe) {
				console.log(`🎥 OUT video: AU #${outboundAuCount} (${unit.length}B, keyframe=${isKeyframe})`)
			}
			if (videoWriter) {
				try {
					const accepted = videoWriter.tryWrite(unit)
					if (!accepted) {
						outboundVideoShed++
						if (outboundVideoShed % 50 === 1)
							console.log(`shed ${outboundVideoShed} video access units under backpressure`)
					}
				} catch (err) {
					console.error('video push error:', (err as Error).message)
				}
			} else if (liveCallId) {
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
		child.stdout?.on('data', (chunk: Buffer) => {
			if (child !== videoEncoder || callForChild !== liveCallId || !liveCallId) return
			for (const unit of splitter.push(new Uint8Array(chunk))) pushVideoUnit(unit)
		})
		child.on('close', code => {
			console.log(`ffmpeg (video) exited (${code})`)
			if (videoEncoder === child) {
				videoEncoder = null
				// Clean EOF on a finite --video file leaves the trailing
				// access unit buffered — no successor AUD delimits it.
				// Flush it before closing the writer or the final frame is
				// always dropped (a still image would send nothing at
				// all). A killed encoder may leave a partial NAL behind,
				// so only code 0 flushes.
				if (code === 0) {
					for (const unit of splitter.flush()) pushVideoUnit(unit)
				}
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

	const acceptOrStartVideo = async (id: string): Promise<void> => {
		if (pendingPeerVideoUpgrade) {
			pendingPeerVideoUpgrade = false
			try {
				await sock.acceptCallVideo(id)
				videoActive = true
				startVideoPlayback()
				ensureVideoEncoder()
				console.log('🎥 peer video upgrade accepted')
				return
			} catch (err) {
				console.warn('acceptCallVideo failed, falling back to startCallVideo:', (err as Error).message)
			}
		}
		await sock.retryCallVideoUpgrade(id).catch(() => {})
		await sock.startCallVideo(id)
		videoActive = true
		startVideoPlayback()
		ensureVideoEncoder()
		console.log('🎥 video started')
	}

	const stopVideo = async (id: string): Promise<void> => {
		videoActive = false
		stopVideoEncoder()
		stopVideoPlayback()
		await sock.stopCallVideo(id).catch(err => console.error('stop video failed:', (err as Error).message))
		console.log('🎥 video stopped (downgraded to voice)')
	}

	const logCallStats = async (id: string, label: string): Promise<void> => {
		try {
			const [stats, buffer] = await Promise.all([sock.getCallMediaStats(id), sock.getCallAudioBuffer(id)])
			console.log(
				`${label} stats source=pcm generated=${outboundGenerated} accepted=${outboundAccepted} shed-at-push=${shed} push-errors=${outboundPushErrors} no-encoder=${stats.outboundFramesWithoutEncoder} decoded=${stats.audioFramesDecoded} delivered=${stats.audioFramesDelivered} inbound-pcm=${inboundPcmFrames} sink-dropped=${stats.audioSinkDropped} out-queue=${buffer.outboundQueued}/${buffer.outboundCapacity} in-queue=${buffer.inboundQueued}/${buffer.inboundCapacity} video-shed=${outboundVideoShed} video-sink-dropped=${stats.videoSinkDropped} keyframe-requests=${stats.peerKeyframeRequests}`
			)
		} catch (err) {
			console.error(`${label} stats failed:`, (err as Error).message)
		}
	}

	const hangup = async (): Promise<void> => {
		if (!liveCallId) return
		const id = liveCallId
		liveCallId = undefined
		videoActive = false
		pendingPeerVideoUpgrade = false
		stopPcmSink?.()
		stopPcmSink = undefined
		pcmPlayer?.stop()
		pcmPlayer = undefined
		// Stopped before the hangup lands: a new ring answered while endCall
		// is in flight must find a clear slot, not the dying capture.
		stopEncoder()
		stopVideoEncoder()
		stopVideoPlayback()
		await logCallStats(id, 'final')
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
		if (event.kind === 'audio-codec-switched') {
			console.log(`audio codec switched ${event.from ?? 'unknown'} -> ${event.to ?? 'unknown'}`)
		}
		if (event.kind === 'audio-codec-source-fixed') {
			console.log(`audio source fixed sending=${event.sending ?? 'unknown'} peer=${event.peerExpects ?? 'unknown'}`)
		}
		if (event.kind === 'video-upgrade-requested') {
			pendingPeerVideoUpgrade = true
			console.log(`🎥 peer asks for video on ${event.callId} (state=${event.state ?? 'n/a'}); press v to accept`)
			if (args.video !== undefined && liveCallId === event.callId && !videoActive) {
				console.log('auto-accepting peer video upgrade request (--video is set)...')
				void acceptOrStartVideo(liveCallId).catch(err =>
					console.error('auto-accept video failed:', (err as Error).message)
				)
			}
		}
		if (event.kind === 'video-state-changed' && event.callId === liveCallId) {
			console.log(`video state -> ${event.state ?? 'n/a'}`)
			if (event.state === 0 && videoActive) {
				videoActive = false
				stopVideoEncoder()
				stopVideoPlayback()
				console.log('🎥 video stopped by peer (downgraded to voice)')
			}
		}
		// Terminal ids are remembered even for calls that are not live yet:
		// an `ended` landing while accept/dial is still pending must stop
		// the continuation below from starting capture for a dead call.
		if (event.kind === 'ended') terminalCalls.markDead(event.callId)
		if (event.kind === 'ended' && event.callId === liveCallId) {
			console.log('peer ended the call')
			void hangup().then(() => {
				if (args.command === 'dial') shutdown(0)
			})
		}
	})

	readline.emitKeypressEvents(process.stdin)
	if (process.stdin.isTTY) process.stdin.setRawMode(true)
	// Raw mode swallows SIGINT: Ctrl+C arrives here as a keypress, not a
	// signal, so without this branch the process outlives every crash and
	// no keyboard interrupt reaches it. Relay sockets are tracked for the
	// same reason: an open UDP handle keeps the loop alive on its own.
	// Declared before any dial/answer continuation: the fast-ended paths
	// below exit through here so auth-store barriers and ordered
	// WASM/transport teardown run instead of a bare process.exit.
	let shuttingDown = false
	const shutdown = (exitCode: number): void => {
		if (shuttingDown) return
		shuttingDown = true
		if (process.stdin.isTTY) process.stdin.setRawMode(false)
		stopEncoder()
		stopVideoEncoder()
		stopVideoPlayback()
		// Only the app-level hangup is force-bounded: the socket teardown
		// below owns the auth-store durability barriers, and killing it
		// mid-flush would lose session writes. Every wait inside sock.end
		// is bounded by construction (release grace, close grace, quiescing
		// flush), so it cannot strand the exit the way a wedged hangup can.
		void Promise.race([
			hangup().catch(() => undefined),
			new Promise<void>(resolve => setTimeout(resolve, 3000).unref())
		])
			.then(() => sock.end(undefined).catch(() => undefined))
			.then(() => process.exit(exitCode))
	}
	// Registered before any dial/answer await: stdin is already in raw mode
	// above, so a Ctrl+C during a stalled dial would otherwise become a
	// keypress with no listener and the terminal would never be restored.
	process.on('SIGINT', () => shutdown(130))
	process.stdin.on('keypress', (_chunk, key: { name?: string; sequence?: string; ctrl?: boolean } | undefined) => {
		// Ctrl+C never becomes SIGINT in raw mode; it arrives as a keypress
		// and takes the same shutdown as the signal.
		if (key?.sequence === '\x03' || (key?.name === 'c' && key?.ctrl)) {
			shutdown(130)
			return
		}
		if (key?.name === 'q') {
			// Through shutdown, not a bare exit: it restores the raw
			// terminal above plus the relay cleanup, hangup and socket
			// teardown the direct path skipped.
			shutdown(0)
		}
		if (key?.name === 'm' && liveCallId) {
			muted = !muted
			sock.setCallMuted(liveCallId, muted).then(
				() => console.log(muted ? 'muted' : 'unmuted'),
				err => console.error('mute failed:', (err as Error).message)
			)
		}
		if (key?.name === 's' && liveCallId) {
			void logCallStats(liveCallId, 'live')
		}
		if (key?.name === 'v' && liveCallId) {
			const id = liveCallId
			if (videoActive) {
				void stopVideo(id)
			} else {
				void acceptOrStartVideo(id).catch(err => console.error('video start failed:', (err as Error).message))
			}
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

	// Set once the socket and its shutdown sequence exist: a fatal error
	// before that (arg parsing, auth state) has nothing to clean up, while
	// anything after must run the same relay close, socket end and terminal
	// restore as an orderly shutdown instead of a bare exit.
	shutdownExampleOnFatal = shutdown

	const answer = async (call: WACallEvent): Promise<void> => {
		if (liveCallId !== undefined || accepting) {
			console.log(`rejecting overlapping call from ${call.from} while busy`)
			await sock.rejectCall(call.id, call.chatId).catch(err => console.error('reject failed:', (err as Error).message))
			return
		}
		accepting = true
		try {
			// Inbound video follows the offer, outbound capture stays
			// opt-in: a remote video offer without --video still shows the
			// peer, but never starts the local camera by itself.
			const acceptVideo = args.video !== undefined || call.isVideo === true
			const id = await sock.acceptCallPcm(call.id, acceptVideo)
			if (terminalCalls.isDead(id) || terminalCalls.isDead(call.id)) {
				console.log('call ended while accepting; not starting capture for', id)
				return
			}
			liveCallId = id
			muted = false
			inboundPcmFrames = 0
			outboundGenerated = 0
			outboundAccepted = 0
			outboundPushErrors = 0
			shed = 0
			ensureEncoder()
			startPcmPlayback()
			if (acceptVideo) {
				videoActive = true
				startVideoPlayback()
				if (args.video !== undefined) {
					ensureVideoEncoder()
					console.log('🎥 video started with call accept')
				} else {
					console.log('🎥 showing peer video (no local camera without --video)')
				}
			}
			console.log('answered', id, 'with pcm16')
		} catch (err) {
			// A sink or player can fail after capture starts. Never leave the
			// encoder or playback process alive when setup did not complete.
			if (liveCallId !== undefined) await hangup()
			throw err
		} finally {
			accepting = false
		}
	}

	sock.ev.on('call', events => {
		for (const call of events as WACallEvent[]) {
			// Signaling can end a ringing call without ever creating media, so
			// call.media:ended alone cannot fence an in-flight accept.
			if (terminalCalls.recordUpdate(call)) {
				if (call.id === liveCallId) void hangup()
				continue
			}
			if (call.status !== 'offer') continue
			if (terminalCalls.isDead(call.id)) continue
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
		const withVideo = args.video !== undefined
		const id = await sock.dialCallPcm(args.peer!, withVideo)
		if (terminalCalls.isDead(id)) {
			console.log('call ended while dialing; not starting capture for', id)
			shutdown(0)
			return
		}
		liveCallId = id
		inboundPcmFrames = 0
		outboundGenerated = 0
		outboundAccepted = 0
		outboundPushErrors = 0
		shed = 0
		ensureEncoder()
		startPcmPlayback()
		if (withVideo) {
			videoActive = true
			startVideoPlayback()
			ensureVideoEncoder()
			console.log('🎥 video started with call dial')
		}
		console.log('dialed', id, 'with pcm16 - waiting for answer (q hangs up)')
	} else {
		console.log(args.accept ? 'listening (answering every ring)' : 'listening (rejecting every ring)')
	}
}

// Guarded so the Ogg helpers stay importable without booting a socket.
import { pathToFileURL } from 'node:url'

/** Assigned once main owns a socket: fatal errors clean up before exiting. */
let shutdownExampleOnFatal: ((exitCode: number) => void) | undefined

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch(err => {
		console.error('fatal:', err instanceof Error ? err.message : err)
		// A dial/setup failure after the socket exists still owns relay
		// handles, an open socket and a raw terminal: run the orderly
		// shutdown (durability barriers included) instead of a bare exit.
		// Before the socket exists there is nothing to clean — exit now.
		// (shutdown() exits on its own once cleanup finishes, so the
		// fallback exit runs only when no shutdown was ever installed.)
		if (shutdownExampleOnFatal) shutdownExampleOnFatal(1)
		else process.exit(1)
	})
}
