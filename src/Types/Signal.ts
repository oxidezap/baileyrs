import type { proto } from '../WAProto/runtime.ts'
import type { LIDMapping } from './Auth.ts'

type DecryptGroupSignalOpts = { group: string; authorJid: string; msg: Uint8Array }
type ProcessSenderKeyDistributionMessageOpts = {
	item: proto.Message.ISenderKeyDistributionMessage
	authorJid: string
}
type DecryptSignalProtoOpts = { jid: string; type: 'pkmsg' | 'msg'; ciphertext: Uint8Array }
type EncryptMessageOpts = { jid: string; data: Uint8Array }
type EncryptGroupMessageOpts = { group: string; data: Uint8Array; meId: string }
type GetSenderKeyDistributionMessageOpts = { group: string; meId: string }
type PreKey = { keyId: number; publicKey: Uint8Array }
type SignedPreKey = PreKey & { signature: Uint8Array }
type E2ESession = {
	registrationId: number
	identityKey: Uint8Array
	signedPreKey: SignedPreKey
	preKey?: PreKey
}
type E2ESessionOpts = { jid: string; session: E2ESession }

export type SignalRepository = {
	decryptGroupMessage(opts: DecryptGroupSignalOpts): Promise<Uint8Array>
	processSenderKeyDistributionMessage(opts: ProcessSenderKeyDistributionMessageOpts): Promise<void>
	decryptMessage(opts: DecryptSignalProtoOpts): Promise<Uint8Array>
	encryptMessage(opts: EncryptMessageOpts): Promise<{ type: 'pkmsg' | 'msg'; ciphertext: Uint8Array }>
	encryptGroupMessage(opts: EncryptGroupMessageOpts): Promise<{
		senderKeyDistributionMessage: Uint8Array
		ciphertext: Uint8Array
	}>
	getSenderKeyDistributionMessage(opts: GetSenderKeyDistributionMessageOpts): Promise<Uint8Array>
	hasSenderKey(opts: GetSenderKeyDistributionMessageOpts): Promise<boolean>
	getSessionInfo(jid: string): Promise<{ baseKey: Uint8Array; registrationId: number } | null>
	injectE2ESession(opts: E2ESessionOpts): Promise<void>
	validateSession(jid: string): Promise<{ exists: boolean; reason?: string }>
	jidToSignalProtocolAddress(jid: string): string
	migrateSession(fromJid: string, toJid: string): Promise<{ migrated: number; skipped: number; total: number }>
	deleteSession(jids: string[]): Promise<void>
}

type LIDMappingStoreContract = {
	storeLIDPNMappings(pairs: LIDMapping[]): Promise<void>
	getLIDForPN(pn: string): Promise<string | null>
	getLIDsForPNs(pns: string[]): Promise<LIDMapping[] | null>
	getPNForLID(lid: string): Promise<string | null>
	getPNsForLIDs(lids: string[]): Promise<LIDMapping[] | null>
	close(): void
}

export interface SignalRepositoryWithLIDStore extends SignalRepository {
	lidMapping: LIDMappingStoreContract
	close?: () => void
}
