import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import {
	createWhatsAppClient,
	type DevicePlatformType,
	encodeProto,
	initWasmEngine,
	type UploadMediaResult,
	type WasmWhatsAppClient
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
import { _registerActiveBridgeClient, downloadMediaMessage } from '../Utils/messages.ts'
import { makeNativeCryptoProvider } from '../Utils/native-crypto-provider.ts'
import type { MediaDownloadOptions } from '../Utils/messages-media.ts'
import { wrapLegacyStore } from '../Utils/wrap-legacy-store.ts'
import { assertNodeErrorFree } from '../WABinary/generic-utils.ts'
import type { proto } from '../WAProto/runtime.ts'
import { makeBlockingMethods } from './blocking.ts'
import { makeChatActionMethods } from './chat-actions.ts'
import { makeContactMethods } from './contacts.ts'
import { makeCommunityMethods } from './communities.ts'
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
	let client: WasmWhatsAppClient | undefined
	let readyClient: Promise<WasmWhatsAppClient> | undefined
	let user: { id?: string; lid?: string } | undefined

	const ws = new WebSocketClient(fullConfig.waWebSocketUrl, fullConfig, () => client)

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
			if (readyClient) return readyClient

			return initPromise.then(() => {
				if (initError) {
					throw new Boom('Bridge client failed to initialize: ' + initError.message, { statusCode: 500 })
				}

				if (!client) throw new Boom('Client not initialized', { statusCode: 500 })
				return client
			})
		},
		getClientSync: () => {
			if (!client) throw new Boom('Client not initialized', { statusCode: 500 })
			return client
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
	const groupMethods = makeGroupMethods(ctx)
	const communityMethods = makeCommunityMethods(ctx, groupMethods)
	const refreshParticipating = makeParticipatingRefreshHandler(ctx, {
		groupFetchAllParticipating: groupMethods.groupFetchAllParticipating,
		communityFetchAllParticipating: communityMethods.communityFetchAllParticipating
	})

	const eventHandlers = makeEventHandlers(ctx, {
		onPairSuccess: data => {
			pairedAccount = data
			client
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
		onDirtyState: event => refreshParticipating(event.dirtyType)
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

		client = await createWhatsAppClient(
			makeTransport(fullConfig),
			makeHttpClient(fullConfig),
			eventHandlers,
			bridgeStore,
			fullConfig.cache ?? null,
			fullConfig.version,
			fullConfig.wantedPreKeyCount ?? null
		)
		if (fullConfig.pushName) {
			await client.setInitialPushName(fullConfig.pushName)
		}
		// Make this client the fallback for standalone helpers like
		// downloadContentFromMessage that have no socket reference.
		_registerActiveBridgeClient(client, logger)

		const [osName, browserName] = fullConfig.browser

		const deviceOs = browserName === 'Android' ? 'Android' : osName
		await client.setDeviceProps({
			os: deviceOs,
			platformType: browserToPlatformType(browserName),
			...fullConfig.deviceProps
		})

		const [jid, lid, account] = await Promise.all([
			client.getJid(),
			client.getLid(),
			client.getAccount().catch(() => undefined)
		])
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
			await client.setClientProfile({ preset: 'android', osVersion: osName })
		}

		if (isRawNodeForwardingEnabled(ws)) {
			client.setRawNodeForwarding(true)
		}

		// `run()` is fire-and-forget by design (the bridge runs the read
		// loop until disconnect/free) but typed `Promise<void>`. A late
		// rejection (lost connection during cleanup, etc) without a
		// `.catch` would escape to `process.on('unhandledRejection')`.
		// Funnel into the connection.update channel so consumers' regular
		// reconnect/diagnostic plumbing handles it like any other close.
		const runPromise = client.run() as unknown as Promise<void> | undefined
		if (runPromise && typeof runPromise.catch === 'function') {
			runPromise.catch(err => {
				logger.error({ err }, 'bridge client.run() rejected')
				ev.emit('connection.update', {
					connection: 'close',
					lastDisconnect: {
						// restartRequired (515) signals "Rust read loop crashed
						// unrecoverably, restart the sock". Previously mapped to
						// 500, which collided with the server-side <stream:error
						// code="500"> path and made it impossible for consumers
						// to tell the two apart.
						error: err instanceof Error ? err : new Boom(String(err), { statusCode: DisconnectReason.restartRequired }),
						date: new Date()
					}
				} as Partial<ConnectionState>)
			})
		}
	}

	let initError: Error | undefined
	const initPromise = init()
		.then(() => {
			if (client) readyClient = Promise.resolve(client)
		})
		.catch(err => {
			initError = err instanceof Error ? err : new Error(String(err))
			logger.error({ err }, 'failed to initialize bridge client')
		})

	let ended = false
	const socketEndHandlers: Array<(error: Error | undefined) => void | Promise<void>> = [
		() => activeCallContexts.clear()
	]
	const end = async (error: Error | undefined) => {
		if (ended) {
			logger.trace({ trace: error?.stack }, 'connection already closed')
			return
		}
		ended = true
		const c = client
		if (c) {
			try {
				await ws.close()
			} catch {
				/* ignore */
			}
			client = undefined
			readyClient = undefined

			// Barrier: bridge cleanup paths fired during `disconnect()` may
			// emit `set()` calls that are still queued as microtasks /
			// `setImmediate` callbacks at this point. Two yields to the
			// event loop drain (1) microtask queue and (2) the next
			// macrotask tick where wasm-bindgen async callbacks land.
			// Without this barrier, the flushes below run before the bridge
			// has finished writing — a race that loses the last few sets
			// (typically the closing-session ratchet step).
			await new Promise(resolve => setImmediate(resolve))
			await new Promise(resolve => setImmediate(resolve))

			// Capture the FIRST flush failure so a corrupt-on-shutdown auth
			// state surfaces to the caller. Always finish the rest of
			// cleanup; rethrow at the end so c.free() still runs.
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

			try {
				c.free()
			} catch {
				/* ignore */
			}

			if (firstFlushError) throw firstFlushError
		}

		for (const handler of socketEndHandlers) {
			try {
				await handler(error)
			} catch (handlerError) {
				logger.error({ err: handlerError }, 'error in socket end handler')
			}
		}
	}

	const logout = async (msg?: string) => {
		user = undefined
		if (client) {
			try {
				await client.logout()
			} catch {
				/* ignore */
			}
		}

		const logoutError = new Boom(msg || 'Logged out', { statusCode: DisconnectReason.loggedOut })
		ev.emit('connection.update', {
			connection: 'close',
			lastDisconnect: {
				error: logoutError,
				date: new Date()
			}
		} as Partial<ConnectionState>)
		await end(logoutError)
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
			return client
		},
		get isConnected() {
			return client?.isConnected() ?? false
		},
		get isLoggedIn() {
			return client?.isLoggedIn() ?? false
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
			client?.setAutoReconnect(enabled)
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
