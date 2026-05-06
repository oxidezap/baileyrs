import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
	createWhatsAppClient,
	type DevicePlatformType,
	encodeProto,
	initWasmEngine,
	type MediaType,
	type UploadMediaResult,
	type WasmWhatsAppClient
} from 'whatsapp-rust-bridge'
import type { proto } from 'whatsapp-rust-bridge/proto-types'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.ts'
import type {
	BinaryNode,
	ConnectionState,
	Contact,
	LIDMapping,
	ReachoutTimelockState,
	UserFacingSocketConfig,
	WAMessage
} from '../Types/index.ts'
import { DisconnectReason } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import { makeEventBuffer } from '../Utils/event-buffer.ts'
import type { ILogger } from '../Utils/logger.ts'
import { _registerActiveBridgeClient, downloadMediaMessage } from '../Utils/messages.ts'
import { makeNativeCryptoProvider } from '../Utils/native-crypto-provider.ts'
import type { MediaDownloadOptions } from '../Utils/messages-media.ts'
import { wrapLegacyStore } from '../Utils/wrap-legacy-store.ts'
import { assertNodeErrorFree } from '../WABinary/generic-utils.ts'
import { makeBlockingMethods } from './blocking.ts'
import { makeChatActionMethods } from './chat-actions.ts'
import { makeContactMethods } from './contacts.ts'
import { makeEventHandler } from './events.ts'
import { makeGroupMethods } from './groups.ts'
import { makeMessageMethods } from './messages.ts'
import { makeNewsletterMethods } from './newsletter.ts'
import { makePresenceMethods } from './presence.ts'
import { makeProfileMethods } from './profile.ts'
import { mapReachoutTimelock } from './reachout.ts'
import { makeHttpClient, makeTransport } from './transport.ts'
import type { SocketContext } from './types.ts'

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
			},
			/**
			 * Batch variant of `getLIDForPN`. Upstream Baileys' equivalent
			 * coalesces in-flight requests and de-duplicates inputs; we run
			 * the lookups in parallel and return the same `LIDMapping[]`
			 * shape so callers (e.g. `process-message.ts`) keep working.
			 *
			 * Uses `Promise.allSettled` so one bridge-side failure (e.g.
			 * malformed JID, transient cache miss) doesn't reject the
			 * whole batch and lose every successful lookup. Failures are
			 * logged at debug and skipped.
			 *
			 * Returns `null` (not `[]`) when the input list is empty, to
			 * mirror upstream's "absent" sentinel.
			 */
			getLIDsForPNs: async (pns: string[]): Promise<LIDMapping[] | null> => {
				if (pns.length === 0) return null
				const client = await ctx.getClient()
				const unique = [...new Set(pns)]
				const settled = await Promise.allSettled(
					unique.map(async pn => {
						const lid = (await client.lidForPn(pn)) ?? null
						return lid ? ({ pn, lid } satisfies LIDMapping) : null
					})
				)
				const resolved: LIDMapping[] = []
				for (const r of settled) {
					if (r.status === 'fulfilled') {
						if (r.value) resolved.push(r.value)
					} else {
						ctx.logger.debug({ err: r.reason }, 'getLIDsForPNs: lookup rejected — skipping')
					}
				}
				return resolved
			},
			getPNsForLIDs: async (lids: string[]): Promise<LIDMapping[] | null> => {
				if (lids.length === 0) return null
				const client = await ctx.getClient()
				const unique = [...new Set(lids)]
				const settled = await Promise.allSettled(
					unique.map(async lid => {
						const pn = (await client.pnForLid(lid)) ?? null
						return pn ? ({ pn, lid } satisfies LIDMapping) : null
					})
				)
				const resolved: LIDMapping[] = []
				for (const r of settled) {
					if (r.status === 'fulfilled') {
						if (r.value) resolved.push(r.value)
					} else {
						ctx.logger.debug({ err: r.reason }, 'getPNsForLIDs: lookup rejected — skipping')
					}
				}
				return resolved
			},
			/**
			 * No-op shim. The Rust bridge auto-learns LID↔PN mappings inside
			 * `decode_message` / `usync` and persists them through
			 * `JsStoreCallbacks` — upstream Baileys callers (notably
			 * `process-message.ts` re-feeding mappings from `historySync`)
			 * keep type-checking, but we don't need to write back.
			 *
			 * Logs at debug so unexpected paths stay traceable.
			 */
			storeLIDPNMappings: async (pairs: LIDMapping[]): Promise<void> => {
				if (pairs.length === 0) return
				ctx.logger.debug({ count: pairs.length }, 'lidMapping.storeLIDPNMappings — bridge auto-learns, no-op')
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
	// Per-socket random prefix avoids collisions between sockets created
	// in the same millisecond. Date.now()-based prefixes (the previous
	// implementation) collided in test loops and worker pools — every
	// socket started at `tagEpoch=0` and a tagged message-id collision
	// breaks waitForMessage routing.
	const tagPrefix = `${randomBytes(6).toString('base64url')}.`
	const generateMessageTag = () => `${tagPrefix}${tagEpoch++}`

	let pairedAccount: { platform?: string; businessName?: string } | undefined
	let cachedAccount: proto.IAdvSignedDeviceIdentity | undefined
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

		client = await createWhatsAppClient(
			makeTransport(fullConfig),
			makeHttpClient(fullConfig),
			handleEvent,
			bridgeStore,
			fullConfig.cache ?? null,
			fullConfig.version
		)
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

		if (isRawNodeEnabled()) {
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
						error: err instanceof Error ? err : new Boom(String(err), { statusCode: 500 }),
						date: new Date()
					}
				} as Partial<ConnectionState>)
			})
		}
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
				const tag = `TAG:${msgId}`
				// Use `on`+explicit `off` instead of `once`. Two callers
				// awaiting the same id (rare but legal — can happen when an
				// id is reused for retries, or when both an `<ack>` and an
				// `<iq result>` carry the same id) would otherwise have the
				// second listener silently consumed by the first emit.
				const onRecv = (data: T) => {
					if (timer) clearTimeout(timer)
					ws.off(tag, listener)
					resolve(data)
				}
				const listener = onRecv as (...args: unknown[]) => void
				ws.on(tag, listener)
				if (timeout) {
					timer = setTimeout(() => {
						ws.off(tag, listener)
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
			const tag = `TAG:${msgId}`
			// Snapshot the listeners on this tag BEFORE attaching ours so a
			// sendNode failure can remove only what we added — never another
			// caller's listener. `removeAllListeners(tag)` was the prior
			// behavior; it could nuke a parallel `waitForMessage` belonging
			// to a different consumer.
			const before = ws.listeners(tag)
			const resultPromise = sock.waitForMessage<BinaryNode>(msgId, timeoutMs)
			try {
				await sock.sendNode(node)
			} catch (err) {
				const ours = ws.listeners(tag).filter(l => !before.includes(l))
				for (const l of ours) ws.off(tag, l as (...args: unknown[]) => void)
				throw err
			}

			const result = await resultPromise
			// Mirror upstream `Socket/socket.ts:217-220`: a stanza with an
			// `<error>` child is a server-rejection. Throw a Boom carrying
			// the error code so consumers branching on
			// `lastDisconnect.error.statusCode` / `.data` can react. Without
			// this, code expecting upstream semantics treats a 403 / 405
			// error response as success and reads garbage attrs.
			assertNodeErrorFree(result)
			return result
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
		fetchReachoutTimelock: async (): Promise<ReachoutTimelockState> => {
			const payload = await (await ctx.getClient()).fetchReachoutTimelock()
			const state = mapReachoutTimelock(payload) ?? { isActive: false }
			ev.emit('connection.update', { reachoutTimeLock: state } as Partial<ConnectionState>)
			return state
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
