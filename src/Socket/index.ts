import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import {
	createWhatsAppClient,
	type DevicePlatformType,
	encodeProto,
	initWasmEngine,
	type UploadMediaResult
} from '@oxidezap/whatsapp-rust-bridge'
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
import { DEFAULT_CONNECTION_CONFIG, type MediaType } from '../Defaults/index.ts'
import type {
	BinaryNode,
	AuthenticationCreds,
	ConnectionState,
	Contact,
	ReachoutTimelockState,
	SignalKeyStoreWithTransaction,
	UserFacingSocketConfig,
	WAPrivacyGroupAddValue,
	WAPrivacyOnlineValue,
	WAPrivacyValue,
	WABusinessProfile,
	WAReadReceiptsValue,
	WAMessage,
	WAMessageKey
} from '../Types/index.ts'
import type Long from 'long'
import { DisconnectReason } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import { _registerActiveBridgeClient, _unregisterActiveBridgeClient, downloadMediaMessage } from '../Utils/messages.ts'
import { makeNativeCryptoProvider } from '../Utils/native-crypto-provider.ts'
import type { MediaDownloadOptions } from '../Utils/messages-media.ts'
import { wrapLegacyStore } from '../Utils/wrap-legacy-store.ts'
import { assertNodeErrorFree } from '../WABinary/generic-utils.ts'
import type { proto } from '../WAProto/runtime.ts'
import { makeBlockingMethods } from './blocking.ts'
import { makeChatActionMethods } from './chat-actions.ts'
import { makeContactMethods } from './contacts.ts'
import { makeCommunityMethods } from './communities.ts'
import { makeBridgeClientOwner } from './bridge-client-owner.ts'
import { makeEventHandlers } from './events.ts'
import { makeGroupMethods } from './groups.ts'
import { makeMessageMethods } from './messages.ts'
import { makeNewsletterMethods } from './newsletter.ts'
import { makePreKeyMethods } from './prekeys.ts'
import { makePresenceMethods } from './presence.ts'
import { makeProfileMethods } from './profile.ts'
import { mapReachoutTimelock } from './reachout.ts'
import { makeHttpClient, makeTransport } from './transport.ts'
import type { SocketContext } from './types.ts'
import { makeUSyncMethods } from './usync.ts'

let wasmInitialized = false

/**
 * How long a terminal-close teardown may run before the socket reports the
 * close anyway. Teardown normally takes milliseconds; this only fires when a
 * consumer end handler or an auth-store flush never settles, and losing the
 * event entirely is worse than reporting it early.
 */
const TERMINAL_CLOSE_PUBLISH_TIMEOUT_MS = 10_000

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

/** Build the ws EventEmitter with auto-enable raw node forwarding */
const makeWASocket = (config: UserFacingSocketConfig) => {
	const fullConfig = { ...DEFAULT_CONNECTION_CONFIG, ...config }
	const { logger } = fullConfig
	const auth = normalizeSocketAuthenticationState(fullConfig.auth)
	const getExposedKeys = makeLazyTransactionKeyStore(auth.keys, logger, fullConfig.transactionOpts)

	const ev = makeEventBuffer(logger)
	// Upstream mutates authState.creds before notifying user listeners. Register
	// this first so `ev.on('creds.update', saveCreds)` persists the merged state
	// rather than the pre-pair placeholder.
	ev.on('creds.update', update => Object.assign(auth.creds, update))
	let user: { id?: string; lid?: string } | undefined

	/**
	 * Consumer teardown hooks, plus the socket's own. Declared here rather than
	 * beside their registrations so the owner below can close over the list
	 * before anything fills it.
	 */
	const socketEndHandlers: Array<(error: Error | undefined) => void | Promise<void>> = []

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
				/* ignore */
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

			// Capture the FIRST flush failure so a corrupt-on-shutdown auth
			// state reaches the caller, but finish the rest of the teardown
			// regardless — the client is released either way.
			//
			// Called through their owners on purpose. Collecting the two methods
			// into an array and invoking them bare drops the receiver, so a
			// consumer store whose `flush()` touches `this` throws on
			// `undefined` — the teardown then records a flush failure, releases
			// the client and publishes the close with the auth writes still
			// unpersisted.
			let firstFlushError: unknown
			try {
				await auth.store?.flush?.()
			} catch (e) {
				firstFlushError ??= e
			}
			try {
				await autoWrappedStore?.flush?.()
			} catch (e) {
				firstFlushError ??= e
			}

			// End handlers run before the flush error is rethrown: they are the
			// consumer's teardown hook, and a corrupt-on-shutdown auth store is
			// exactly when they most need to run.
			for (const handler of socketEndHandlers) {
				try {
					await handler(error)
				} catch (handlerError) {
					logger.error({ err: handlerError }, 'error in socket end handler')
				}
			}

			if (firstFlushError) throw firstFlushError
		},

		release: async client => {
			// `disconnect()` before `free()` is defence in depth, not a fix for a
			// reproduced bug on this path.
			//
			// The hazard is real and reproducible at the bridge: freeing a client
			// with any call still pending corrupts the wasm heap — dlmalloc trips
			// `assertion failed: psize <= size + max_overhead` and the process
			// dies on `RuntimeError: unreachable`, from a microtask no try/catch
			// here can reach, since `free()` itself returns normally.
			// `logout()`, `disconnect()` and a plain `fetchBlocklist()` all
			// reproduce it — see `__tests__/bridge-free-safety.test.ts`.
			//
			// What keeps teardown off that path is the `ws.close()` above, which
			// is itself a `client.disconnect()` (`Compatibility/websocket-client.ts`).
			// This is the belt to that braces, and the gap it closes is
			// `WebSocketClient.close()`'s early return when `closing`/`closed` is
			// already set: that path does NOT await the disconnect it skipped, so
			// `void sock.ws.close(); await sock.end()` could otherwise reach
			// `free()` with the first disconnect still running.
			try {
				await client.disconnect()
			} catch {
				/* ignore */
			}

			// Unregister before freeing: `free()` is swallowed, so ordering it
			// last would leave the module-level pointer aimed at a client that is
			// already gone if anything between them threw.
			_unregisterActiveBridgeClient(client)
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
	// How many terminal closes the dispatcher has reported, and the settle of
	// the most recent one's publish. `logout()` reads both: the count to tell
	// whether the bridge already announced the logout, and the promise so
	// `await sock.logout()` does not return one microtask before the `close`
	// event it caused.
	let terminalCloseCount = 0
	let terminalClosePublished: Promise<void> | undefined

	const ctx: SocketContext = {
		ev,
		logger,
		fullConfig,
		ws,
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
		getClient: () => {
			const ready = owner.peek()
			if (ready) return Promise.resolve(ready)

			return initPromise.then(() => {
				if (initError) {
					throw new Boom('Bridge client failed to initialize: ' + initError.message, { statusCode: 500 })
				}

				const built = owner.peek()
				if (!built) throw new Boom('Client not initialized', { statusCode: 500 })
				return built
			})
		},
		getClientSync: () => {
			const built = owner.peek()
			if (!built) throw new Boom('Client not initialized', { statusCode: 500 })
			return built
		}
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
		 * `publish` runs after the teardown, so a consumer answering `close`
		 * with a replacement socket on the same auth folder cannot overlap this
		 * one's store flush and `free()`. Upstream orders it the same way:
		 * `ws.close()` and the end handlers, then the close.
		 *
		 * But it has to run *unconditionally*. The close used to be emitted
		 * synchronously and could not be lost; hanging it off a teardown makes
		 * it conditional on that teardown settling, and a `close` that never
		 * arrives is the original bug all over again — a bot offline with
		 * nothing in its logs. Hence both settle paths, a swallowed publish,
		 * and a watchdog for a teardown that never finishes at all.
		 */
		onTerminalClose: (error, publish) => {
			terminalCloseCount++

			let published = false
			const publishOnce = (reason?: unknown) => {
				if (published) return
				published = true
				if (reason) logger.error({ err: reason }, 'socket teardown failed after a terminal disconnect')
				try {
					publish()
				} catch (err) {
					// `publish` is `ev.emit`, so this is a throwing consumer
					// listener. Letting it escape would surface as an unhandled
					// rejection on a detached chain — process exit under Node's
					// default handler.
					logger.error({ err }, 'connection.update listener threw on the terminal close')
				}
			}

			const watchdog = setTimeout(() => {
				logger.error(
					{ afterMs: TERMINAL_CLOSE_PUBLISH_TIMEOUT_MS },
					'socket teardown is still running; reporting the terminal close anyway'
				)
				publishOnce()
			}, TERMINAL_CLOSE_PUBLISH_TIMEOUT_MS)
			watchdog.unref?.()

			terminalClosePublished = end(error).then(
				() => {
					clearTimeout(watchdog)
					publishOnce()
				},
				err => {
					clearTimeout(watchdog)
					publishOnce(err)
				}
			)
			void terminalClosePublished
		},
		isAutoReconnectEnabled: () => autoReconnectEnabled
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
			fullConfig.wantedPreKeyCount ?? null
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
		// that carry no socket reference.
		_registerActiveBridgeClient(created, logger)

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

		// `run()` spawns the connect/handshake/read/reconnect loop as a
		// background task and returns `void` — it deliberately is not `async`,
		// so that it does not hold a wasm-bindgen borrow on `self` that would
		// block `disconnect()`.
		//
		// Consequence: the loop's exit is not observable from here. The engine
		// clears `enable_auto_reconnect` and breaks out on every terminal
		// disconnect (conflict/401/409/516, and any `<failure>` whose reason is
		// not 500/503), and when it does, the `WasmWhatsAppClient` is dead
		// weight that only `sock.end()` can free — nothing else can, because
		// the bridge holds the JS event callbacks as wasm-bindgen externrefs,
		// those close over `ctx`, and `ctx` closes over `client`, so the cycle
		// crosses the JS/wasm boundary and no `FinalizationRegistry` fires.
		// Freeing that automatically needs the bridge to expose loop completion
		// (a terminal callback or an awaitable handle); until it does, the
		// consumer has to call `sock.end()` on a terminal close.
		created.run()
	}

	let initError: Error | undefined
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
	const end = (error: Error | undefined): Promise<void> => owner.close(error)

	const logout = async (msg?: string) => {
		user = undefined
		const logoutError = new Boom(msg || 'Logged out', { statusCode: DisconnectReason.loggedOut })

		// `Client::logout()` dispatches `LoggedOut` itself, which the dispatcher
		// turns into the terminal close. Reporting our own on top of that gave
		// consumers two `close` events for one logout, and upstream guarantees
		// at most one — so watch for the dispatcher's instead of assuming
		// either way. Counting rather than flagging, because a terminal close
		// may already have happened earlier in this socket's life.
		const closesBefore = terminalCloseCount
		const live = owner.peek()
		if (live) {
			try {
				await live.logout()
			} catch {
				/* ignore */
			}
		}

		// Nothing dispatched: no client at all, or `logout()` threw before the
		// bridge got to it. Upstream always reports exactly one close for a
		// logout, so emitting none would be worse than emitting one too many.
		const announceLogout = terminalCloseCount === closesBefore

		await end(logoutError)

		// Published after the teardown, like the dispatcher's own close. Doing
		// it before would hand a logged-out handler a socket that is still
		// flushing the auth folder it is about to delete — the one guarantee
		// this whole change is selling.
		if (announceLogout) {
			ev.emit('connection.update', {
				connection: 'close',
				lastDisconnect: {
					error: logoutError,
					date: new Date()
				}
			} as Partial<ConnectionState>)
		}
		// The dispatcher publishes its close on a chain one hop further out than
		// the teardown both paths await, so without this `await sock.logout()`
		// returns just before the event it caused.
		await terminalClosePublished
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
		const payload = await (await ctx.getClient()).fetchReachoutTimelock()
		const state = mapReachoutTimelock(payload) ?? { isActive: false }
		ev.emit('connection.update', { reachoutTimeLock: state } as Partial<ConnectionState>)
		return state
	}
	const query = async (node: BinaryNode, timeoutMs?: number): Promise<BinaryNode> => {
		if (!node.attrs.id) node.attrs.id = generateMessageTag()
		const result = (await (await ctx.getClient()).queryNode(node, timeoutMs)) as BinaryNode
		assertNodeErrorFree(result)
		return result
	}
	const waitForMessage = makeTaggedMessageWaiter(ws, logger, fullConfig.defaultQueryTimeoutMs)
	const usyncMethods = makeUSyncMethods({
		queryNode: query,
		queryUsync: async typedQuery => (await ctx.getClient()).queryUsync(typedQuery)
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
			return owner.peek()
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
			return (await ctx.getClient()).sendNode(frame)
		},
		assertSessions: async (jids: string[], force?: boolean) => {
			return (await ctx.getClient()).assertSessions(jids, force ?? false)
		},
		getUSyncDevices: async (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => {
			return (await ctx.getClient()).getUSyncDevices(jids, useCache, ignoreZeroDevices)
		},
		waitForMessage,
		query,
		sendRawMessage: async (data: Uint8Array | Buffer) => {
			return (await ctx.getClient()).sendRawMessage(data instanceof Uint8Array ? data : new Uint8Array(data))
		},
		createParticipantNodes: async (
			jids: string[],
			message: proto.IMessage,
			extraAttrs?: BinaryNode['attrs']
		): Promise<{ nodes: BinaryNode[]; shouldIncludeDeviceIdentity: boolean }> => {
			const bytes = encodeProto('Message', message as Record<string, unknown>)
			return (await ctx.getClient()).createParticipantNodesBytes(jids, bytes, extraAttrs ?? {})
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
		sendPresenceUpdate: async (
			type: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused',
			toJid?: string
		) => {
			const c = await ctx.getClient()
			if (type === 'available' || type === 'unavailable') {
				return c.sendPresence(type)
			}

			if (!toJid) {
				throw new Boom(`sendPresenceUpdate('${type}') requires a target jid`, { statusCode: 400 })
			}

			return c.sendChatState(toJid, type)
		},
		/**
		 * Plaintext media upload helper, source-compatible with the upstream
		 * Baileys `sock.waUploadToServer(buf, { mediaType })` shape so existing
		 * callers (or `prepareWAMessageMedia(msg, { upload: sock.waUploadToServer })`)
		 * keep working. Delegates to the bridge's encrypt + CDN-failover upload.
		 */
		waUploadToServer: async (data: Uint8Array | Buffer, opts: { mediaType: MediaType }): Promise<UploadMediaResult> => {
			const bytes = data instanceof Uint8Array && !Buffer.isBuffer(data) ? data : new Uint8Array(data)
			return (await ctx.getClient()).uploadMedia(bytes, toBridgeMediaType(opts.mediaType))
		},
		fetchPrivacySettings: async (force?: boolean) => {
			void force
			return (await ctx.getClient()).fetchPrivacySettings()
		},
		updatePrivacySetting: async (category: string, value: string) => {
			await (await ctx.getClient()).updatePrivacySetting(category, value)
		},
		updateLastSeenPrivacy: async (value: WAPrivacyValue) => {
			await (await ctx.getClient()).updatePrivacySetting('last', value)
		},
		updateOnlinePrivacy: async (value: WAPrivacyOnlineValue) => {
			await (await ctx.getClient()).updatePrivacySetting('online', value)
		},
		updateProfilePicturePrivacy: async (value: WAPrivacyValue) => {
			await (await ctx.getClient()).updatePrivacySetting('profile', value)
		},
		updateStatusPrivacy: async (value: WAPrivacyValue) => {
			await (await ctx.getClient()).updatePrivacySetting('status', value)
		},
		updateReadReceiptsPrivacy: async (value: WAReadReceiptsValue) => {
			await (await ctx.getClient()).updatePrivacySetting('readreceipts', value)
		},
		updateGroupsAddPrivacy: async (value: WAPrivacyGroupAddValue) => {
			await (await ctx.getClient()).updatePrivacySetting('groupadd', value)
		},
		updateDefaultDisappearingMode: async (duration: number) => {
			await (await ctx.getClient()).updateDefaultDisappearingMode(duration)
		},
		rejectCall: async (callId: string, callFrom: string) => {
			const context = activeCallContexts.get(callId)
			await (await ctx.getClient()).rejectCall(callId, context?.peer ?? callFrom, context?.callCreator ?? callFrom)
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
			return bridgeBusinessProfileToBaileys(await (await ctx.getClient()).getBusinessProfile(jid))
		},
		fetchMessageHistory: async (count: number, oldestMsgKey: WAMessageKey, oldestMsgTimestamp: number | Long) => {
			return (await ctx.getClient()).fetchMessageHistory(
				count,
				oldestMsgKey.remoteJid || '',
				oldestMsgKey.id || '',
				oldestMsgKey.fromMe || false,
				typeof oldestMsgTimestamp === 'number' ? oldestMsgTimestamp : oldestMsgTimestamp.toNumber()
			)
		},
		sendStatusMessage: async (message: Record<string, unknown>, recipients: string[]): Promise<string> => {
			const bytes = encodeProto('Message', message)
			return (await ctx.getClient()).sendStatusMessageBytes(bytes, recipients)
		},
		...makeMessageMethods(ctx),
		...groupMethods,
		...communityMethods,
		...makeContactMethods(ctx),
		...makeProfileMethods(ctx),
		...makeChatActionMethods(ctx),
		...usyncMethods,
		...makeStanzaResponseMethods(ctx),
		...makePresenceMethods(ctx),
		...makeBlockingMethods(ctx),
		...makeNewsletterMethods(ctx),
		downloadMedia: async <T extends 'buffer' | 'stream'>(
			message: WAMessage,
			type: T,
			options: MediaDownloadOptions = {}
		) => {
			return downloadMediaMessage(message, type, options, {
				logger,
				reuploadRequest: (m: WAMessage) => sock.updateMediaMessage(m),
				waClient: await ctx.getClient()
			})
		}
	}

	return sock
}

export default makeWASocket
