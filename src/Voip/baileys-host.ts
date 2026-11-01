import type { BinaryNode } from '../Types/BinaryNode.ts'
import { jidDecode, jidEncode } from '../WABinary/jid-utils.ts'

type Awaitable<T> = T | Promise<T>
type EncType = 'msg' | 'pkmsg'
type TokenRecord = { token: Uint8Array; timestamp?: number | string; senderTimestamp?: number }

export type BaileysDeviceIdentity = {
	details?: Uint8Array | null
	accountSignatureKey?: Uint8Array | null
	accountSignature?: Uint8Array | null
	deviceSignature?: Uint8Array | null
}

/** Only public socket capabilities. The supplied repository remains the ratchet owner. */
export interface BaileysCallSocket {
	authState: {
		creds: { me?: { id: string; lid?: string }; account?: BaileysDeviceIdentity }
		keys: {
			get(type: 'tctoken' | 'lid-mapping', ids: string[]): Awaitable<Record<string, TokenRecord | string | undefined>>
		}
	}
	signalRepository: {
		lidMapping: { getLIDForPN(peer: string): Promise<string | null> }
		encryptMessage(options: { jid: string; data: Uint8Array }): Promise<{ type: EncType; ciphertext: Uint8Array }>
		decryptMessage(options: { jid: string; type: EncType; ciphertext: Uint8Array }): Promise<Uint8Array>
	}
	getUSyncDevices(
		jids: string[],
		useCache: boolean,
		ignoreZeroDevices: boolean
	): Promise<{ jid: string; device?: number }[]>
	assertSessions(jids: string[], force?: boolean): Promise<unknown>
	generateMessageTag(): string
	sendNode(node: BinaryNode): Promise<void>
	ws: {
		readonly isOpen: boolean
		on(event: string, listener: (...args: unknown[]) => void): unknown
		off(event: string, listener: (...args: unknown[]) => void): unknown
	}
}

export interface BaileysCallHostOptions {
	/** Pass upstream's encodeSignedDeviceIdentity; no second protobuf implementation is loaded. */
	encodeDeviceIdentity(account: BaileysDeviceIdentity, includeSignatureKey: boolean): Uint8Array
	ackTimeoutMs?: number
}

export const createBaileysCallHost = (socket: BaileysCallSocket, options: BaileysCallHostOptions) => {
	const timeoutMs = options.ackTimeoutMs ?? 30_000
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
		throw new RangeError('ackTimeoutMs must be positive and fit a timer')
	const pending = new Map<string, () => void>()
	let disposed = false
	const connected = () => !disposed && socket.ws.isOpen
	const assertConnected = () => {
		if (!connected()) throw new Error('Call host connection closed')
	}
	const host = {
		ownLid: () => socket.authState.creds.me?.lid,
		ownPn: () => socket.authState.creds.me?.id,
		isConnected: connected,
		generateRequestId: () => {
			assertConnected()
			return socket.generateMessageTag()
		},
		async namespaceAlias(peer: string): Promise<string | undefined> {
			assertConnected()
			const decoded = jidDecode(peer)
			if (!decoded || (decoded.server !== 'lid' && decoded.server !== 's.whatsapp.net')) return undefined
			const key = decoded.server === 'lid' ? `${decoded.user}_reverse` : decoded.user
			const mapping = await socket.authState.keys.get('lid-mapping', [key])
			assertConnected()
			const user = mapping[key]
			if (user === undefined) return undefined
			if (typeof user !== 'string') throw new Error('Invalid stored call identity mapping')
			return jidEncode(user, decoded.server === 'lid' ? 's.whatsapp.net' : 'lid', decoded.device)
		},
		async learnIdentity(lid: string, pn: string, _offline: boolean, _hasUsername: boolean): Promise<void> {
			const alias = await host.namespaceAlias(lid)
			if (alias && jidDecode(alias)?.user === jidDecode(pn)?.user) return
			throw new Error('Automatic first-contact call identity/session migration is unsupported by the upstream host API')
		},
		async resolvePeer(peer: string): Promise<string> {
			assertConnected()
			if (peer.endsWith('@lid')) return peer
			let lid = await socket.signalRepository.lidMapping.getLIDForPN(peer)
			if (!lid) {
				assertConnected()
				await socket.getUSyncDevices([peer], true, false)
				lid = await socket.signalRepository.lidMapping.getLIDForPN(peer)
			}
			assertConnected()
			if (!lid) throw new Error('Call peer has no known LID')
			return lid
		},
		async prepareKeys(peer: string, plaintext: Uint8Array) {
			assertConnected()
			// Upstream has no mutation-free pkmsg preflight. Refuse before touching any ratchet.
			const account = socket.authState.creds.account
			if (!account) throw new Error('Calls require the linked device identity')
			const identity = options.encodeDeviceIdentity(account, true)
			if (!(identity instanceof Uint8Array) || !identity.length)
				throw new Error('Linked device identity must encode to non-empty bytes')
			const found = await socket.getUSyncDevices([peer], true, false)
			assertConnected()
			const ringDevices = [
				...new Set(
					found
						.filter(
							device => device.device !== 99 && !device.jid.endsWith('@hosted') && !device.jid.endsWith('@hosted.lid')
						)
						.map(device => device.jid)
				)
			]
			if (!ringDevices.length) throw new Error('Call peer has no supported devices')
			await socket.assertSessions(ringDevices)
			const deviceKeys: { deviceJid: string; ciphertext: Uint8Array; encType: EncType }[] = []
			for (const deviceJid of ringDevices) {
				assertConnected()
				// The repository awaits its own transaction commit, including storage errors.
				const encrypted = await socket.signalRepository.encryptMessage({ jid: deviceJid, data: plaintext })
				deviceKeys.push({ deviceJid, ciphertext: encrypted.ciphertext, encType: encrypted.type })
			}
			assertConnected()
			return {
				deviceKeys,
				ringDevices,
				deviceIdentity: deviceKeys.some(key => key.encType === 'pkmsg') ? identity : undefined
			}
		},
		async decrypt(peer: string, encType: EncType, ciphertext: Uint8Array): Promise<Uint8Array> {
			assertConnected()
			const plaintext = await socket.signalRepository.decryptMessage({ jid: peer, type: encType, ciphertext })
			assertConnected()
			return plaintext
		},
		async readToken(peer: string): Promise<TokenRecord | undefined> {
			assertConnected()
			const values = await socket.authState.keys.get('tctoken', [peer])
			assertConnected()
			const value = values[peer]
			if (value === undefined) return undefined
			if (typeof value === 'string' || !(value.token instanceof Uint8Array))
				throw new Error('Invalid stored call token')
			return value
		},
		/** Upstream's public raw IQ helper lacks its private dedupe, routing and persistence lifecycle.
		 * Automatic call-triggered issuance is unsupported; the existing upstream lifecycle retains authority.
		 */
		async issueToken(_peer: string): Promise<void> {},
		async sendNode(node: BinaryNode): Promise<void> {
			assertConnected()
			await socket.sendNode(node)
		},
		watchAck(id: string): { promise: Promise<BinaryNode>; cancel(): void } {
			assertConnected()
			if (pending.has(id)) throw new Error('Duplicate call request id')
			if (pending.size >= 256) throw new Error('Too many pending call acknowledgements')
			let settle!: (node?: BinaryNode, error?: unknown) => void
			const cancel = () => settle(undefined, new DOMException('Call acknowledgement cancelled', 'AbortError'))
			const promise = new Promise<BinaryNode>((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timer)
					socket.ws.off(`TAG:${id}`, reply)
					socket.ws.off('close', close)
					socket.ws.off('error', fail)
					pending.delete(id)
				}
				settle = (node, error) => {
					if (pending.get(id) !== cancel) return
					cleanup()
					if (node) resolve(node)
					else reject(error)
				}
				const reply = (...args: unknown[]) => {
					const node = args[0] as BinaryNode | undefined
					if (node?.tag === 'ack' && node.attrs?.id === id && node.attrs.class === 'call') settle(node)
				}
				const close = () => settle(undefined, new Error('Call host connection closed'))
				const fail = (...args: unknown[]) => settle(undefined, args[0] ?? new Error('Call host connection error'))
				const timer = setTimeout(() => settle(undefined, new Error('Call acknowledgement timed out')), timeoutMs)
				pending.set(id, cancel)
				socket.ws.on(`TAG:${id}`, reply)
				socket.ws.on('close', close)
				socket.ws.on('error', fail)
			})
			void promise.catch(() => undefined)
			return { promise, cancel }
		}
	}
	return {
		host,
		dispose() {
			if (disposed) return
			disposed = true
			for (const cancel of pending.values()) cancel()
		}
	}
}
