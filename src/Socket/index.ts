import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import {
	createWhatsAppClient,
	encodeProto,
	initWasmEngine,
	type MediaType,
	type UploadMediaResult,
	type WasmWhatsAppClient
} from 'whatsapp-rust-bridge'
import type { proto } from 'whatsapp-rust-bridge/proto-types'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import type { BinaryNode, ConnectionState, Contact, UserFacingSocketConfig, WAMessage } from '../Types/index.ts'
import { DisconnectReason } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import type { ILogger } from '../Utils/logger.ts'
import { _registerActiveBridgeClient, downloadMediaMessage } from '../Utils/messages.ts'
import { makeNativeCryptoProvider } from '../Utils/native-crypto-provider.ts'
import type { MediaDownloadOptions } from '../Utils/messages-media.ts'
import { wrapLegacyStore } from '../Utils/wrap-legacy-store.ts'
import { makeBlockingMethods } from './blocking.ts'
import { makeChatActionMethods } from './chat-actions.ts'
import { makeContactMethods } from './contacts.ts'
import { makeEventHandler } from './events.ts'
import { makeGroupMethods } from './groups.ts'
import { makeMessageMethods } from './messages.ts'
import { makeNewsletterMethods } from './newsletter.ts'
import { makePresenceMethods } from './presence.ts'
import { makeProfileMethods } from './profile.ts'
import { makeHttpClient, makeTransport } from './transport.ts'
import type { SocketContext } from './types.ts'

let wasmInitialized = false

/**
 * Returns a no-op `SignalKeyStore`-shaped facade. baileyrs hands this out from
 * `sock.authState.keys` when no legacy `auth.keys` was provided so that
 * upstream-Baileys code paths (typically post-error cleanup like
 * `keys.set({ 'sender-key': { [groupId]: null } })`) don't crash on a missing
 * `.set` method. The Rust bridge owns the real Signal state — this facade is
 * deliberately inert; reads come back empty and writes are dropped after a
 * `debug` log so the call site stays traceable.
 */
function noopKeyStore(logger: ILogger) {
	return {
		get: async () => ({}),
		set: async (data: Record<string, Record<string, unknown> | undefined>) => {
			const types = Object.keys(data).filter(k => data[k])
			if (types.length) {
				logger.debug({ types }, 'authState.keys.set called — bridge owns Signal state, dropping no-op')
			}
		},
		clear: async () => {
			logger.debug('authState.keys.clear called — no-op (bridge state is not cleared from JS)')
		}
	}
}

/** Build the signalRepository object that delegates to the bridge */
function makeSignalRepository(ctx: SocketContext) {
	return {
		decryptMessage: async (opts: { jid: string; type: 'pkmsg' | 'msg'; ciphertext: Uint8Array }) => {
			return (await ctx.getClient()).signalDecryptMessage(opts.jid, opts.type, opts.ciphertext)
		},
		encryptMessage: async (opts: {
			jid: string
			data: Uint8Array
		}): Promise<{ type: 'pkmsg' | 'msg'; ciphertext: Uint8Array }> => {
			return (await ctx.getClient()).signalEncryptMessage(opts.jid, opts.data)
		},
		decryptGroupMessage: async (opts: { group: string; authorJid: string; msg: Uint8Array }) => {
			return (await ctx.getClient()).signalDecryptGroupMessage(opts.group, opts.authorJid, opts.msg)
		},
		encryptGroupMessage: async (opts: {
			group: string
			data: Uint8Array
			meId: string
		}): Promise<{ senderKeyDistributionMessage: Uint8Array; ciphertext: Uint8Array }> => {
			return (await ctx.getClient()).signalEncryptGroupMessage(opts.group, opts.data, opts.meId)
		},
		processSenderKeyDistributionMessage: async (): Promise<void> => {},
		injectE2ESession: async (): Promise<void> => {},
		validateSession: async (jid: string): Promise<{ exists: boolean; reason?: string }> => {
			const exists = await (await ctx.getClient()).signalValidateSession(jid)
			return { exists }
		},
		jidToSignalProtocolAddress: (jid: string): string => {
			try {
				return ctx.getClientSync().jidToSignalProtocolAddress(jid)
			} catch {
				return `${jid}.0`
			}
		},
		migrateSession: async (): Promise<{ migrated: number; skipped: number; total: number }> => {
			return { migrated: 0, skipped: 0, total: 0 }
		},
		deleteSession: async (jids: string[]): Promise<void> => {
			return (await ctx.getClient()).signalDeleteSessions(jids)
		},
		/**
		 * Bidirectional LID ↔ PN lookup. Mirrors the upstream Baileys
		 * `signalRepository.lidMapping` API.
		 *
		 * Pure passthrough to the bridge — `client.lidForPn` / `client.pnForLid`
		 * delegate to the core's `get_lid_pn_entry`, which is cache-aside as
		 * of whatsapp-rust PR #565: hits the in-memory `lid_pn_cache` first
		 * and falls through to `backend.get_pn_mapping` / `get_lid_mapping`
		 * (so JsStoreCallbacks-backed sessions resolve every persisted
		 * mapping without warm-up needing a list primitive).
		 */
		lidMapping: {
			getLIDForPN: async (pn: string): Promise<string | null> => {
				const client = await ctx.getClient()
				return (await client.lidForPn(pn)) ?? null
			},
			getPNForLID: async (lid: string): Promise<string | null> => {
				const client = await ctx.getClient()
				return (await client.pnForLid(lid)) ?? null
			}
		}
	}
}

/** Build the ws EventEmitter with auto-enable raw node forwarding */
function makeWsEmitter(getClient: () => WasmWhatsAppClient | undefined) {
	const ws = new EventEmitter()
	let rawNodeEnabled = false

	const originalOn = ws.on.bind(ws)
	ws.on = (event: string | symbol, listener: (...args: unknown[]) => void) => {
		if (typeof event === 'string' && event.startsWith('CB:') && !rawNodeEnabled) {
			rawNodeEnabled = true
			try {
				getClient()?.setRawNodeForwarding(true)
			} catch {
				// bridge not ready yet — will enable when it initializes
			}
		}

		return originalOn(event, listener)
	}

	Object.defineProperty(ws, 'isOpen', {
		get: () => getClient()?.isConnected() ?? false,
		enumerable: true
	})

	// Upstream Baileys exposes `sock.ws.socket.readyState` (the underlying
	// WebSocket's standard property) and a lot of bots — keep-alive timers,
	// reconnect heuristics, "is the link up?" checks — read it directly.
	// baileyrs has no JS-side WebSocket (the noise socket lives inside the
	// Rust core), but the only thing those callers care about is the same
	// two-value answer the standard WebSocket constants encode:
	//   1 = OPEN, 3 = CLOSED — same numeric values WHATWG defines.
	// Anything other than 1 means "not usable", so collapsing the
	// CONNECTING/CLOSING transitional states to CLOSED preserves the
	// branching every realistic caller does (`readyState === 1`).
	const socketShim = {}
	Object.defineProperty(socketShim, 'readyState', {
		get: () => (getClient()?.isConnected() ? 1 : 3),
		enumerable: true
	})
	Object.defineProperty(ws, 'socket', {
		value: socketShim,
		enumerable: true,
		configurable: true
	})

	return { ws, isRawNodeEnabled: () => rawNodeEnabled }
}

const makeWASocket = (config: UserFacingSocketConfig) => {
	const fullConfig = { ...DEFAULT_CONNECTION_CONFIG, ...config }
	const { auth, logger } = fullConfig

	const ev = makeEventBuffer()
	let client: WasmWhatsAppClient | undefined
	let user: { id?: string; lid?: string } | undefined

	const { ws, isRawNodeEnabled } = makeWsEmitter(() => client)

	let tagEpoch = 0
	const tagPrefix = `${Date.now().toString(36)}.`
	const generateMessageTag = () => `${tagPrefix}${tagEpoch++}`

	let pairedAccount: { platform?: string; businessName?: string } | undefined
	let cachedAccount: proto.IAdvSignedDeviceIdentity | undefined

	const ctx: SocketContext = {
		ev,
		logger,
		fullConfig,
		ws,
		getUser: () => user,
		setUser: u => {
			user = u
		},
		getClient: async () => {
			await initPromise
			if (initError) {
				throw new Boom('Bridge client failed to initialize: ' + initError.message, { statusCode: 500 })
			}

			if (!client) throw new Boom('Client not initialized', { statusCode: 500 })
			return client
		},
		getClientSync: () => {
			if (!client) throw new Boom('Client not initialized', { statusCode: 500 })
			return client
		}
	}

	const handleEvent = makeEventHandler(ctx, {
		onPairSuccess: data => {
			pairedAccount = data
			client
				?.getAccount?.()
				.then((acc: proto.IAdvSignedDeviceIdentity | undefined) => {
					cachedAccount = acc ?? undefined
				})
				.catch(() => {})
		}
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
		queueMicrotask(() => ev.emit('connection.update', { connection: 'connecting' } as Partial<ConnectionState>))

		// Auto-promote upstream-Baileys-style `auth: { creds, keys }` to a
		// `JsStoreCallbacks`-shaped store via `wrapLegacyStore`. The synthetic
		// `saveCreds` callback re-emits `creds.update` so the bot's existing
		// `ev.on('creds.update', saveCreds)` listener handles persistence —
		// matches the lifecycle hook every upstream-Baileys setup already
		// wires, so migration needs zero changes to the auth block.
		let bridgeStore = auth.store ?? null
		if (!bridgeStore && auth.creds && auth.keys) {
			const legacyState = { creds: auth.creds, keys: auth.keys }
			bridgeStore = await wrapLegacyStore(
				legacyState,
				async () => {
					ev.emit('creds.update', auth.creds!)
				},
				logger
			)
			logger.debug('auth: auto-wrapped legacy {creds, keys} via wrapLegacyStore')
		}

		client = await createWhatsAppClient(
			makeTransport(fullConfig),
			makeHttpClient(fullConfig),
			handleEvent,
			bridgeStore,
			fullConfig.cache ?? null
		)
		// Make this client the fallback for standalone helpers like
		// downloadContentFromMessage that have no socket reference.
		_registerActiveBridgeClient(client, logger)

		const [osName, browserName] = fullConfig.browser
		await client.setDeviceProps(osName, browserName)

		const [major, minor, patch] = fullConfig.version
		client.setVersion(major, minor, patch)

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

		if (isRawNodeEnabled()) {
			client.setRawNodeForwarding(true)
		}

		client.run()
	}

	let initError: Error | undefined
	const initPromise = init().catch(err => {
		initError = err instanceof Error ? err : new Error(String(err))
		logger.error({ err }, 'failed to initialize bridge client')
	})

	const end = async () => {
		const c = client
		client = undefined
		if (c) {
			try {
				await c.disconnect()
			} catch {
				/* ignore */
			}

			try {
				await auth.store?.flush?.()
			} catch {
				/* ignore */
			}

			try {
				c.free()
			} catch {
				/* ignore */
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

		ev.emit('connection.update', {
			connection: 'close',
			lastDisconnect: {
				error: new Boom(msg || 'Logged out', { statusCode: DisconnectReason.loggedOut }),
				date: new Date()
			}
		} as Partial<ConnectionState>)
		await end()
	}

	const waitForConnectionUpdate = (check: (update: Partial<ConnectionState>) => boolean, timeoutMs?: number) => {
		return new Promise<void>((resolve, reject) => {
			let timeout: NodeJS.Timeout | undefined
			const listener = (update: Partial<ConnectionState>) => {
				if (check(update)) {
					ev.off('connection.update', listener)
					if (timeout) clearTimeout(timeout)
					resolve()
				}
			}

			ev.on('connection.update', listener)
			if (timeoutMs) {
				timeout = setTimeout(() => {
					ev.off('connection.update', listener)
					reject(new Boom('Timed out waiting for connection update', { statusCode: 408 }))
				}, timeoutMs)
				// Don't keep the process alive if the caller has already stopped
				// awaiting (e.g. sock.end() during shutdown with in-flight queries).
				timeout.unref()
			}
		})
	}

	const sock = {
		ev,
		logger,
		ws,
		type: 'md' as const,
		get user() {
			return user
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
		get authState() {
			return {
				creds: {
					...auth.creds,
					me: user ? ({ id: user.id, lid: user.lid } as Contact) : undefined,
					account: cachedAccount,
					platform: pairedAccount?.platform
				},
				// `keys` is a no-op facade for upstream-Baileys code that pokes
				// at the legacy SignalKeyStore (e.g. clearing sender-keys after a
				// decrypt error: `keys.set({ 'sender-key': { [groupId]: null } })`).
				// In baileyrs the bridge owns all Signal state, so writes here
				// would silently no-op even if we delegated them — the real
				// sender-key store is internal to Rust. We expose stable methods
				// that don't crash, log at debug for traceability, and return
				// empty results from `.get` so callers fall through to whatever
				// regen path they already have.
				keys: auth.keys ?? noopKeyStore(logger)
			}
		},
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
		waitForMessage: <T = BinaryNode>(msgId: string, timeoutMs?: number): Promise<T> => {
			return new Promise<T>((resolve, reject) => {
				const timeout = timeoutMs ?? fullConfig.defaultQueryTimeoutMs
				let timer: NodeJS.Timeout | undefined
				const onRecv = (data: T) => {
					if (timer) clearTimeout(timer)
					resolve(data)
				}

				ws.once(`TAG:${msgId}`, onRecv as (...args: unknown[]) => void)
				if (timeout) {
					timer = setTimeout(() => {
						ws.off(`TAG:${msgId}`, onRecv as (...args: unknown[]) => void)
						reject(new Boom('Timed out waiting for message', { statusCode: DisconnectReason.timedOut }))
					}, timeout)
					// Query timers shouldn't keep the process alive past sock.end()
					// if the caller has given up — same pattern as use-bridge-store.
					timer.unref()
				}
			})
		},
		query: async (node: BinaryNode, timeoutMs?: number): Promise<BinaryNode> => {
			if (!node.attrs.id) {
				node.attrs.id = generateMessageTag()
			}

			const msgId = node.attrs.id
			const resultPromise = sock.waitForMessage<BinaryNode>(msgId, timeoutMs)
			try {
				await sock.sendNode(node)
			} catch (err) {
				ws.removeAllListeners(`TAG:${msgId}`)
				throw err
			}

			return resultPromise
		},
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
		signalRepository: makeSignalRepository(ctx),
		/** @deprecated Pre-key management is handled by the Rust bridge. */
		uploadPreKeys: async () => {},
		/** @deprecated Pre-key management is handled by the Rust bridge. */
		uploadPreKeysToServerIfRequired: async () => {},
		end,
		logout,
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
			presence: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused',
			toJid?: string
		) => {
			const c = await ctx.getClient()
			if (presence === 'available' || presence === 'unavailable') {
				return c.sendPresence(presence)
			}

			if (!toJid) {
				throw new Boom(`sendPresenceUpdate('${presence}') requires a target jid`, { statusCode: 400 })
			}

			return c.sendChatState(toJid, presence)
		},
		/**
		 * Plaintext media upload helper, source-compatible with the upstream
		 * Baileys `sock.waUploadToServer(buf, { mediaType })` shape so existing
		 * callers (or `prepareWAMessageMedia(msg, { upload: sock.waUploadToServer })`)
		 * keep working. Delegates to the bridge's encrypt + CDN-failover upload.
		 */
		waUploadToServer: async (data: Uint8Array | Buffer, opts: { mediaType: MediaType }): Promise<UploadMediaResult> => {
			const bytes = data instanceof Uint8Array && !Buffer.isBuffer(data) ? data : new Uint8Array(data)
			return (await ctx.getClient()).uploadMedia(bytes, opts.mediaType)
		},
		fetchPrivacySettings: async () => {
			return (await ctx.getClient()).fetchPrivacySettings()
		},
		updatePrivacySetting: async (category: string, value: string) => {
			await (await ctx.getClient()).updatePrivacySetting(category, value)
		},
		updateLastSeenPrivacy: async (value: string) => {
			await (await ctx.getClient()).updatePrivacySetting('last', value)
		},
		updateOnlinePrivacy: async (value: string) => {
			await (await ctx.getClient()).updatePrivacySetting('online', value)
		},
		updateProfilePicturePrivacy: async (value: string) => {
			await (await ctx.getClient()).updatePrivacySetting('profile', value)
		},
		updateStatusPrivacy: async (value: string) => {
			await (await ctx.getClient()).updatePrivacySetting('status', value)
		},
		updateReadReceiptsPrivacy: async (value: string) => {
			await (await ctx.getClient()).updatePrivacySetting('readreceipts', value)
		},
		updateGroupsAddPrivacy: async (value: string) => {
			await (await ctx.getClient()).updatePrivacySetting('groupadd', value)
		},
		updateDefaultDisappearingMode: async (duration: number) => {
			await (await ctx.getClient()).updateDefaultDisappearingMode(duration)
		},
		rejectCall: async (callId: string, callFrom: string) => {
			await (await ctx.getClient()).rejectCall(callId, callFrom)
		},
		fetchStatus: async (...jids: string[]) => {
			return (await ctx.getClient()).fetchStatus(jids) as Promise<Array<{ jid: string; status?: string }>>
		},
		getBusinessProfile: async (jid: string) => {
			return (await ctx.getClient()).getBusinessProfile(jid)
		},
		fetchMessageHistory: async (
			count: number,
			oldestMsgKey: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null },
			oldestMsgTimestamp: number
		) => {
			return (await ctx.getClient()).fetchMessageHistory(
				count,
				oldestMsgKey.remoteJid || '',
				oldestMsgKey.id || '',
				oldestMsgKey.fromMe || false,
				oldestMsgTimestamp
			)
		},
		groupMemberAddMode: async (jid: string, mode: 'admin_add' | 'all_member_add') => {
			await (await ctx.getClient()).groupMemberAddMode(jid, mode)
		},
		sendStatusMessage: async (message: Record<string, unknown>, recipients: string[]): Promise<string> => {
			const bytes = encodeProto('Message', message)
			return (await ctx.getClient()).sendStatusMessageBytes(bytes, recipients)
		},
		...makeMessageMethods(ctx),
		...makeGroupMethods(ctx),
		...makeContactMethods(ctx),
		...makeProfileMethods(ctx),
		...makeChatActionMethods(ctx),
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
