/** Voice/video CLI using managed calls. Requires ffmpeg and ffplay for media. */
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import readline from 'node:readline'
import { pathToFileURL } from 'node:url'
import P from 'pino'
import qrcode from 'qrcode-terminal'
import {
	fetchLatestWaWebVersion,
	makeWASocket,
	useMultiFileAuthState,
	type CallSession,
	type CallSessionOptions
} from '../lib/index.js'
import { makeFfmpegCallMedia } from './call-media.ts'

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
	if (argv.includes('--danger-skip-cert-verify')) {
		const url = get('--socket') ?? process.env.SOCKET_URL
		if (!url || !['127.0.0.1', '[::1]', 'localhost'].includes(new URL(url).hostname))
			throw new Error('--danger-skip-cert-verify requires a loopback mock socket')
	}
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

const main = async (): Promise<void> => {
	const args = parseArgs(process.argv.slice(2))
	const { state } = await useMultiFileAuthState(args.authDir)
	const { version } = await fetchLatestWaWebVersion()
	const sock = makeWASocket({
		auth: state,
		version,
		logger: P({ level: 'warn' }),
		...(args.socketUrl ? { waWebSocketUrl: args.socketUrl } : {}),
		...(args.dangerSkipCertVerify ? { dangerSkipCertChainVerify: true } : {})
	})
	const cancellation = new AbortController()
	let current: CallSession | undefined
	let starting = false
	let muted = false
	let videoActive = false
	let videoRequested = false
	let closing: Promise<void> | undefined
	let resolveDone!: () => void
	const done = new Promise<void>(resolve => {
		resolveDone = resolve
	})
	const shutdown = (code: number): Promise<void> =>
		(closing ??= Promise.resolve().then(async () => {
			cancellation.abort()
			try {
				await sock.end(undefined)
			} catch (error) {
				console.error('socket cleanup failed:', error)
				code = 1
			} finally {
				if (process.stdin.isTTY) process.stdin.setRawMode(false)
				process.stdin.off('keypress', onKey)
				process.stdin.pause()
				process.off('SIGINT', onInterrupt)
				process.exitCode = code
				resolveDone()
			}
		}))
	const onInterrupt = () => {
		void shutdown(130)
	}
	process.on('SIGINT', onInterrupt)
	const report = (error: unknown) => {
		if (!closing) console.error(error instanceof Error ? error.message : error)
	}
	const options = (): CallSessionOptions => ({
		signal: cancellation.signal,
		video: args.video !== undefined ? true : undefined,
		media: makeFfmpegCallMedia(args)
	})
	const watch = async (opening: Promise<CallSession>, initialVideo: boolean): Promise<void> => {
		starting = true
		try {
			const call = await opening
			current = call
			starting = false
			muted = false
			videoActive = initialVideo
			videoRequested = false
			console.log('call', call.id, 'peer', call.peer)
			const closed = await call.closed
			if (current === call) current = undefined
			console.log('call closed:', closed.reason)
			if (closed.error) report(closed.error)
			if (args.command === 'dial') await shutdown(0)
		} catch (error) {
			report(error)
			if (args.command === 'dial') await shutdown(1)
		} finally {
			starting = false
		}
	}
	const onKey = (_chunk: unknown, key: { name?: string; sequence?: string; ctrl?: boolean } | undefined) => {
		if (key?.sequence === '\x03' || (key?.name === 'c' && key.ctrl)) {
			void shutdown(130)
			return
		}
		if (key?.name === 'q') {
			void shutdown(0)
			return
		}
		const call = current
		if (!call) return
		if (key?.name === 'm') {
			muted = !muted
			void call.setMuted(muted).catch(report)
		}
		if (key?.name === 's') void call.stats().then(stats => console.log(stats), report)
		if (key?.name === 'k') void call.video.requestKeyframe('immediate').catch(report)
		if (key?.name === 'd') void call.video.diagnostics().then(stats => console.log(stats), report)
		if (key?.name === 'v') {
			if (videoActive) {
				void call.video.stop().then(() => {
					videoActive = false
				}, report)
			} else {
				args.video ??= 'camera'
				const upgrade = videoRequested ? call.video.accept() : call.video.start()
				void upgrade.then(() => {
					videoActive = true
					videoRequested = false
				}, report)
			}
		}
	}
	const connected = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			sock.ev.off('connection.update', listener)
			reject(new Error('Connect timeout'))
		}, 60_000)
		const listener = (update: { connection?: string; qr?: string; lastDisconnect?: { error?: Error } }) => {
			if (update.qr) showPairingQr(update.qr)
			if (update.connection === 'open' || update.connection === 'close') {
				clearTimeout(timeout)
				sock.ev.off('connection.update', listener)
				if (update.connection === 'open') resolve()
				else reject(update.lastDisconnect?.error ?? new Error('Connection closed'))
			}
		}
		sock.ev.on('connection.update', listener)
	})
	sock.ev.on('connection.update', update => {
		if (update.connection === 'close' && !closing) void shutdown(1)
	})
	sock.ev.on('call.media', event => {
		console.log('media', event.kind, event.callId)
		if (event.callId !== current?.id) return
		if (event.kind === 'video-state-changed' && event.state === 0) videoActive = false
		if (event.kind === 'video-upgrade-requested') {
			videoRequested = true
			if (args.video !== undefined)
				void current.video.accept().then(() => {
					videoActive = true
					videoRequested = false
				}, report)
			else console.log('peer requests video; press v to accept')
		}
	})
	sock.ev.on('call', events => {
		for (const offer of events) {
			if (offer.status !== 'offer') continue
			if (args.command !== 'listen' || !args.accept || starting || current) {
				void sock.rejectCall(offer.id, offer.chatId).catch(report)
			} else void watch(sock.voip.accept(offer, options()), args.video !== undefined || offer.isVideo === true)
		}
	})
	try {
		// Explicit loopback-only mock transport; normal calls use the library default.
		if (args.mockUdp) {
			const { makeUdpRelayProvider } = await import('../src/__tests__/e2e/udp-relay-provider.ts')
			await sock.setRelayTransportProvider(makeUdpRelayProvider())
		}
		await connected
		readline.emitKeypressEvents(process.stdin)
		if (process.stdin.isTTY) process.stdin.setRawMode(true)
		process.stdin.on('keypress', onKey)
		console.log('keys: m mute, s stats, v video, k keyframe, d diagnostics, q quit')
		if (args.command === 'dial') await watch(sock.voip.call(args.peer!, options()), args.video !== undefined)
		else
			console.log(
				args.accept ? 'listening and accepting calls' : 'listening and rejecting calls; use --accept to answer'
			)
		await done
	} catch (error) {
		await shutdown(1)
		throw error
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	void main().catch(error => {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	})
}
