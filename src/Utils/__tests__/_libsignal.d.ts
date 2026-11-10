/**
 * Local ambient declarations for the parts of `libsignal` we exercise in
 * unit tests. Upstream package ships JS only — these match the runtime
 * surface declared in `libsignal/src/session_record.js`. Narrow on purpose:
 * if a test needs more, extend here rather than reaching for `as any`.
 */

declare module 'libsignal/src/session_record.js' {
	import type { Buffer } from 'node:buffer'

	export interface SessionEntryChainKey {
		counter: number
		key: Buffer
	}

	export interface SessionEntryChain {
		chainKey: SessionEntryChainKey
		chainType: number
		messageKeys: Record<string, Buffer>
	}

	export interface SessionEntryRatchet {
		ephemeralKeyPair: { pubKey: Buffer; privKey: Buffer }
		lastRemoteEphemeralKey: Buffer
		previousCounter: number
		rootKey: Buffer
	}

	export interface SessionEntryIndexInfo {
		baseKey: Buffer
		baseKeyType: number
		closed: number
		used: number
		created: number
		remoteIdentityKey: Buffer
	}

	export interface SessionEntry {
		registrationId: number
		currentRatchet: SessionEntryRatchet
		indexInfo: SessionEntryIndexInfo
		_chains: Record<string, SessionEntryChain>
		pendingPreKey?: { preKeyId?: number; signedKeyId?: number; baseKey: Buffer }
	}

	export default class SessionRecord {
		static deserialize(data: unknown): SessionRecord
		serialize(): unknown
		haveOpenSession(): boolean
		getOpenSession(): SessionEntry | undefined
		closeSession(session: SessionEntry): void
		openSession(session: SessionEntry): void
		isClosed(session: SessionEntry): boolean
		removeOldSessions(): void
		deleteAllSessions(): void
	}
}

declare module 'libsignal' {
	import type { Buffer } from 'node:buffer'
	import type SessionRecord from 'libsignal/src/session_record.js'

	export interface KeyPair {
		pubKey: Buffer
		privKey: Buffer
	}

	export interface PreKeyBundle {
		registrationId: number
		identityKey: Buffer
		signedPreKey: { keyId: number; publicKey: Buffer; signature: Buffer }
		preKey?: { keyId: number; publicKey: Buffer }
	}

	export interface SignalStorage {
		getOurIdentity(): KeyPair | Promise<KeyPair>
		getOurRegistrationId(): number | Promise<number>
		isTrustedIdentity(id: string, identityKey: Buffer): boolean | Promise<boolean>
		loadSession(id: string): SessionRecord | undefined | Promise<SessionRecord | undefined>
		storeSession(id: string, record: SessionRecord): void | Promise<void>
		loadPreKey(id: number): KeyPair | undefined | Promise<KeyPair | undefined>
		loadSignedPreKey(id: number): KeyPair | undefined | Promise<KeyPair | undefined>
		removePreKey(id: number): void | Promise<void>
	}

	export class ProtocolAddress {
		constructor(id: string, deviceId: number)
		readonly id: string
		readonly deviceId: number
		toString(): string
	}

	export class SessionBuilder {
		constructor(storage: SignalStorage, addr: ProtocolAddress)
		initOutgoing(device: PreKeyBundle): Promise<void>
	}

	export interface EncryptedMessage {
		type: number
		body: Buffer
		registrationId: number
	}

	export class SessionCipher {
		constructor(storage: SignalStorage, addr: ProtocolAddress)
		encrypt(data: Buffer): Promise<EncryptedMessage>
		decryptWhisperMessage(data: Buffer): Promise<Buffer>
		decryptPreKeyWhisperMessage(data: Buffer): Promise<Buffer>
	}

	export const keyhelper: {
		generateIdentityKeyPair(): KeyPair
		generateRegistrationId(): number
		generateSignedPreKey(
			identityKeyPair: KeyPair,
			signedKeyId: number
		): { keyId: number; keyPair: KeyPair; signature: Buffer }
		generatePreKey(keyId: number): { keyId: number; keyPair: KeyPair }
	}
}
