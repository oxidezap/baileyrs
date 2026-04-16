import { Boom } from '@hapi/boom'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { createWhatsAppClient, initWasmEngine, type WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import type { proto } from '../../WAProto/index.js'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index'
import type { BinaryNode, ConnectionState, Contact, UserFacingSocketConfig, WAMessage } from '../Types/index'
import { DisconnectReason } from '../Types/index'
import { makeEventBuffer } from '../Utils/event-buffer'
import { downloadMediaMessage } from '../Utils/messages'
import type { MediaDownloadOptions } from '../Utils/messages-media'
import { makeBlockingMethods } from './blocking'
import { makeChatActionMethods } from './chat-actions'
import { makeContactMethods } from './contacts'
import { makeEventHandler } from './events'
import { makeGroupMethods } from './groups'
import { makeMessageMethods } from './messages'
import { makeNewsletterMethods } from './newsletter'
import { makePresenceMethods } from './presence'
import { makeProfileMethods } from './profile'
import { makeHttpClient, makeTransport } from './transport'
import type { SocketContext } from './types'

let wasmInitialized = false

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
			initWasmEngine(logger)
			wasmInitialized = true
		}

		ev.emit('connection.update', { connection: 'connecting' } as Partial<ConnectionState>)

		const bridgeStore = auth.store ?? null
		client = await createWhatsAppClient(
			makeTransport(fullConfig),
			makeHttpClient(fullConfig),
			handleEvent,
			bridgeStore,
			fullConfig.cache ?? null
		)

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
				keys: auth.keys ?? {}
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
			return (await ctx.getClient()).createParticipantNodes(jids, message, extraAttrs ?? {})
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
		sendPresenceUpdate: async (presence: 'available' | 'unavailable') => {
			return (await ctx.getClient()).sendPresence(presence)
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
			return (await ctx.getClient()).sendStatusMessage(message, recipients)
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
