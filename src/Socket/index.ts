import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import {
	createWhatsAppClient,
	type WasmWhatsAppClient,
	type DevicePlatformType,
	initWasmEngine,
	type RunCompletionResult,
	type UploadMediaResult
} from '@oxidezap/whatsapp-rust-bridge'
import { encodeProtoCompat } from '../Compatibility/encode-proto.ts'
import { normalizeSocketAuthenticationState } from '../Compatibility/internal/auth-state.ts'
import { makeMutex } from '../Compatibility/internal/make-mutex.ts'
import { isNativeMemoryStore } from '../Compatibility/internal/native-memory-store.ts'
import { makeLazyTransactionKeyStore } from '../Compatibility/internal/signal-key-store.ts'
import { toBridgeMediaType } from '../Compatibility/media-type.ts'
import { bindSignalRepositoryContext, makeDefaultSignalRepository } from '../Compatibility/signal-repository.ts'
import { bridgeBusinessProfileToBaileys } from '../Compatibility/socket-results.ts'
import { makeStanzaResponseMethods } from '../Compatibility/stanza-responses.ts'
import { makeParticipatingRefreshHandler } from '../Compatibility/participating-refresh.ts'
import { makeTaggedMessageWaiter } from '../Compatibility/tagged-message-waiter.ts'
import { isRawNodeForwardingEnabled, WebSocketClient } from '../Compatibility/websocket-client.ts'
import { DEFAULT_CONNECTION_CONFIG, MEDIA_TYPES, type MediaType } from '../Defaults/index.ts'
import type {
	BinaryNode,
	AuthenticationCreds,
	ConnectionState,
	Contact,
	ReachoutTimelockState,
	SignalKeyStoreWithTransaction,
	UserFacingSocketConfig,
	WABusinessProfile,
	WAMessage,
	WAMessageKey,
	WAPresence
} from '../Types/index.ts'
import type Long from 'long'
import { DisconnectReason, WA_PRESENCES } from '../Types/index.ts'
import { assertArgumentDomain } from '../Utils/argument-domain.ts'
import { Boom } from '../Utils/boom.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import {
	_registerActiveBridgeClient,
	_unregisterActiveBridgeClient,
	downloadMediaMessage,
	MEDIA_DOWNLOAD_TYPES,
	type MediaDownloadType
} from '../Utils/messages.ts'
import { makeNativeCryptoProvider } from '../Utils/native-crypto-provider.ts'
import type { MediaDownloadOptions } from '../Utils/messages-media.ts'
import { wrapLegacyStore } from '../Utils/wrap-legacy-store.ts'
import { assertNodeErrorFree } from '../WABinary/generic-utils.ts'
import type { proto } from '../WAProto/runtime.ts'
import { makeBlockingMethods } from './blocking.ts'
import { makeBusinessMethods } from './business.ts'
import { makeChatActionMethods } from './chat-actions.ts'
import { makeContactMethods } from './contacts.ts'
import { makeCommunityMethods } from './communities.ts'
import { makeBridgeClientOwner } from './bridge-client-owner.ts'
import { warnUnsupportedConfig } from './unsupported-config.ts'
import { wrapBridgeClient } from './bridge-error-boundary.ts'
import { makeTerminalCloseReporter } from './terminal-close-reporter.ts'
import { mapConnectFailureToDisconnect } from './terminal-close.ts'
import { makeEventHandlers } from './events.ts'
import { makeGroupMethods } from './groups.ts'
import { makeInternalMethods, makeUnexpectedErrorReporter } from './internals.ts'
import { makeMessageMethods } from './messages.ts'
import { makeNewsletterMethods } from './newsletter.ts'
import { makePreKeyMethods } from './prekeys.ts'
import { makePresenceMethods } from './presence.ts'
import { makePrivacyMethods } from './privacy.ts'
import { makeServerQueryMethods } from './server-queries.ts'
import { makeProfileMethods } from './profile.ts'
import { mapReachoutTimelock } from './reachout.ts'
import { makeHttpClient, makeTransport } from './transport.ts'
import type { SocketContext } from './types.ts'
import { makeWithClient } from './client-operations.ts'
import { makeUSyncMethods } from './usync.ts'

let wasmInitialized = false

/**
 * Default mapping for the legacy `browser[1]` slot — preserved so users on the
 * existing `Browsers.macOS('Chrome')` style get the same `DeviceProps.platformType`
 * they always got. Anything outside this set falls back to `CHROME` (matching
 * the prior bridge behavior). Override with the explicit `deviceProps` config.
 */
const browserToPlatformType = (browser: string): DevicePlatformType => {
	switch (browser) {
		case 'Chrome':
			return 'CHROME'
		case 'Firefox':
			return 'FIREFOX'
		case 'Safari':
			return 'SAFARI'
		case 'Edge':
			return 'EDGE'
		case 'Opera':
			return 'OPERA'
		case 'Desktop':
			return 'DESKTOP'
		case 'Android':
			return 'ANDROID_PHONE'
		default:
			return 'CHROME'
	}
}

const COMPLETION_FAILURE_CODES = new Map<string, number>([
	['Generic', 400],
	['LoggedOut', 401],
	['TempBanned', 402],
	['AccountLocked', 403],
	['UnknownLogout', 406],
	['ClientOutdated', 405],
	['BadUserAgent', 409],
	['CatExpired', 413],
	['CatInvalid', 414],
	['NotFound', 415],
	['ClientUnknown', 418],
	['InternalServerError', 500],
	['Experimental', 501],
	['ServiceUnavailable', 503]
])

const completionFailureCode = (reason: string): number | undefined => {
	const named = COMPLETION_FAILURE_CODES.get(reason)
	if (named !== undefined) return named
	const unknown = /^Unknown\((-?\d+)\)$/.exec(reason)?.[1]
	return unknown === undefined ? undefined : Number(unknown)
}

/** Build the ws EventEmitter with auto-enable raw node forwarding */
const makeWASocket = (config: UserFacingSocketConfig) => {
	const fullConfig = { ...DEFAULT_CONNECTION_CONFIG, ...config }
	const { logger } = fullConfig
	// Against `config`, not `fullConfig`: only what this caller actually passed
	// is worth naming. Merging the defaults first would report every unsupported
	// option on every socket, including the ones nobody chose.
	warnUnsupportedConfig(config, logger)
	const auth = normalizeSocketAuthenticationState(fullConfig.auth)
	const getExposedKeys = makeLazyTransactionKeyStore(auth.keys, logger, fullConfig.transactionOpts)

	const ev = makeEventBuffer(logger)
	// Upstream mutates authState.creds before notifying user listeners. Register
	// this first so `ev.on('creds.update', saveCreds)` persists the merged state
	// rather than the pre-pair placeholder.
	ev.on('creds.update', update => Object.assign(auth.creds, update))
	let user: { id?: string; lid?: string } | undefined
	/** True once `init()` has finished wiring the client and started its read loop. */
	let initialized = false
	/** True while the socket's end handlers run — see `end`. */
	let runningEndHandlers = false

	/**
	 * Consumer teardown hooks, plus the socket's own. Declared here rather than
	 * beside their registrations so the owner below can close over the list
	 * before anything fills it.
	 */
	const socketEndHandlers: Array<(error: Error | undefined) => void | Promise<void>> = []

	/**
	 * Drain both auth stores, returning the FIRST failure rather than throwing
	 * so the caller can finish the rest of its work and still report it.
	 *
	 * Called through their owners on purpose: collecting the two methods into
	 * an array and invoking them bare drops the receiver, so a consumer store
	 * whose `flush()` touches `this` throws on `undefined` and the teardown
	 * publishes a close with the auth writes unpersisted.
	 */
	const flushStores = async (): Promise<unknown> => {
		let firstError: unknown
		try {
			await auth.store?.flush?.()
		} catch (e) {
			firstError ??= e
		}
		try {
			await autoWrappedStore?.flush?.()
		} catch (e) {
			firstError ??= e
		}
		return firstError
	}

	/**
	 * Single home for the bridge client's lifetime. `ws` below reads the current
	 * client from it, and this teardown closes `ws` — the cycle is fine because
	 * both directions only run once the socket is live.
	 */
	const owner = makeBridgeClientOwner({
		logger,
		/**
		 * Everything the socket owns beyond the client itself. Runs once, with
		 * the client still usable, whether or not one was ever adopted — a
		 * teardown that landed mid-init still has a transport to close and a
		 * store to drain.
		 */
		teardown: async (client, error) => {
			try {
				await ws.close()
			} catch {
				// The transport refused to close cleanly. Go straight at the
				// client so the disconnect still happens *before* the barrier
				// and flush below: `release` retries it, but that runs after the
				// flush, and the closing-session ratchet writes a disconnect
				// enqueues would then have nothing left to persist them.
				try {
					await client?.disconnect()
				} catch {
					/* ignore */
				}
			}

			if (client) {
				// Barrier: bridge cleanup paths fired during `disconnect()` may
				// emit `set()` calls that are still queued as microtasks /
				// `setImmediate` callbacks at this point. Two yields to the
				// event loop drain (1) the microtask queue and (2) the next
				// macrotask tick where wasm-bindgen async callbacks land.
				// Without this barrier the flushes below run before the bridge
				// has finished writing — a race that loses the last few sets
				// (typically the closing-session ratchet step).
				await new Promise(resolve => setImmediate(resolve))
				await new Promise(resolve => setImmediate(resolve))
			}

			const firstFlushError = await flushStores()

			// End handlers run before the flush error is rethrown: they are the
			// consumer's teardown hook, and a corrupt-on-shutdown auth store is
			// exactly when they most need to run.
			//
			// The flag makes a re-entrant `end()` from inside one of them a
			// no-op instead of a deadlock: shared cleanup used both directly and
			// as an end hook would otherwise be handed the very promise that is
			// waiting for it to return, and nothing would ever settle — no
			// release, and no terminal close until the watchdog.
			runningEndHandlers = true
			try {
				for (const handler of socketEndHandlers) {
					try {
						await handler(error)
					} catch (handlerError) {
						logger.error({ err: handlerError }, 'error in socket end handler')
					}
				}
			} finally {
				runningEndHandlers = false
			}

			if (firstFlushError) throw firstFlushError
		},

		release: async client => {
			// `disconnect()` before `free()` drains exactly one shape: a
			// `disconnect()` still in flight. Since bridge 0.21.1, freeing
			// with ordinary calls pending (`fetchBlocklist()`, `logout()`) is
			// safe — its `Drop` signals shutdown and aborts the background
			// tasks — but freeing mid-`disconnect()` still aborts the process
			// (`async-lock` panicking while panicking). See
			// `__tests__/bridge-free-safety.test.ts`.
			//
			// That shape is reachable: `WebSocketClient.close()` early-returns
			// when `closing`/`closed` is already set without awaiting the
			// disconnect it skipped, so `void sock.ws.close(); await sock.end()`
			// could otherwise reach `free()` with the first disconnect still
			// running. Awaiting it here is the belt to `ws.close()`'s braces.
			let disconnected = true
			try {
				await client.disconnect()
			} catch {
				disconnected = false
			}

			// Teardown already flushed, but only after its own disconnect
			// attempts. If those all failed and this one succeeded, the
			// closing-session ratchet writes it enqueues arrived after that
			// flush — with nothing left to persist them. Cheap enough to just
			// drain again.
			if (disconnected) {
				const lateFlushError = await flushStores()
				if (lateFlushError) logger.error({ err: lateFlushError }, 'failed to flush after the final disconnect')
			}

			// Unregister before freeing: `free()` is swallowed, so ordering it
			// last would leave the module-level pointer aimed at a client that is
			// already gone if anything between them threw.
			_unregisterActiveBridgeClient(wrapBridgeClient(client))
			try {
				client.free()
			} catch {
				/* ignore */
			}
		}
	})

	const ws = new WebSocketClient(fullConfig.waWebSocketUrl, fullConfig, () => owner.peek())

	let tagEpoch = 0
	// Per-socket random prefix avoids collisions between sockets created
	// in the same millisecond. Date.now()-based prefixes (the previous
	// implementation) collided in test loops and worker pools — every
	// socket started at `tagEpoch=0` and a tagged message-id collision
	// breaks waitForMessage routing.
	const tagPrefix = `${randomBytes(6).toString('base64url')}.`
	const generateMessageTag = () => `${tagPrefix}${tagEpoch++}`

	let pairedAccount: { platform?: string; businessName?: string } | undefined
	let cachedAccount: proto.IADVSignedDeviceIdentity | undefined
	// Holds the wrapped store created when the user passed legacy
	// `auth: { creds, keys }` instead of `auth.store`. We need it in
	// `end()` to drain the debounced `saveCreds` timer — `auth.store?.flush?.()`
	// covers the explicit-store path but not this one.
	let autoWrappedStore: { flush?: () => Promise<void> } | undefined
	// Mirrors the engine's `enable_auto_reconnect`, which defaults to on. Only
	// `sock.setAutoReconnect()` moves it, and the dispatcher reads it to tell a
	// transient drop from a terminal one.
	let autoReconnectEnabled = true
	/** Owns reporting the terminal close: once, after teardown, never not at all. */
	const terminalClose = makeTerminalCloseReporter({ logger })
	const runCompletionError = (completion: RunCompletionResult): Boom => {
		let statusCode = DisconnectReason.connectionClosed
		let message = 'Connection closed'
		if (completion.reason === 'unknown') {
			message = `Connection run ended: ${completion.detail}`
		} else if (completion.reason === 'stopped') {
			message = 'Connection run stopped'
		} else if (completion.reason === 'already-running') {
			message = 'Connection run was already running'
		} else if (completion.reason === 'auto-reconnect-disabled') {
			const protocol = completion.protocolError
			if (protocol?.kind === 'conflict') {
				statusCode = DisconnectReason.connectionReplaced
				message = 'Connection replaced'
			} else if (protocol?.kind === 'stream-error') {
				statusCode = mapConnectFailureToDisconnect(protocol.code)
			} else if (protocol?.kind === 'connect-failure') {
				statusCode = mapConnectFailureToDisconnect(completionFailureCode(protocol.reason))
			} else if (completion.connection?.kind === 'server-close') {
				message = completion.connection.reason
			}
		}
		return new Boom(message, { statusCode, data: { runCompletion: completion } })
	}
	const reportTerminalClose = (error: Error, publish: () => void) =>
		terminalClose.reportAfter(() => owner.close(error).finally(() => initPromise), publish)
	/**
	 * Held in a reporter rather than captured, because `sock.onUnexpectedError`
	 * is an assignable property: a consumer that replaces it has to be the one
	 * the socket's own failure paths reach afterwards.
	 */
	const unexpectedErrors = makeUnexpectedErrorReporter(logger)

	const ctx: SocketContext = {
		ev,
		logger,
		fullConfig,
		ws,
		reportUnexpectedError: unexpectedErrors.report,
		getUser: () => user,
		getMe: () => {
			const me = auth.creds.me
			const id = user?.id ?? me?.id
			if (!id) return undefined
			return { ...me, id, ...(user?.lid ? { lid: user.lid } : {}) }
		},
		setUser: u => {
			user = u
		},
		withClient: makeWithClient(getClient)
	}
	function getClient(): Promise<WasmWhatsAppClient> {
		// Teardown retains the client through closing to disconnect the transport.
		// Ordinary operations must stop being admitted when close() is called.
		if (owner.isClosing()) {
			return Promise.reject(new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed }))
		}

		// Otherwise gated on `initialized`, not merely on the client
		// existing. `adopt()` publishes it several awaits before
		// `setDeviceProps`, the account lookups and `run()`, so keying off
		// `peek()` alone would hand ordinary calls like `sendMessage()` a
		// half-built client whose read loop has not started — and skip the
		// `initError` check when startup later fails.
		if (initialized) {
			const ready = owner.peek()
			if (ready) return Promise.resolve(wrapBridgeClient(ready))
		}

		return initPromise.then(() => {
			// Closing may have started while initialization was pending.
			// This gate does not track admitted operations. Bridge 0.21.1 tolerates
			// free() during ordinary calls, but not during disconnect(); release
			// still awaits that drain before freeing the client.
			if (owner.isClosing()) {
				throw new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
			}

			if (initError) {
				throw new Boom('Bridge client failed to initialize: ' + initError.message, { statusCode: 500 })
			}

			const built = owner.peek()
			if (!built) throw new Boom('Client not initialized', { statusCode: 500 })
			return wrapBridgeClient(built)
		})
	}
	// The native repository delegates Signal state directly to the core and does
	// not need the standalone transaction facade. Keep that facade lazy for the
	// public authState and custom repository contracts that can observe it.
	const signalAuthState = {
		creds: auth.creds,
		keys: fullConfig.makeSignalRepository === makeDefaultSignalRepository ? auth.keys : getExposedKeys()
	}
	bindSignalRepositoryContext(signalAuthState, ctx)
	const signalRepository = fullConfig.makeSignalRepository(signalAuthState, logger)
	const devicesMutex = makeMutex()
	const messageMutex = makeMutex()
	const receiptMutex = makeMutex()
	const appStatePatchMutex = makeMutex()
	const notificationMutex = makeMutex()
	const activeCallContexts = new Map<string, { peer: string; callCreator: string }>()
	socketEndHandlers.push(() => activeCallContexts.clear())
	const groupMethods = makeGroupMethods(ctx)
	const communityMethods = makeCommunityMethods(ctx, groupMethods)
	const refreshParticipating = makeParticipatingRefreshHandler(ctx, {
		groupFetchAllParticipating: groupMethods.groupFetchAllParticipating,
		communityFetchAllParticipating: communityMethods.communityFetchAllParticipating
	})

	const eventHandlers = makeEventHandlers(ctx, {
		onPairSuccess: data => {
			pairedAccount = data
			owner
				.peek()
				?.getAccount?.()
				.then((acc: proto.IADVSignedDeviceIdentity | undefined) => {
					cachedAccount = acc ?? undefined
				})
				.catch(() => {})
		},
		onIncomingCall: event => {
			const { callId, callCreator, type } = event.action
			if (type === 'reject' || type === 'accept' || type === 'timeout' || type === 'terminate') {
				activeCallContexts.delete(callId)
			} else if (callCreator) {
				activeCallContexts.set(callId, { peer: event.from, callCreator })
			}
		},
		onDirtyState: event => refreshParticipating(event.dirtyType),
		/**
		 * The engine has stopped reconnecting, so this client is dead weight
		 * that only `free()` reclaims — `run()` returns `void`, so its loop
		 * exiting is otherwise invisible from here.
		 *
		 * Tearing down and reporting are both handed to the reporter: the close
		 * has to reach the consumer exactly once and only after this socket has
		 * released what it owns, or a replacement built in response overlaps it
		 * on the same auth folder.
		 */
		onTerminalClose: (error, publish) => {
			// `owner.close()`, not `end()`. `end()` short-circuits when called
			// from inside an end handler — it has to, or the handler awaits the
			// teardown waiting for it — and a terminal event raised from one of
			// those would then publish against an already-resolved promise,
			// letting a close listener build a replacement while the old client
			// is still owned. This waits for the real teardown, and cannot
			// deadlock because `reportAfter` runs it detached; nothing in the
			// teardown is waiting on this.
			reportTerminalClose(error, publish)
		},
		isAutoReconnectEnabled: () => autoReconnectEnabled,
		// Timers the dispatcher armed outlive the events that armed them, and
		// only the terminal-close path clears them. Ending the socket any other
		// way — `sock.end()`, an `await using` scope exiting — has to as well,
		// or one fires from a socket whose client is already freed.
		onCleanup: cleanup => socketEndHandlers.push(cleanup)
	})

	const init = async () => {
		if (!wasmInitialized) {
			initWasmEngine(logger, makeNativeCryptoProvider())
			wasmInitialized = true
		}

		// Defer to a microtask so callers have a turn to attach listeners
		// after `makeWASocket()` returns. Without this the emit fires
		// synchronously inside `init()` (before the function reaches its
		// first `await`), which is also before the caller ever sees `conn.ev`,
		// so any handler registered via `conn.ev.on('connection.update', …)`
		// or `conn.ev.process(…)` silently misses the initial 'connecting'
		// state. Bots like sung that drive UI off the lifecycle (spinners,
		// reconnection counters) end up tracking a state machine they never
		// got to enter, then crash when the next state ('open' / 'close')
		// references prerequisites that the missed event was supposed to set
		// up.
		queueMicrotask(() =>
			ev.emit('connection.update', {
				connection: 'connecting',
				receivedPendingNotifications: false,
				qr: undefined
			} as Partial<ConnectionState>)
		)

		// Auto-promote upstream-Baileys-style `auth: { creds, keys }` to a
		// `JsStoreCallbacks`-shaped store via `wrapLegacyStore`. The synthetic
		// `saveCreds` callback re-emits `creds.update` so the bot's existing
		// `ev.on('creds.update', saveCreds)` listener handles persistence —
		// matches the lifecycle hook every upstream-Baileys setup already
		// wires, so migration needs zero changes to the auth block.
		const useNativeMemory = auth.store ? isNativeMemoryStore(auth.store) : false
		let bridgeStore = useNativeMemory ? null : (auth.store ?? null)
		if (!bridgeStore && !useNativeMemory && auth.creds && auth.keys) {
			const legacyState = { creds: auth.creds, keys: auth.keys }
			const wrapped = await wrapLegacyStore(
				legacyState,
				async () => {
					ev.emit('creds.update', auth.creds!)
				},
				logger
			)
			bridgeStore = wrapped
			// Stash on the closure so `end()` can drain the debounced
			// `saveCreds` timer. `auth.store?.flush?.()` only runs when the
			// caller passed an explicit store — this auto-wrap path needs
			// its own hook.
			autoWrappedStore = wrapped
			logger.debug('auth: auto-wrapped legacy {creds, keys} via wrapLegacyStore')
		}
		if (useNativeMemory) logger.debug('auth: using socket-local native memory backend')

		const created = await createWhatsAppClient(
			makeTransport(fullConfig),
			makeHttpClient(fullConfig),
			eventHandlers,
			bridgeStore,
			fullConfig.cache ?? null,
			fullConfig.version,
			fullConfig.wantedPreKeyCount ?? null,
			// Passed through exactly as configured, never normalized by truthiness:
			// the bridge only honours a literal `true` here and rejects any
			// other truthy value at construction, so a `!!`/ternary-style
			// coercion could promote a malformed opt-out into an opt-in.
			// Absent stays strict.
			fullConfig.dangerSkipCertChainVerify
		)
		// `end()` can land while the client is still being built — a `sock.end()`
		// or `await using` right after `makeWASocket()` does exactly that. When
		// it has, `adopt` frees this client and tells us to stop: nothing else
		// would ever own it, and `run()` below would reconnect it forever
		// against a socket the caller already disposed.
		// `adopt` starts releasing the refused client; joining it here keeps
		// that work inside `initPromise`, which `Symbol.asyncDispose` awaits.
		if (!owner.adopt(created)) return owner.settled()

		// Fallback for standalone helpers like `downloadContentFromMessage`
		// that carry no socket reference. Registered wrapped so those helpers
		// reject with a caller stack too; the memoized wrap keeps the
		// unregister identity check working.
		_registerActiveBridgeClient(wrapBridgeClient(created), logger)

		// Replay a preference set before the client existed. `setAutoReconnect`
		// forwards through `client?.`, so `makeWASocket(cfg).setAutoReconnect(false)`
		// — the idiomatic first line — used to move only the JS mirror and leave
		// the engine retrying.
		if (!autoReconnectEnabled) created.setAutoReconnect(false)

		// Everything below talks to `created`, which stays valid for the whole
		// body, and re-checks `isClosing()` between awaits: once teardown has
		// started it owns this client, and issuing more bridge calls against it
		// races the release.
		if (fullConfig.pushName) {
			await created.setInitialPushName(fullConfig.pushName)
		}
		if (owner.isClosing()) return

		const [osName, browserName] = fullConfig.browser

		const deviceOs = browserName === 'Android' ? 'Android' : osName
		await created.setDeviceProps({
			os: deviceOs,
			platformType: browserToPlatformType(browserName),
			...fullConfig.deviceProps
		})
		if (owner.isClosing()) return

		const [jid, lid, account] = await Promise.all([
			created.getJid(),
			created.getLid(),
			created.getAccount().catch(() => undefined)
		])
		if (owner.isClosing()) return

		if (jid) {
			user = { id: jid, lid: lid ?? undefined }
		}

		if (account) {
			cachedAccount = account
		}

		// Android browser slot flips the noise-handshake identity to
		// `UserAgent.platform = ANDROID` (no `web_info`), mirroring upstream
		// Baileys PR #2201. Required for the server to deliver view_once payloads.
		if (browserName === 'Android') {
			await created.setClientProfile({ preset: 'android', osVersion: osName })
			if (owner.isClosing()) return
		}

		if (isRawNodeForwardingEnabled(ws)) {
			created.setRawNodeForwarding(true)
		}

		// Same race as above: teardown already owns and releases this client, so
		// starting the read loop now would run against a handle about to go.
		if (owner.isClosing()) return

		// `run()` deliberately returns immediately so callers can use the
		// client while supervision owns its background task. Registering the
		// completion observer after it is started is safe: bridge 0.21.0 admits
		// late observers against the stored result for this run generation.
		created.run()
		const observedClient = created
		void created
			.waitForRunCompletion()
			.then(
				completion => {
					// The owner identity is the socket generation fence. A completion
					// from a client that teardown already released must never close a
					// later socket using the same auth state.
					if (owner.isClosing() || owner.peek() !== observedClient) return
					const error = runCompletionError(completion)
					reportTerminalClose(error, () =>
						ev.emit('connection.update', {
							connection: 'close',
							lastDisconnect: { error, date: new Date() }
						} as Partial<ConnectionState>)
					)
				},
				error => {
					if (owner.isClosing() || owner.peek() !== observedClient) return
					const closeError = new Boom('Connection run ended without a completion result', {
						statusCode: DisconnectReason.connectionClosed
					})
					reportTerminalClose(closeError, () =>
						ev.emit('connection.update', {
							connection: 'close',
							lastDisconnect: { error: closeError, date: new Date() }
						} as Partial<ConnectionState>)
					)
					try {
						logger.error({ err: error }, 'bridge run completion observation failed')
					} catch {
						// A consumer logger cannot prevent the terminal cleanup above.
					}
				}
			)
			.catch(() => {
				// The reporter contains teardown and publish failures; this final guard
				// also contains a consumer logger that throws from an observation path.
			})
		initialized = true
	}

	/**
	 * Joins startup too, not just the teardown.
	 *
	 * `owner.close()` covers the client it can see. A close landing while
	 * `createWhatsAppClient()` is still pending sees none — the client arrives
	 * afterwards, `adopt()` refuses it, and the release runs detached. Without
	 * waiting for `init()` to finish, `await sock.end()` therefore returns while
	 * that client is still disconnecting and being freed, and the replacement
	 * socket the consumer builds next overlaps it on the same auth folder.
	 *
	 * `initPromise` is declared below and swallows its own failures, so this
	 * neither hits its TDZ (nothing can call `end` during the synchronous
	 * construction below) nor masks the teardown error.
	 */
	const end = (error: Error | undefined): Promise<void> => {
		// Called from inside an end handler, the teardown is already running and
		// is waiting for that handler to return. Handing back its promise would
		// have the handler await itself.
		if (runningEndHandlers) return Promise.resolve()
		return owner.close(error).finally(() => initPromise)
	}

	let initError: Error | undefined
	// Started only once `end` exists. `init()`'s synchronous prefix reaches
	// `await createWhatsAppClient(...)` before the bridge can dispatch anything,
	// so today nothing can call `onTerminalClose` — and therefore `end` — that
	// early. But that is an argument about the current shape of `init()`, not a
	// rule the code enforces: dispatch a terminal close any sooner and line 401
	// becomes a `ReferenceError` inside a bridge callback, where no `try/catch`
	// of ours can reach it. Ordering it here makes the dependency structural.
	const initPromise = init().catch(err => {
		initError = err instanceof Error ? err : new Error(String(err))
		logger.error({ err }, 'failed to initialize bridge client')

		// A client adopted before the failure outlives a read loop that never
		// started: `getClient()` correctly rejects, but the standalone
		// helpers bypass it and would keep reaching the half-built client.
		return owner.discard()
	})

	/**
	 * Idempotent shutdown that later callers can actually await — the socket
	 * now ends *itself* on a terminal disconnect, so a consumer's
	 * `await sock.end()` is usually the second call. Resolving it early while
	 * the first was still flushing turned
	 * `close` → `await sock.end()` → `makeWASocket()` into two writers on one
	 * auth folder.
	 */

	const logout = async (msg?: string) => {
		user = undefined
		const logoutError = new Boom(msg || 'Logged out', { statusCode: DisconnectReason.loggedOut })

		// `Client::logout()` dispatches `LoggedOut` itself, which the dispatcher
		// turns into the terminal close. Reporting our own on top of that gave
		// consumers two `close` events for one logout, and upstream guarantees
		// at most one — so watch for the dispatcher's instead of assuming
		// either way. Counting rather than flagging, because a terminal close
		// may already have happened earlier in this socket's life.
		// `Client::logout()` dispatches `LoggedOut` itself, which the dispatcher
		// turns into the terminal close. Reporting our own on top of that gave
		// consumers two closes for one logout, and upstream guarantees at most
		// one — so watch for the dispatcher's instead of assuming either way.
		const reportedBefore = terminalClose.hasReported()
		const live = owner.peek()
		if (live) {
			try {
				await live.logout()
			} catch {
				/* ignore */
			}
		}

		// Nothing announced it: no client at all, or `logout()` threw before the
		// bridge got to it. Upstream always reports exactly one close for a
		// logout, so emitting none would be worse than emitting one too many.
		// Keyed on a close having been *reported*, not on the socket closing —
		// a plain `end()` reports nothing, so keying off that would let a logout
		// racing one finish with no close at all.
		const mayNeedFallback = !reportedBefore && !terminalClose.hasReported()

		try {
			await end(logoutError)
		} finally {
			// After the teardown, like the dispatcher's own close: doing it
			// before would hand a logged-out handler a socket still flushing the
			// auth folder it is about to delete. In a `finally` because `end()`
			// rethrows the first flush failure and the owner releases the client
			// regardless — on that path listeners would otherwise see no
			// terminal close at all for a socket that has definitely ended.
			// Rechecked here, not just before the await: a dispatcher close
			// arriving while `end()` ran would otherwise be followed by this
			// stale decision, giving consumers two closes for one logout.
			if (mayNeedFallback && !terminalClose.hasReported()) {
				terminalClose.reportNow(() =>
					ev.emit('connection.update', {
						connection: 'close',
						lastDisconnect: {
							error: logoutError,
							date: new Date()
						}
					} as Partial<ConnectionState>)
				)
			}
		}

		// The close is published on a chain one hop further out than the
		// teardown both paths await, so without this `await sock.logout()`
		// returns just before the event it caused.
		//
		// Skipped when re-entered from an end handler, for the same reason
		// `end()` short-circuits there: the publish waits for the teardown, the
		// teardown waits for the handler, and the handler would be waiting here
		// — stalled until the watchdog fires.
		if (!runningEndHandlers) await terminalClose.published()
	}

	const registerSocketEndHandler = (handler: (error: Error | undefined) => void | Promise<void>) => {
		socketEndHandlers.push(handler)
	}

	const waitForConnectionUpdate = (
		check: (u: Partial<ConnectionState>) => Promise<boolean | undefined>,
		timeoutMs?: number
	) => {
		return new Promise<void>((resolve, reject) => {
			let timeout: NodeJS.Timeout | undefined
			const cleanup = () => {
				ev.off('connection.update', listener)
				if (timeout) clearTimeout(timeout)
			}
			const listener = async (update: Partial<ConnectionState>) => {
				if (update.connection === 'close') {
					cleanup()
					reject(
						update.lastDisconnect?.error ??
							new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
					)
					return
				}
				try {
					if (!(await check(update))) return
					cleanup()
					resolve()
				} catch (error) {
					cleanup()
					reject(error)
				}
			}

			ev.on('connection.update', listener)
			if (timeoutMs) {
				timeout = setTimeout(() => {
					cleanup()
					reject(new Boom('Timed out waiting for connection update', { statusCode: 408 }))
				}, timeoutMs)
				// Don't keep the process alive if the caller has already stopped
				// awaiting (e.g. sock.end() during shutdown with in-flight queries).
				timeout.unref()
			}
		})
	}

	const fetchReachoutTimelock = async (): Promise<ReachoutTimelockState> => {
		const payload = await ctx.withClient(client => client.fetchReachoutTimelock())
		const state = mapReachoutTimelock(payload) ?? { isActive: false }
		ev.emit('connection.update', { reachoutTimeLock: state } as Partial<ConnectionState>)
		return state
	}
	const query = async (node: BinaryNode, timeoutMs?: number): Promise<BinaryNode> => {
		if (!node.attrs.id) node.attrs.id = generateMessageTag()
		const result = (await ctx.withClient(client => client.queryNode(node, timeoutMs))) as BinaryNode
		assertNodeErrorFree(result)
		return result
	}
	const waitForMessage = makeTaggedMessageWaiter(ws, logger, fullConfig.defaultQueryTimeoutMs)
	const usyncMethods = makeUSyncMethods({
		queryNode: query,
		queryUsync: async typedQuery => ctx.withClient(client => client.queryUsync(typedQuery))
	})

	const sock = {
		ev,
		logger,
		ws,
		type: 'md' as const,
		/**
		 * `await using sock = makeWASocket(config)` — frees the wasm client on
		 * scope exit. Nothing else can: the bridge holds the JS event callbacks
		 * as wasm-bindgen externrefs and those callbacks reach back to this
		 * closure, so the reference cycle crosses the JS/wasm boundary and no
		 * `FinalizationRegistry` will ever fire for the client.
		 *
		 * Delegates to `end()`, so it flushes the auth store and is idempotent.
		 *
		 * Then awaits `initPromise`, because `end()` alone does not satisfy the
		 * async-disposal contract: called before `createWhatsAppClient()`
		 * settles, it sees `client === undefined`, frees nothing, and resolves
		 * while initialization is still running. What actually disposes that
		 * client is the `ended` guard inside `init()` — so code after the
		 * `await using` scope would otherwise overlap with bridge construction,
		 * event callbacks, and store access. `end()` runs first because it sets
		 * `ended` synchronously, which is what makes `init()` bail out early.
		 *
		 * The `finally` is load-bearing: `end()` rethrows the first auth-store
		 * flush failure, and letting that propagate directly would skip the wait
		 * and resolve the disposer with `init()` still in flight — losing the
		 * one guarantee it exists to provide, in exactly the situation where
		 * cleanup already went wrong. `initPromise` swallows its own failures,
		 * so awaiting it here cannot mask the flush error.
		 */
		async [Symbol.asyncDispose]() {
			try {
				await end(undefined)
			} finally {
				await initPromise
			}
		},
		// Upstream `socket.ts:1106-1108` returns `authState.creds.me`, which
		// carries `{ id, lid, name, verifiedName, ... }` — full Contact
		// shape. Returning the bare `{id, lid}` like before broke
		// upstream-port code that read `sock.user.name` /
		// `sock.user.verifiedName`. Build the same structure on the fly
		// from the merged auth.creds + paired-account state.
		get user(): Contact | undefined {
			if (!user?.id) return undefined
			return {
				id: user.id,
				lid: user.lid,
				name: pairedAccount?.businessName ?? auth.creds?.me?.name,
				verifiedName: auth.creds?.me?.verifiedName,
				...(auth.creds?.me?.phoneNumber ? { phoneNumber: auth.creds.me.phoneNumber } : {})
			}
		},
		get waClient() {
			const live = owner.peek()
			return live && wrapBridgeClient(live)
		},
		get isConnected() {
			return owner.peek()?.isConnected() ?? false
		},
		get isLoggedIn() {
			return owner.peek()?.isLoggedIn() ?? false
		},
		get authState(): { creds: AuthenticationCreds; keys: SignalKeyStoreWithTransaction } {
			return {
				creds: {
					...auth.creds,
					...(user ? { me: { ...auth.creds.me, id: user.id, lid: user.lid } as Contact } : {}),
					...(cachedAccount ? { account: cachedAccount } : {}),
					...(pairedAccount?.platform ? { platform: pairedAccount.platform } : {})
				},
				keys: getExposedKeys()
			}
		},
		devicesMutex,
		messageMutex,
		receiptMutex,
		appStatePatchMutex,
		notificationMutex,
		generateMessageTag,
		sendNode: async (frame: BinaryNode) => {
			return ctx.withClient(client => client.sendNode(frame))
		},
		assertSessions: async (jids: string[], force?: boolean) => {
			return ctx.withClient(client => client.assertSessions(jids, force ?? false))
		},
		getUSyncDevices: async (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => {
			return ctx.withClient(client => client.getUSyncDevices(jids, useCache, ignoreZeroDevices))
		},
		waitForMessage,
		query,
		sendRawMessage: async (data: Uint8Array | Buffer) => {
			return ctx.withClient(client => client.sendRawMessage(data instanceof Uint8Array ? data : new Uint8Array(data)))
		},
		/**
		 * `dsmMessage` is accepted so the signature matches upstream, and
		 * refused rather than ignored. Upstream uses it to encrypt a different
		 * plaintext for the caller's own other devices; the engine encrypts one
		 * payload for every recipient, so honouring it is not possible here and
		 * dropping it would send those devices the wrong message.
		 */
		createParticipantNodes: async (
			jids: string[],
			message: proto.IMessage,
			extraAttrs?: BinaryNode['attrs'],
			dsmMessage?: proto.IMessage
		): Promise<{ nodes: BinaryNode[]; shouldIncludeDeviceIdentity: boolean }> => {
			if (dsmMessage) {
				throw new Boom(
					'createParticipantNodes: dsmMessage is not supported, the engine encrypts one payload for every recipient and cannot substitute a different one for your own devices',
					{ statusCode: 501 }
				)
			}
			const bytes = encodeProtoCompat('Message', message as Record<string, unknown>)
			return ctx.withClient(client => client.createParticipantNodesBytes(jids, bytes, extraAttrs ?? {}))
		},
		signalRepository,
		...makePreKeyMethods(ctx),
		end,
		logout,
		registerSocketEndHandler,
		waitForConnectionUpdate,
		setAutoReconnect: (enabled: boolean) => {
			// Mirrored locally because the dispatcher has to know: with this off,
			// a plain drop is terminal rather than the start of a backoff.
			autoReconnectEnabled = enabled
			owner.peek()?.setAutoReconnect(enabled)
		},
		/**
		 * Update presence either globally (`available`/`unavailable`) or per-chat
		 * (`composing`/`recording`/`paused`), matching upstream Baileys' overload.
		 * Chat-state updates require `toJid`; omitting it raises `Boom(400)` so the
		 * caller hears about the protocol mistake instead of the bridge silently
		 * sending nothing.
		 */
		sendPresenceUpdate: async (type: WAPresence, toJid?: string) => {
			// Ahead of the client: an off-union value used to fall through to the
			// chat-state branch and be reported as a missing jid.
			assertArgumentDomain('sendPresenceUpdate', 'type', type, WA_PRESENCES)
			return ctx.withClient(async c => {
				if (type === 'available' || type === 'unavailable') {
					return c.sendPresence(type)
				}

				if (!toJid) {
					throw new Boom(`sendPresenceUpdate('${type}') requires a target jid`, { statusCode: 400 })
				}

				return c.sendChatState(toJid, type)
			})
		},
		/**
		 * Plaintext media upload helper, source-compatible with the upstream
		 * Baileys `sock.waUploadToServer(buf, { mediaType })` shape so existing
		 * callers (or `prepareWAMessageMedia(msg, { upload: sock.waUploadToServer })`)
		 * keep working. Delegates to the bridge's encrypt + CDN-failover upload.
		 */
		waUploadToServer: async (data: Uint8Array | Buffer, opts: { mediaType: MediaType }): Promise<UploadMediaResult> => {
			// The upstream set, which is wider than what the bridge uploads:
			// `toBridgeMediaType` below still refuses the ones it cannot map.
			assertArgumentDomain('waUploadToServer', 'mediaType', opts?.mediaType, MEDIA_TYPES)
			const bytes = data instanceof Uint8Array && !Buffer.isBuffer(data) ? data : new Uint8Array(data)
			return ctx.withClient(client => client.uploadMedia(bytes, toBridgeMediaType(opts.mediaType)))
		},
		...makePrivacyMethods(ctx),
		updateDefaultDisappearingMode: async (duration: number) => {
			await ctx.withClient(client => client.updateDefaultDisappearingMode(duration))
		},
		rejectCall: async (callId: string, callFrom: string) => {
			const context = activeCallContexts.get(callId)
			await ctx.withClient(client =>
				client.rejectCall(callId, context?.peer ?? callFrom, context?.callCreator ?? callFrom)
			)
			activeCallContexts.delete(callId)
		},
		/**
		 * Fetch the account's current reachout-timelock state from the server.
		 *
		 * The same state is also pushed proactively via the
		 * `NotificationUserReachoutTimelockUpdate` MEX notification, which is
		 * surfaced on `connection.update.reachoutTimeLock` automatically. Use
		 * this method to query on demand (e.g. on app start, or after a 463
		 * nack hints that the timelock just kicked in).
		 *
		 * Emits the result on `connection.update.reachoutTimeLock` as a side
		 * effect for parity with the push path. Returns the same state for
		 * callers that prefer awaiting.
		 */
		fetchReachoutTimelock,
		/** Upstream Baileys-compatible name. */
		fetchAccountReachoutTimelock: fetchReachoutTimelock,
		getBusinessProfile: async (jid: string): Promise<WABusinessProfile | void> => {
			return bridgeBusinessProfileToBaileys(await ctx.withClient(client => client.getBusinessProfile(jid)))
		},
		fetchMessageHistory: async (count: number, oldestMsgKey: WAMessageKey, oldestMsgTimestamp: number | Long) => {
			return ctx.withClient(client =>
				client.fetchMessageHistory(
					count,
					oldestMsgKey.remoteJid || '',
					oldestMsgKey.id || '',
					oldestMsgKey.fromMe || false,
					typeof oldestMsgTimestamp === 'number' ? oldestMsgTimestamp : oldestMsgTimestamp.toNumber()
				)
			)
		},
		sendStatusMessage: async (message: Record<string, unknown>, recipients: string[]): Promise<string> => {
			const bytes = encodeProtoCompat('Message', message)
			return ctx.withClient(client => client.sendStatusMessageBytes(bytes, recipients))
		},
		...makeMessageMethods(ctx),
		...groupMethods,
		...communityMethods,
		...makeContactMethods(ctx),
		...makeProfileMethods(ctx),
		...makeChatActionMethods(ctx),
		...makeInternalMethods(ctx),
		...usyncMethods,
		...makeStanzaResponseMethods(ctx),
		...makePresenceMethods(ctx),
		...makeBlockingMethods(ctx),
		...makeNewsletterMethods(ctx),
		...makeBusinessMethods(ctx),
		...makeServerQueryMethods(ctx),
		downloadMedia: async <T extends MediaDownloadType>(
			message: WAMessage,
			type: T,
			options: MediaDownloadOptions = {}
		) => {
			// Checked here as well as in the helper: the client is awaited while
			// the context below is built, and a check past that await reports a
			// stack without the caller in it.
			assertArgumentDomain('downloadMedia', 'type', type, MEDIA_DOWNLOAD_TYPES)
			return ctx.withClient(client =>
				downloadMediaMessage(message, type, options, {
					logger,
					reuploadRequest: (m: WAMessage) => sock.updateMediaMessage(m),
					waClient: client
				})
			)
		}
	}

	// Assigning replaces the handler the socket itself reports through, rather
	// than shadowing it with a second one only a consumer could reach.
	Object.defineProperty(sock, 'onUnexpectedError', {
		get: () => unexpectedErrors.handler,
		set: (handler: (err: unknown, msg: string) => void) => {
			unexpectedErrors.handler = handler
		},
		enumerable: true,
		configurable: true
	})

	return sock
}

export default makeWASocket
